import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  logsInit: vi.fn(),
  logsWarn: vi.fn(),
  logsDebug: vi.fn(),
  logsInfo: vi.fn(),
  logsError: vi.fn(),
  rumInit: vi.fn(),
  rumSetUser: vi.fn(),
}))

vi.mock('@openobserve/browser-logs', () => ({
  openobserveLogs: {
    init: sdk.logsInit,
    logger: {
      debug: sdk.logsDebug,
      info: sdk.logsInfo,
      warn: sdk.logsWarn,
      error: sdk.logsError,
    },
  },
}))

vi.mock('@openobserve/browser-rum', () => ({
  openobserveRum: {
    init: sdk.rumInit,
    setUser: sdk.rumSetUser,
  },
}))

describe('openobserve logger loading', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.values(sdk).forEach((mock) => mock.mockReset())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not load the SDK or throw when OpenObserve is not configured', async () => {
    vi.stubEnv('VITE_O2_CLIENT_TOKEN', '')
    vi.stubEnv('VITE_O2_SITE', '')
    const telemetry = await import('@/observability/openobserve-logger')

    expect(() => telemetry.logger.warn('early warning')).not.toThrow()
    expect(() => telemetry.setUser({ id: 1 })).not.toThrow()
    expect(() => telemetry.initObservability()).not.toThrow()

    await Promise.resolve()
    expect(sdk.logsInit).not.toHaveBeenCalled()
    expect(sdk.rumInit).not.toHaveBeenCalled()
  })

  it('flushes safe early logger and user calls after the dynamically loaded SDK starts', async () => {
    vi.stubEnv('VITE_O2_CLIENT_TOKEN', 'test-token')
    vi.stubEnv('VITE_O2_SITE', 'logs.example.com')
    const telemetry = await import('@/observability/openobserve-logger')

    telemetry.logger.warn('early warning', { requestId: 'request-1' })
    telemetry.setUser({ id: 42, name: 'Tester' })
    telemetry.initObservability()
    telemetry.initObservability()

    await vi.waitFor(() => expect(sdk.rumInit).toHaveBeenCalledTimes(1))
    expect(sdk.logsInit).toHaveBeenCalledTimes(1)
    expect(sdk.logsWarn).toHaveBeenCalledWith('early warning', { requestId: 'request-1' })
    expect(sdk.rumSetUser).toHaveBeenCalledWith({ id: '42', name: 'Tester', email: undefined })
  })

  it('installs recursive fail-closed beforeSend hooks for Logs and RUM', async () => {
    vi.stubEnv('VITE_O2_CLIENT_TOKEN', 'test-token')
    vi.stubEnv('VITE_O2_SITE', 'logs.example.com')
    const telemetry = await import('@/observability/openobserve-logger')

    telemetry.initObservability()
    await vi.waitFor(() => expect(sdk.rumInit).toHaveBeenCalledTimes(1))

    type BeforeSendOptions = { beforeSend: (event: unknown) => boolean }
    const logsOptions = sdk.logsInit.mock.calls[0]?.[0] as BeforeSendOptions
    const rumOptions = sdk.rumInit.mock.calls[0]?.[0] as BeforeSendOptions
    const logsEvent = {
      message: 'GET https://api.example.com/session?access_token=message-secret failed',
      console: { arguments: [{ cookie: 'sid=console-secret', status: 401 }] },
      error: {
        response: {
          status: 401,
          config: { headers: { authorization: 'Bearer nested-secret' } },
        },
      },
    }

    expect(logsOptions.beforeSend(logsEvent)).toBe(true)
    expect(logsEvent).toEqual({
      message: 'GET https://api.example.com/session failed',
      console: { arguments: [{ cookie: '[REDACTED]', status: 401 }] },
      error: {
        response: {
          status: 401,
          config: { headers: { authorization: '[REDACTED]' } },
        },
      },
    })

    const locked = {}
    Object.defineProperty(locked, 'accessToken', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: 'locked-secret',
    })
    expect(rumOptions.beforeSend({ context: locked })).toBe(false)
  })

  it('sanitizes structured logger messages before they enter the SDK', async () => {
    vi.stubEnv('VITE_O2_CLIENT_TOKEN', 'test-token')
    vi.stubEnv('VITE_O2_SITE', 'logs.example.com')
    const telemetry = await import('@/observability/openobserve-logger')

    telemetry.logger.warn('download https://cdn.example.com/video.mp4?X-Amz-Signature=logger-signature-secret failed', {
      requestId: 'request-9',
    })
    telemetry.initObservability()

    await vi.waitFor(() => expect(sdk.logsWarn).toHaveBeenCalledTimes(1))
    expect(sdk.logsWarn).toHaveBeenCalledWith('download https://cdn.example.com/video.mp4 failed', {
      requestId: 'request-9',
    })
  })
})
