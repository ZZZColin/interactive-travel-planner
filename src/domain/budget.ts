import { routeInfo } from './schedule'
import { buildPlanRouteProjection } from './routeProjection'
import { transportModeOf, transportRouteCacheKey } from './transport'
import type { BudgetSettings, BudgetState, ExpenseBillingUnit, ExpenseCategory, ExpenseItem, ExpenseStatus, PersistedPlannerState, Place, RouteCache } from './types'

export const expenseCategoryMeta: Record<ExpenseCategory, { label: string; unit: ExpenseBillingUnit }> = {
  ticket: { label: '门票', unit: 'person' },
  shuttle: { label: '摆渡车 / 观光车', unit: 'person' },
  cableway: { label: '索道', unit: 'person' },
  lodging: { label: '住宿', unit: 'roomNight' },
  meal: { label: '餐饮', unit: 'person' },
  fuel: { label: '燃油', unit: 'vehicle' },
  charging: { label: '充电', unit: 'vehicle' },
  toll: { label: '高速 / 路桥费', unit: 'vehicle' },
  parking: { label: '停车', unit: 'vehicle' },
  flight: { label: '机票', unit: 'person' },
  train: { label: '火车票', unit: 'person' },
  transit: { label: '公交 / 地铁', unit: 'person' },
  taxi: { label: '出租车 / 网约车', unit: 'group' },
  ferry: { label: '轮渡', unit: 'person' },
  rental: { label: '租车 / 包车', unit: 'vehicle' },
  insurance: { label: '保险', unit: 'person' },
  shopping: { label: '购物', unit: 'item' },
  other: { label: '其他', unit: 'group' },
}

export const expenseStatusMeta: Record<ExpenseStatus, { label: string }> = {
  unknown: { label: '价格未知' }, estimated: { label: '预计' }, confirmed: { label: '已确认' }, paid: { label: '已支付' }, free: { label: '免费' },
}

export const billingUnitLabels: Record<ExpenseBillingUnit, string> = {
  group: '全程 / 全组', person: '人', vehicle: '车', room: '间', night: '晚', roomNight: '间夜', kilometer: '公里', item: '项',
}

export function segmentExpenseOwnerId(stopUid: string, toPlaceId: string): string {
  return `${stopUid}:${toPlaceId}`
}

export interface BudgetLine {
  id: string
  name: string
  category: ExpenseCategory
  ownerType: ExpenseItem['ownerType'] | 'derived'
  ownerId: string
  min: number
  expected: number
  max: number
  status: ExpenseStatus
  source: ExpenseItem['source']
  sourceLabel?: string
  dayId?: string
}

export interface BudgetSummary {
  subtotalMin: number
  subtotalExpected: number
  subtotalMax: number
  contingency: number
  totalMin: number
  totalExpected: number
  totalMax: number
  confirmed: number
  paid: number
  perPerson: number
  remaining: number | null
  unknownCount: number
  completeness: number
  warnings: string[]
  lines: BudgetLine[]
  dayTotals: Record<string, number>
}

export function defaultBudgetSettings(): BudgetSettings {
  return {
    currency: 'CNY',
    limit: null,
    contingencyRate: 0,
    vehicle: {
      enabled: false,
      energyType: 'fuel',
      vehicleCount: 1,
      consumptionPer100Km: 0,
      energyUnitPrice: 0,
      perKmOther: 0,
      includeMapTolls: true,
    },
  }
}

export function defaultBudgetState(): BudgetState {
  return { settings: defaultBudgetSettings(), expenses: [] }
}

