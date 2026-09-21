import type { Place } from '../domain/types'
import type { DailyWeatherResult, WeatherAlert, WeatherKind } from '../weather/types'

export type RiskSeverity = 'info' | 'attention' | 'warning' | 'critical'
export type RiskCategory = 'altitude' | 'cold' | 'heat' | 'rain' | 'storm' | 'snow' | 'wind' | 'weather-alert' | 'typhoon' | 'earthquake-event' | 'road' | 'remote-area' | 'manual'

export interface RiskSignal {
  id: string
  category: RiskCategory
  severity: RiskSeverity
  title: string
  description: string
  sourceType: 'place-data' | 'weather-derived' | 'official-alert' | 'manual'
  sourceProvider?: string
  effectiveAt?: string
  expiresAt?: string
  actions?: string[]
}

const severityRank: Record<RiskSeverity, number> = { info: 0, attention: 1, warning: 2, critical: 3 }

export function highestRiskSeverity(risks: RiskSignal[]): RiskSeverity | null {
  return risks.reduce<RiskSeverity | null>((current, risk) => !current || severityRank[risk.severity] > severityRank[current] ? risk.severity : current, null)
}

function weatherRisk(kind: WeatherKind | undefined): RiskSignal | null {
  if (kind === 'storm') return { id: 'weather-storm', category: 'storm', severity: 'critical', title: '雷暴或强对流天气', description: '天气预报显示可能出现雷暴或强对流，建议重新评估户外和山地行程。', sourceType: 'weather-derived', actions: ['关注官方预警', '准备室内或低风险替代行程'] }
  if (kind === 'snow') return { id: 'weather-snow', category: 'snow', severity: 'warning', title: '降雪与道路结冰风险', description: '天气预报显示有降雪，山路、垭口和步道通行条件可能变化。', sourceType: 'weather-derived', actions: ['核对道路和景区开放情况', '准备防滑和保暖装备'] }
  if (kind === 'rain') return { id: 'weather-rain', category: 'rain', severity: 'attention', title: '降雨风险', description: '天气预报显示有降雨，户外活动、山路和观景体验可能受到影响。', sourceType: 'weather-derived', actions: ['携带雨具', '预留交通时间'] }
  if (kind === 'wind') return { id: 'weather-wind', category: 'wind', severity: 'warning', title: '大风风险', description: '天气预报显示风力较强，高海拔、索道和开放区域活动可能受到影响。', sourceType: 'weather-derived', actions: ['核对索道和景区通知', '避免临崖和暴露区域长时间停留'] }
  return null
}

function alertSeverity(alert: WeatherAlert): RiskSeverity {
  if (alert.severity === 'extreme' || alert.severity === 'severe') return 'critical'
  if (alert.severity === 'moderate') return 'warning'
  return 'attention'
}

function dateOverlapsAlert(date: string, alert: WeatherAlert): boolean {
  const dayStart = new Date(`${date}T00:00:00`).getTime()
  const dayEnd = new Date(`${date}T23:59:59`).getTime()
  const effective = alert.effectiveAt ? new Date(alert.effectiveAt).getTime() : Date.now()
  const expires = alert.expiresAt ? new Date(alert.expiresAt).getTime() : effective + 24 * 60 * 60_000
  return effective <= dayEnd && expires >= dayStart
}

export function derivePlaceRisks(place: Place, date: string, weather: DailyWeatherResult | null, alerts: WeatherAlert[]): RiskSignal[] {
  const risks: RiskSignal[] = []
  if (place.altitude != null && Number.isFinite(place.altitude) && place.altitude >= 2500) {
    const severity: RiskSeverity = place.altitude >= 4500 ? 'critical' : place.altitude >= 3500 ? 'warning' : 'attention'
    risks.push({ id: `altitude-${place.id}`, category: 'altitude', severity, title: `高海拔 ${Math.round(place.altitude).toLocaleString('zh-CN')} m`, description: '高海拔环境可能增加高原反应风险，住宿海拔和每日上升幅度需要单独评估。', sourceType: 'place-data', actions: ['避免到达后立即剧烈活动', '关注同行人员身体反应'] })
  }
  if (weather?.status === 'available') {
    const conditionRisk = weatherRisk(weather.kind)
    if (conditionRisk) risks.push({ ...conditionRisk, sourceProvider: weather.providerName })
    const min = weather.minTemp
    if (min != null && min <= 0) risks.push({ id: `cold-${date}`, category: 'cold', severity: min <= -10 ? 'critical' : 'warning', title: `低温 ${min}℃`, description: min <= -10 ? '预计最低温度达到严重低温范围，户外暴露和道路结冰风险较高。' : '预计最低温度不高于 0℃，需要关注结冰、保暖和车辆低温启动。', sourceType: 'weather-derived', sourceProvider: weather.providerName, actions: ['准备分层保暖和防风装备', '检查道路结冰信息'] })
    const max = weather.maxTemp
    if (max != null && max >= 35) risks.push({ id: `heat-${date}`, category: 'heat', severity: max >= 40 ? 'critical' : 'warning', title: `高温 ${max}℃`, description: '高温可能增加中暑和脱水风险，应减少正午户外活动。', sourceType: 'weather-derived', sourceProvider: weather.providerName, actions: ['补水并安排遮阴休息', '避免长时间暴晒'] })
  }
  alerts.filter((alert) => dateOverlapsAlert(date, alert)).forEach((alert) => {
    const typhoon = /台风|飓风|热带风暴|hurricane|tropical/i.test(`${alert.eventName} ${alert.headline}`)
    risks.push({ id: `alert-${alert.providerId}-${alert.id}`, category: typhoon ? 'typhoon' : 'weather-alert', severity: alertSeverity(alert), title: alert.headline || alert.eventName, description: alert.description, sourceType: 'official-alert', sourceProvider: alert.source || alert.providerName, effectiveAt: alert.effectiveAt, expiresAt: alert.expiresAt, actions: alert.instruction ? [alert.instruction] : ['关注发布机构后续更新'] })
  })
  return risks.sort((left, right) => severityRank[right.severity] - severityRank[left.severity])
}
