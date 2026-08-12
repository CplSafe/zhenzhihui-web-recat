import { describe, expect, it } from 'vitest'

import { extractTaskText } from '@/api/business'

describe('AI task text extraction', () => {
  it('reads text from provider outputs', () => {
    expect(
      extractTaskText({
        status: 'succeeded',
        outputs: [{ type: 'text', text: '生成后的文案' }],
      }),
    ).toBe('生成后的文案')
  })

  it('reads Responses-style nested output content', () => {
    expect(
      extractTaskText({
        result_json: {
          response: {
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: '篮球宣传文案' }],
              },
            ],
          },
        },
      }),
    ).toBe('篮球宣传文案')
  })

  it('reads nested and double-encoded result JSON', () => {
    expect(
      extractTaskText({
        result_json: JSON.stringify(JSON.stringify({ result: { generated_text: '双重编码结果' } })),
      }),
    ).toBe('双重编码结果')
  })

  it('reads provider aliases stored directly on the task', () => {
    expect(extractTaskText({ status: 'success', generated_text: '直接返回的文本' })).toBe('直接返回的文本')
    expect(extractTaskText({ status: 'success', response_json: { answer: '响应 JSON 文本' } })).toBe('响应 JSON 文本')
  })

  it('does not mistake a successful task status for generated text', () => {
    expect(extractTaskText({ status: 'succeeded', message: '成功' })).toBe('')
  })
})
