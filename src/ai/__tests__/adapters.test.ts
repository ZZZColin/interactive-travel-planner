import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractTravelPlan, generateAiCoverImage, listAiModels } from '../adapters'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../prompt'
import type { AiImportDraft, AiInputImage, AiProviderProfile } from '../types'

const draft: AiImportDraft = {
  title: '甘南三日游', durationDays: 1, origin: '兰州', returnToOrigin: true,
  days: [{ sourceLabel: 'D1', startArea: '兰州', endArea: '合作', overnightArea: '合作', places: [
    { name: '扎尕那', kind: 'poi', category: 'attraction', note: '', stayMinutes: 120, transportToNext: 'driving' },
  ] }],
  generalNotes: [], uncertainties: [],
}

function profile(protocol: AiProviderProfile['protocol']): AiProviderProfile {
  return { id: protocol, name: protocol, presetId: null, protocol, baseUrl: 'https://mock.local/v1', models: ['mock', 'mock-fast'], model: 'mock', timeoutSeconds: 10, contextWindowTokens: 32000, maxInputTokens: 12000, maxOutputTokens: 1000, systemPrompt: DEFAULT_AI_SYSTEM_PROMPT }
}

afterEach(() => vi.unstubAllGlobals())

describe('AI protocol adapters', () => {
  it('parses OpenAI Responses structured text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(draft) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const result = await extractTravelPlan(profile('openai-responses'), 'key', '这是一段长度足够的旅行攻略文本，用于测试结构化抽取。')
    expect(result.title).toBe('甘南三日游')
    expect(result.days[0].places[0].name).toBe('扎尕那')
  })

  it('generates an AI cover image through an OpenAI-compatible image endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(generateAiCoverImage(profile('openai-chat-completions'), 'key', 'gpt-image-1', '无文字旅行封面')).resolves.toBe('data:image/png;base64,aGVsbG8=')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/images/generations')
  })

  it('lists models from an OpenAI-compatible provider endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ object: 'list', data: [
      { id: 'provider/custom-large', object: 'model', created: 1, owned_by: 'provider' },
      { id: 'provider/custom-fast', object: 'model', created: 2, owned_by: 'provider' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(listAiModels(profile('openai-chat-completions'), 'key')).resolves.toEqual(['provider/custom-large', 'provider/custom-fast'])
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/models')
  })

  it('parses OpenAI Chat Completions content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const result = await extractTravelPlan(profile('openai-chat-completions'), 'key', '这是一段长度足够的旅行攻略文本，用于测试结构化抽取。')
    expect(result.durationDays).toBe(1)
  })

  it('preserves an explicit total duration when only some days have details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...draft, durationDays: 5 }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const result = await extractTravelPlan(profile('openai-chat-completions'), 'key', '川西小环线五天四晚，但分享中只展开介绍了第一天的详细安排。')
    expect(result.durationDays).toBe(5)
    expect(result.days).toHaveLength(1)
  })

  it('sends pasted images through the OpenAI-compatible multimodal message format', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const image: AiInputImage = { id: 'img', name: 'route.png', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', size: 8 }
    await extractTravelPlan(profile('openai-chat-completions'), 'key', '', [image], '自定义系统提示词')
    const requestInit = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(requestInit?.body ?? '{}'))
    expect(body.messages[0].content).toBe('自定义系统提示词')
    expect(body.messages[1].content).toContainEqual({ type: 'image_url', image_url: { url: image.dataUrl } })
  })

  it('cancels an in-flight SDK request through AbortSignal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted', 'AbortError')), { once: true })
    })))
    const controller = new AbortController()
    const request = extractTravelPlan(profile('openai-chat-completions'), 'key', '这是一段长度足够的旅行攻略文本，用于测试取消请求。', [], undefined, controller.signal)
    controller.abort()
    await expect(request).rejects.toThrow('AI 请求已取消')
  })

  it('rejects requests that exceed the configured input budget', async () => {
    const limited = profile('openai-chat-completions')
    limited.maxInputTokens = 2
    await expect(extractTravelPlan(limited, 'key', '这是一段明显超过两个 Token 的旅行攻略文本。')).rejects.toThrow('超过当前实例设置')
  })

  it('parses Anthropic tool-use input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'extract_travel_plan', input: draft }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const result = await extractTravelPlan(profile('anthropic-messages'), 'key', '这是一段长度足够的旅行攻略文本，用于测试结构化抽取。')
    expect(result.origin).toBe('兰州')
  })
})