function finiteOr(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function normalizeBudgetState(value?: Partial<BudgetState> | null): BudgetState {
  const defaults = defaultBudgetState()
  const vehicle = value?.settings?.vehicle
  return {
    settings: {
      currency: 'CNY',
      limit: value?.settings?.limit == null ? null : Math.max(0, finiteOr(value.settings.limit, 0)),
      contingencyRate: Math.min(1, Math.max(0, finiteOr(value?.settings?.contingencyRate, 0))),
      vehicle: {
        enabled: Boolean(vehicle?.enabled),
        energyType: vehicle?.energyType === 'electric' ? 'electric' : 'fuel',
        vehicleCount: Math.max(1, Math.round(finiteOr(vehicle?.vehicleCount, 1))),
        consumptionPer100Km: Math.max(0, finiteOr(vehicle?.consumptionPer100Km, defaults.settings.vehicle.consumptionPer100Km)),
        energyUnitPrice: Math.max(0, finiteOr(vehicle?.energyUnitPrice, defaults.settings.vehicle.energyUnitPrice)),
        perKmOther: Math.max(0, finiteOr(vehicle?.perKmOther, 0)),
        includeMapTolls: vehicle?.includeMapTolls !== false,
      },
    },
    expenses: (Array.isArray(value?.expenses) ? value.expenses : []).map((item) => ({
      ...item,
      quantity: Math.max(0, finiteOr(item.quantity, 1)),
      unitPrice: item.unitPrice == null ? null : Math.max(0, finiteOr(item.unitPrice, 0)),
      minAmount: item.minAmount == null ? null : Math.max(0, finiteOr(item.minAmount, 0)),
      maxAmount: item.maxAmount == null ? null : Math.max(0, finiteOr(item.maxAmount, 0)),
      updatedAt: item.updatedAt || new Date().toISOString(),
    })),
  }
}

export interface ExpenseAmountRange {
  min: number
  expected: number
  max: number
}

export function expenseItemAmountRange(item: ExpenseItem): ExpenseAmountRange | null {
  if (item.status === 'free') return { min: 0, expected: 0, max: 0 }
  if (item.status === 'unknown') return null
  const fixed = item.unitPrice == null ? null : Math.max(0, item.quantity) * Math.max(0, item.unitPrice)
  // 只有 minAmount/maxAmount 中的一边有值时（比如只导入了 maxAmount，
  // 没有 minAmount 也没有 unitPrice），把缺失的一边退化为已有的那一边，
  // 而不是让整条费用直接判定为"价格未知"、把已有的数值默默丢掉。
  // 正常的 UI 保存路径（ExpenseEditorPopover）会强制 min/max 成对填写，
  // 这里主要是为了兜住备份导入等旁路数据。
  const min = item.minAmount ?? fixed ?? item.maxAmount ?? null
  const max = item.maxAmount ?? fixed ?? item.minAmount ?? null
  if (min == null || max == null) return null
  return { min: Math.min(min, max), expected: fixed ?? (min + max) / 2, max: Math.max(min, max) }
}

function manualLine(item: ExpenseItem, dayId?: string): BudgetLine {
  const amount = expenseItemAmountRange(item)
  return { id: item.id, name: item.name, category: item.category, ownerType: item.ownerType, ownerId: item.ownerId, min: amount?.min ?? 0, expected: amount?.expected ?? 0, max: amount?.max ?? 0, status: item.status, source: item.source, sourceLabel: item.sourceLabel, dayId }
}

function ownerDayMap(state: PersistedPlannerState): Map<string, string> {
  const result = new Map<string, string>()
  state.days.forEach((day) => {
    result.set(`day:${day.id}`, day.id)
    day.stops.forEach((stop) => {
      result.set(`place:${stop.placeId}`, day.id)
      result.set(`stop:${stop.uid}`, day.id)
    })
  })
  buildPlanRouteProjection(state.days).segments.forEach((segment) => result.set(`segment:${segmentExpenseOwnerId(segment.from.stop.uid, segment.to.stop.placeId)}`, segment.ownerDayId))
  return result
}

function missingCostLines(state: PersistedPlannerState, places: Record<string, Place>, manualExpenses: ExpenseItem[], warnings: string[]): BudgetLine[] {
  const lines: BudgetLine[] = []
  const placeOwners = new Set(manualExpenses.filter((item) => item.ownerType === 'place').map((item) => item.ownerId))
  const stopOwners = new Set(manualExpenses.filter((item) => item.ownerType === 'stop').map((item) => item.ownerId))
  const segmentOwners = new Set(manualExpenses.filter((item) => item.ownerType === 'segment').map((item) => item.ownerId))
  state.days.forEach((day) => {
    day.stops.forEach((stop) => {
      const place = places[stop.placeId]
      const category = place?.category === 'lodging' ? 'lodging' : place?.category === 'food' ? 'meal' : ['attraction', 'nature', 'culture', 'viewpoint'].includes(place?.category ?? '') ? 'ticket' : null
      if (category && !stopOwners.has(stop.uid) && !placeOwners.has(stop.placeId)) {
        lines.push({ id: `missing-stop-${stop.uid}`, name: `${place?.name ?? stop.placeId}费用尚未说明`, category, ownerType: 'derived', ownerId: stop.uid, min: 0, expected: 0, max: 0, status: 'unknown', source: 'calculated', sourceLabel: '请录入价格或明确标记为免费', dayId: day.id })
      }
    })
  })
  buildPlanRouteProjection(state.days).segments.forEach((segment) => {
    const stop = segment.from.stop
    const next = segment.to.stop
    const mode = transportModeOf(stop.transportMode)
    const ownerId = segmentExpenseOwnerId(stop.uid, next.placeId)
    if (mode !== 'driving' && mode !== 'walking' && !segmentOwners.has(ownerId)) {
      const categoryByMode: Partial<Record<typeof mode, ExpenseCategory>> = { cycling: 'rental', transit: 'transit', train: 'train', flight: 'flight', ferry: 'ferry' }
      lines.push({ id: `missing-segment-${ownerId}`, name: `${places[stop.placeId]?.name ?? stop.placeId} → ${places[next.placeId]?.name ?? next.placeId} ${categoryByMode[mode] ? expenseCategoryMeta[categoryByMode[mode]!].label : '交通'}尚未核价`, category: categoryByMode[mode] ?? 'other', ownerType: 'derived', ownerId, min: 0, expected: 0, max: 0, status: 'unknown', source: 'calculated', sourceLabel: '请填写实际票价或费用区间', dayId: segment.ownerDayId })
    }
  })
  if (lines.length) warnings.push(`还有 ${lines.length} 个行程环节尚未录入费用或标记免费`)
  return lines
}

function drivingLines(state: PersistedPlannerState, places: Record<string, Place>, routeCache: RouteCache, settings: BudgetSettings, manualExpenses: ExpenseItem[], warnings: string[]): BudgetLine[] {
  const lines: BudgetLine[] = []
  const drivingSegments = buildPlanRouteProjection(state.days).segments.map((segment) => ({ day: segment.to.day, stop: segment.from.stop, next: segment.to.stop })).filter(({ stop }) => transportModeOf(stop.transportMode) === 'driving')
  if (!drivingSegments.length) return lines
  const vehicle = settings.vehicle
  if (!vehicle.enabled) {
    warnings.push(`存在 ${drivingSegments.length} 段自驾路线，尚未启用车辆成本计算`)
    return lines
  }
  if (vehicle.consumptionPer100Km <= 0 || vehicle.energyUnitPrice <= 0) warnings.push('车辆能耗或能源单价尚未完整配置')

  drivingSegments.forEach(({ day, stop, next }) => {
    const route = routeInfo(stop, next, places, routeCache)
    const fromName = places[stop.placeId]?.name ?? stop.placeId
    const toName = places[next.placeId]?.name ?? next.placeId
    const segmentOwner = segmentExpenseOwnerId(stop.uid, next.placeId)
    const manualCategories = new Set(manualExpenses.filter((item) => item.ownerType === 'segment' && item.ownerId === segmentOwner).map((item) => item.category))
    const multiplier = vehicle.vehicleCount
    const energy = route.km / 100 * vehicle.consumptionPer100Km * vehicle.energyUnitPrice * multiplier
    const other = route.km * vehicle.perKmOther * multiplier
    const energyCategory: ExpenseCategory = vehicle.energyType === 'electric' ? 'charging' : 'fuel'
    if ((energy > 0 || other > 0) && !manualCategories.has(energyCategory)) {
      lines.push({
        id: `derived-energy-${stop.uid}`,
        name: `${fromName} → ${toName} ${vehicle.energyType === 'electric' ? '充电费' : '油费'}`,
        category: energyCategory,
        ownerType: 'derived', ownerId: segmentOwner, min: energy + other, expected: energy + other, max: energy + other,
        status: 'estimated', source: 'calculated',
        sourceLabel: `${route.km} km × ${vehicle.consumptionPer100Km}${vehicle.energyType === 'electric' ? ' kWh' : ' L'}/100km × ¥${vehicle.energyUnitPrice}${vehicle.vehicleCount > 1 ? ` × ${vehicle.vehicleCount}辆` : ''}${other > 0 ? ` + ${route.km} km × ¥${vehicle.perKmOther}附加成本${vehicle.vehicleCount > 1 ? ` × ${vehicle.vehicleCount}辆` : ''}` : ''}`,
        dayId: day.id,
      })
    }
    if (vehicle.includeMapTolls && !manualCategories.has('toll')) {
      const routeKey = transportRouteCacheKey(stop.placeId, next.placeId, 'driving')
      const selectedToll = stop.selectedRoute?.mode === 'driving' && stop.selectedRoute.toPlaceId === next.placeId ? stop.selectedRoute.toll : undefined
      const toll = selectedToll ?? routeCache[routeKey]?.[2]
      if (Number.isFinite(toll)) {
        const tollTotal = Math.max(0, Number(toll)) * vehicle.vehicleCount
        lines.push({ id: `derived-toll-${stop.uid}`, name: `${fromName} → ${toName} 高速 / 路桥费`, category: 'toll', ownerType: 'derived', ownerId: segmentOwner, min: tollTotal, expected: tollTotal, max: tollTotal, status: 'estimated', source: 'map-route', sourceLabel: `地图驾车路线估算${vehicle.vehicleCount > 1 ? ` × ${vehicle.vehicleCount}辆` : ''}`, dayId: day.id })
      } else {
        warnings.push(`${fromName} → ${toName} 尚未取得高速 / 路桥费估算`)
      }
    }
  })
  return lines
}

function selectedRouteFareLines(state: PersistedPlannerState, places: Record<string, Place>, manualExpenses: ExpenseItem[], participantCount: number): BudgetLine[] {
  const lines: BudgetLine[] = []
  buildPlanRouteProjection(state.days).segments.forEach((segment) => {
    const stop = segment.from.stop
    const next = segment.to.stop
    const route = stop.selectedRoute
    if (!route || route.cost == null || route.cost < 0) return
    const ownerId = segmentExpenseOwnerId(stop.uid, next.placeId)
    const hasManualFare = manualExpenses.some((item) => item.ownerType === 'segment' && item.ownerId === ownerId && ['transit', 'train', 'flight', 'ferry', 'taxi'].includes(item.category))
    if (hasManualFare) return
    const total = route.cost * Math.max(1, participantCount)
    lines.push({ id: `derived-route-fare-${stop.uid}`, name: `${places[stop.placeId]?.name ?? stop.placeId} → ${places[next.placeId]?.name ?? next.placeId} 公共交通票价`, category: 'transit', ownerType: 'derived', ownerId, min: total, expected: total, max: total, status: 'estimated', source: 'map-route', sourceLabel: `地图公共交通估算 ¥${route.cost}/人 × ${Math.max(1, participantCount)}人`, dayId: segment.ownerDayId })
  })
  return lines
}

export function calculateBudgetSummary(state: PersistedPlannerState, places: Record<string, Place>, routeCache: RouteCache, participantCount = 1): BudgetSummary {
  const budget = normalizeBudgetState(state.budget)
  const ownerDays = ownerDayMap(state)
  const warnings: string[] = []
  const validExpenses = budget.expenses.filter((item) => item.ownerType === 'plan'
    || (item.ownerType === 'place' && state.known.includes(item.ownerId))
    || ownerDays.has(`${item.ownerType}:${item.ownerId}`))
  const manualLines = validExpenses.map((item) => manualLine(item, ownerDays.get(`${item.ownerType}:${item.ownerId}`)))
  const missingLines = missingCostLines(state, places, validExpenses, warnings)
  const lines = [...manualLines, ...drivingLines(state, places, routeCache, budget.settings, validExpenses, warnings), ...selectedRouteFareLines(state, places, validExpenses, participantCount), ...missingLines]
  const unknownCount = lines.filter((line) => line.status === 'unknown').length
  if (unknownCount) warnings.push(`还有 ${unknownCount} 项费用价格未知`)
  const pricedCount = lines.length - unknownCount
  const completeness = lines.length ? Math.round(pricedCount / lines.length * 100) : 0
  const subtotalMin = lines.reduce((sum, line) => sum + line.min, 0)
  const subtotalExpected = lines.reduce((sum, line) => sum + line.expected, 0)
  const subtotalMax = lines.reduce((sum, line) => sum + line.max, 0)
  const contingency = subtotalExpected * budget.settings.contingencyRate
  const totalMin = subtotalMin * (1 + budget.settings.contingencyRate)
  const totalExpected = subtotalExpected + contingency
  const totalMax = subtotalMax * (1 + budget.settings.contingencyRate)
  const confirmed = lines.filter((line) => line.status === 'confirmed' || line.status === 'paid').reduce((sum, line) => sum + line.expected, 0)
  const paid = lines.filter((line) => line.status === 'paid').reduce((sum, line) => sum + line.expected, 0)
  const dayTotals: Record<string, number> = {}
  lines.forEach((line) => { if (line.dayId) dayTotals[line.dayId] = (dayTotals[line.dayId] ?? 0) + line.expected })
  const limit = budget.settings.limit
  if (limit != null && totalExpected > limit) warnings.push(`预计费用超过预算上限 ${formatMoney(totalExpected - limit)}`)
  return {
    subtotalMin, subtotalExpected, subtotalMax, contingency, totalMin, totalExpected, totalMax, confirmed, paid,
    perPerson: totalExpected / Math.max(1, participantCount),
    remaining: limit == null ? null : limit - totalExpected,
    unknownCount, completeness, warnings, lines, dayTotals,
  }
}

export function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function createExpenseDraft(ownerType: ExpenseItem['ownerType'], ownerId: string, category: ExpenseCategory, name = expenseCategoryMeta[category].label): ExpenseItem {
  return {
    id: `expense_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    ownerType, ownerId, category, name, quantity: 1, unitPrice: null, minAmount: null, maxAmount: null,
    billingUnit: expenseCategoryMeta[category].unit, status: 'estimated', source: 'manual', updatedAt: new Date().toISOString(),
  }
}
