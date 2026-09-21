import type { AiProviderProfile } from '../ai/types'
import { requestStructuredOutput } from '../ai/adapters'

export type ShareStyleId = 'journal' | 'clean' | 'magazine' | 'minimal'
export type ShareFormat = 'cards' | 'long' | 'poster'

export interface ShareAgendaItem {
  name: string
  category: string
  categoryLabel: string
  time: string
  detail: string
}

export interface ShareFact {
  kind: 'weather' | 'lodging' | 'food' | 'transport' | 'budget' | 'people' | 'schedule' | 'other'
  label: string
  value: string
}

export interface ShareDayDraft {
  label: string
  title: string
  route: string
  summary: string
  highlights: string[]
  places: string[]
  agenda: ShareAgendaItem[]
  facts: ShareFact[]
}

export interface ShareDraft {
  title: string
  subtitle: string
  coverHook: string
  overview: string
  overviewFacts: ShareFact[]
  days: ShareDayDraft[]
  tips: string[]
  hashtags: string[]
}

export interface SharePlanInput {
  planName: string
  dateRange: string
  totalDays: number
  totalKm: number
  totalTravelMinutes: number
  budgetText: string
  overviewFacts: ShareFact[]
  days: Array<{
    label: string
    date: string
    places: string[]
    route: string
    agenda: ShareAgendaItem[]
    facts: ShareFact[]
  }>
}

export const DEFAULT_SHARE_PROMPT = `你是旅行图文分享编辑。请严格依据用户提供的计划数据生成适合手机阅读的分享文案，不得新增地点、价格、天气、营业时间或其他未经验证的事实。
标题要自然、有记忆点，但不要使用夸张营销话术。每天摘要控制在 60 字以内，不要只罗列景点；应结合输入中已有的时间安排、交通、住宿、美食、天气和预算信息，写成真实可执行的行程。Tips 只总结输入中可以确认的信息；无法确认时不要猜测。
输出必须符合给定 JSON Schema。`

const shareSchema = {
  type: 'object', additionalProperties: false,
  required: ['title', 'subtitle', 'coverHook', 'overview', 'days', 'tips', 'hashtags'],
  properties: {
    title: { type: 'string' }, subtitle: { type: 'string' }, coverHook: { type: 'string' }, overview: { type: 'string' },
    days: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'title', 'route', 'summary', 'highlights', 'places'], properties: {
      label: { type: 'string' }, title: { type: 'string' }, route: { type: 'string' }, summary: { type: 'string' }, highlights: { type: 'array', items: { type: 'string' } }, places: { type: 'array', items: { type: 'string' } },
    } } },
    tips: { type: 'array', items: { type: 'string' } }, hashtags: { type: 'array', items: { type: 'string' } },
  },
}

export function deterministicShareDraft(input: SharePlanInput): ShareDraft {
  const namedDays = input.days.filter((day) => day.places.length)
  return {
    title: input.planName,
    subtitle: `${input.totalDays} 天旅行路线 · ${input.dateRange}`,
    coverHook: namedDays.length ? `${namedDays[0].places[0]}出发，按计划慢慢走` : '把想去的地方连成一段旅程',
    overview: `全程约 ${Math.round(input.totalKm)} km，交通约 ${Math.round(input.totalTravelMinutes / 60)} 小时。${input.budgetText}`.trim(),
    overviewFacts: input.overviewFacts,
    days: input.days.map((day) => ({
      label: day.label,
      title: day.places.length ? day.places.join(' → ') : '自由安排',
      route: day.route,
      summary: day.agenda.length ? `按时间依次安排 ${day.agenda.map((item) => item.name).join('、')}${day.facts.length ? `，并包含${day.facts.map((item) => item.label).join('、')}等计划信息` : ''}。` : '当天暂未安排具体内容。',
      highlights: [],
      places: day.places,
      agenda: day.agenda,
      facts: day.facts,
    })),
    tips: ['出发前再次核对路线、预约、票务和天气。', '行程时间与费用以实际发生为准。'],
    hashtags: ['旅行计划', '路线规划', input.planName.replace(/\s+/g, '')].filter(Boolean),
  }
}

export async function generateShareDraft(profile: AiProviderProfile, apiKey: string, input: SharePlanInput, prompt: string, signal?: AbortSignal): Promise<ShareDraft> {
  const raw = await requestStructuredOutput(profile, apiKey, { schemaName: 'travel_share_draft', toolName: 'create_travel_share', toolDescription: '根据已有旅行计划生成可编辑的图文分享草稿', schema: shareSchema, userText: JSON.stringify(input), systemPrompt: prompt, signal })
  const fallback = deterministicShareDraft(input)
  return {
    title: String(raw?.title || fallback.title).trim(), subtitle: String(raw?.subtitle || fallback.subtitle).trim(), coverHook: String(raw?.coverHook || fallback.coverHook).trim(), overview: String(raw?.overview || fallback.overview).trim(),
    overviewFacts: input.overviewFacts,
    days: Array.isArray(raw?.days) ? raw.days.map((day: any, index: number) => ({
      label: String(day.label || input.days[index]?.label || `Day ${index + 1}`),
      title: String(day.title || '').trim(),
      route: String(day.route || input.days[index]?.route || '').trim(),
      summary: String(day.summary || '').trim(),
      highlights: Array.isArray(day.highlights) ? day.highlights.map(String).filter(Boolean) : [],
      places: input.days[index]?.places ?? [],
      agenda: input.days[index]?.agenda ?? [],
      facts: input.days[index]?.facts ?? [],
    })) : fallback.days,
    tips: Array.isArray(raw?.tips) ? raw.tips.map(String).filter(Boolean) : fallback.tips,
    hashtags: Array.isArray(raw?.hashtags) ? raw.hashtags.map((item: unknown) => String(item).replace(/^#/, '').trim()).filter(Boolean) : fallback.hashtags,
  }
}
