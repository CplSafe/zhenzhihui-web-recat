import { describe, expect, it } from 'vitest'
import {
  TELEMETRY_REDACTED,
  createSafeErrorDiagnostic,
  sanitizeObservabilityEventUrls,
  sanitizeTelemetryText,
  sanitizeTelemetryUrl,
} from '@/utils/observabilitySanitizer'

describe('observabilitySanitizer', () => {
  it.each([
    ['https://app.example.com/auth/callback?code=secret&state=oauth-state', 'https://app.example.com/auth/callback'],
    ['https://app.example.com/home#access_token=secret', 'https://app.example.com/home'],
    ['https://user:password@app.example.com/private', 'https://app.example.com/private'],
    ['/oauth2/callback?code=secret', '/oauth2/callback'],
    ['//sso.example.com/authorize?state=secret', '//sso.example.com/authorize'],
  ])('removes credentials from telemetry URL %s', (url, expected) => {
    expect(sanitizeTelemetryUrl(url)).toBe(expected)
  })

  it('sanitizes every URL field emitted by the Logs and RUM SDKs', () => {
    const event = {
      view: {
        url: 'https://app.example.com/auth/callback?code=view-code-secret',
        referrer: 'https://sso.example.com/authorize?state=referrer-state-secret',
        performance: {
          lcp: { resource_url: 'https://cdn.example.com/hero.jpg?signature=lcp-signature-secret' },
        },
      },
      resource: { url: 'https://api.example.com/oauth2/token?code=resource-code-secret' },
      error: { resource: { url: 'https://api.example.com/sso?token=error-token-secret' } },
      http: { url: 'https://api.example.com/session?authorization=http-secret' },
      long_task: {
        scripts: [{ source_url: 'https://cdn.example.com/app.js?signature=script-signature-secret' }],
      },
    }

    sanitizeObservabilityEventUrls(event)

    expect(event).toEqual({
      view: {
        url: 'https://app.example.com/auth/callback',
        referrer: 'https://sso.example.com/authorize',
        performance: { lcp: { resource_url: 'https://cdn.example.com/hero.jpg' } },
      },
      resource: { url: 'https://api.example.com/oauth2/token' },
      error: { resource: { url: 'https://api.example.com/sso' } },
      http: { url: 'https://api.example.com/session' },
      long_task: { scripts: [{ source_url: 'https://cdn.example.com/app.js' }] },
    })

    expect(JSON.stringify(event)).not.toMatch(/secret|signature|authorization=/)
  })

  it('ignores missing and non-string telemetry fields without changing them', () => {
    const event = { view: { url: null }, resource: { url: 42 }, error: null }

    expect(() => sanitizeObservabilityEventUrls(event)).not.toThrow()
    expect(event).toEqual({ view: { url: null }, resource: { url: 42 }, error: null })
  })

  it('recursively sanitizes messages, console arguments, errors, responses, and unserializable context', () => {
    const error = new Error(
      'upload https://storage.example.com/video.mp4?X-Amz-Credential=credential-secret&X-Amz-Signature=url-signature-secret failed',
    ) as Error & { response?: unknown }
    error.response = {
      status: 403,
      config: {
        url: 'https://api.example.com/upload?access_token=nested-url-token',
        headers: {
          Authorization: 'Bearer nested-authorization-secret',
          'Set-Cookie': 'session_id=nested-cookie-secret',
        },
      },
      data: {
        access_token: 'nested-access-token-secret',
        requestId: 'request-403',
      },
    }
    const context: Record<string, unknown> = {
      count: 7n,
      formatter: () => 'not serializable',
      marker: Symbol('marker'),
      headers: new Headers({
        Authorization: 'Bearer headers-object-secret',
        'X-Request-ID': 'request-403',
      }),
      query: new URLSearchParams('access_token=params-secret&view=details'),
      metadata: new Map<string, unknown>([
        ['clientSecret', 'map-client-secret'],
        ['status', 403],
      ]),
      tags: new Set(['retryable', 'https://api.example.com/task?token=set-token-secret']),
    }
    context.parent = context
    const event = {
      message:
        'PUT https://storage.example.com/video.mp4?X-Amz-Signature=message-signature-secret failed status=403 authorization=Bearer message-auth-secret',
      console: {
        arguments: [
          'Cookie: session_id=console-cookie-secret; theme=dark',
          { refreshToken: 'console-refresh-secret', requestId: 'request-403' },
        ],
      },
      error,
      exception: {
        context: {
          password: 'exception-password-secret',
          description: 'upload failed but retryable',
        },
      },
      context,
    }

    expect(sanitizeObservabilityEventUrls(event)).toBe(true)

    expect(event.message).toContain('https://storage.example.com/video.mp4')
    expect(event.message).toContain('status=403')
    expect(event.message).not.toContain('message-signature-secret')
    expect(event.message).not.toContain('message-auth-secret')
    expect(event.console.arguments[0]).toBe(`Cookie: ${TELEMETRY_REDACTED}`)
    expect(event.console.arguments[1]).toEqual({
      refreshToken: TELEMETRY_REDACTED,
      requestId: 'request-403',
    })
    expect(error.message).toBe('upload https://storage.example.com/video.mp4 failed')
    expect(error.response).toEqual({
      status: 403,
      config: {
        url: 'https://api.example.com/upload',
        headers: {
          Authorization: TELEMETRY_REDACTED,
          'Set-Cookie': TELEMETRY_REDACTED,
        },
      },
      data: {
        access_token: TELEMETRY_REDACTED,
        requestId: 'request-403',
      },
    })
    expect(event.exception.context).toEqual({
      password: TELEMETRY_REDACTED,
      description: 'upload failed but retryable',
    })
    expect(event.context).toEqual({
      count: '7n',
      formatter: '[Function]',
      marker: '[Symbol]',
      headers: {
        authorization: TELEMETRY_REDACTED,
        'x-request-id': 'request-403',
      },
      query: '[Query parameters removed]',
      metadata: {
        clientSecret: TELEMETRY_REDACTED,
        status: 403,
      },
      tags: ['retryable', 'https://api.example.com/task'],
      parent: '[Circular]',
    })
    expect(() => JSON.stringify(event)).not.toThrow()
  })

  it('fails closed without throwing when an unsafe property cannot be replaced', () => {
    const lockedContext = {}
    Object.defineProperty(lockedContext, 'authorization', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: 'Bearer locked-authorization-secret',
    })

    expect(() => sanitizeObservabilityEventUrls({ context: lockedContext })).not.toThrow()
    expect(sanitizeObservabilityEventUrls({ context: lockedContext })).toBe(false)
  })

  it('keeps useful diagnostics while removing credentials from ordinary text and safe error summaries', () => {
    expect(
      sanitizeTelemetryText(
        'request request-42 failed with 401 at /api/session?token=query-secret Authorization: Bearer header-secret',
      ),
    ).toBe(`request request-42 failed with 401 at /api/session Authorization: ${TELEMETRY_REDACTED}`)

    const diagnostic = createSafeErrorDiagnostic({
      name: 'BusinessError',
      message: 'payment failed at https://pay.example.com/order?token=payment-secret',
      code: 'PAYMENT_REJECTED',
      response: {
        status: 502,
        headers: { authorization: 'Bearer response-secret' },
        data: { access_token: 'response-token-secret' },
      },
    })

    expect(diagnostic).toEqual({
      name: 'BusinessError',
      message: 'payment failed at https://pay.example.com/order',
      status: 502,
      code: 'PAYMENT_REJECTED',
    })
  })
})
