import { describe, expect, it } from 'vitest'
import { encodeRoutePath } from '../polyline'
import { calculateBudgetSummary, createExpenseDraft, defaultBudgetState, normalizeBudgetState, segmentExpenseOwnerId } from '../budget'
import { basePlaces, createStop } from '../data'
import { createEmptyPlannerState } from '../plans'
import { transportRouteCacheKey } from '../transport'

function stateWithRoute() {
  const state = createEmptyPlannerState('2026-10-01T08:00:00+08:00', '2026-10-01T20:00:00+08:00')
  state.known = ['cq', 'cd']
  state.days[0].stops = [createStop('cq', 0), createStop('cd', 0)]
  state.budget = defaultBudgetState()
  return state
}

describe('travel budget calculation', () => {
  it('combines confirmed place costs with calculated driving energy and map tolls', () => {
    const state = stateWithRoute()
    state.budget!.settings.limit = 500
    state.budget!.settings.contingencyRate = 0.1
    state.budget!.settings.vehicle = {
      enabled: true, energyType: 'fuel', vehicleCount: 1,
      consumptionPer100Km: 8, energyUnitPrice: 8, perKmOther: 0, includeMapTolls: true,
    }
    const ticket = createExpenseDraft('place', 'cd', 'ticket', '测试门票')
    ticket.quantity = 2
    ticket.unitPrice = 100
    ticket.status = 'confirmed'
    state.budget!.expenses.push(ticket)
    const routeCache = { [transportRouteCacheKey('cq', 'cd', 'driving')]: [100, 60, 20] as [number, number, number] }

    const summary = calculateBudgetSummary(state, basePlaces, routeCache, 2)

    expect(summary.subtotalExpected).toBe(284)
    expect(summary.contingency).toBeCloseTo(28.4)
    expect(summary.totalExpected).toBeCloseTo(312.4)
    expect(summary.confirmed).toBe(200)
    expect(summary.perPerson).toBeCloseTo(156.2)
    expect(summary.remaining).toBeCloseTo(187.6)
    expect(summary.lines.some((line) => line.category === 'fuel' && line.expected === 64)).toBe(true)
    expect(summary.lines.some((line) => line.category === 'toll' && line.expected === 20)).toBe(true)
  })

  it('uses selected route distance and toll for driving costs', () => {
    const state = stateWithRoute()
    state.budget!.settings.vehicle = { enabled: true, energyType: 'fuel', vehicleCount: 1, consumptionPer100Km: 10, energyUnitPrice: 8, perKmOther: 0, includeMapTolls: true }
    state.days[0].stops[0].selectedRoute = {
      id: 'selected', providerId: 'amap', providerName: '高德地图', fromPlaceId: 'cq', toPlaceId: 'cd', mode: 'driving', strategyLabel: '收费较少', distanceKm: 80, durationMinutes: 70, toll: 5, encodedPath: encodeRoutePath([[106.55, 29.56], [104.06, 30.57]]), queriedAt: '2026-09-16T00:00:00.000Z', selectedAt: '2026-09-16T00:00:00.000Z',
    }
    const summary = calculateBudgetSummary(state, basePlaces, { [transportRouteCacheKey('cq', 'cd', 'driving')]: [100, 60, 20] }, 1)
    expect(summary.lines.find((line) => line.category === 'fuel')?.expected).toBe(64)
    expect(summary.lines.find((line) => line.category === 'toll')?.expected).toBe(5)
  })

  it('adds a selected public-transit fare per participant', () => {
    const state = stateWithRoute()
    state.days[0].stops[0].transportMode = 'transit'
    state.days[0].stops[0].selectedRoute = {
      id: 'transit', providerId: 'amap', providerName: '高德地图', fromPlaceId: 'cq', toPlaceId: 'cd', mode: 'transit', strategyLabel: '少换乘', distanceKm: 12, durationMinutes: 45, cost: 8, transferCount: 1, walkingDistanceKm: 0.8, encodedPath: encodeRoutePath([[106.55, 29.56], [104.06, 30.57]]), queriedAt: '2026-09-16T00:00:00.000Z', selectedAt: '2026-09-16T00:00:00.000Z',
    }
    const summary = calculateBudgetSummary(state, basePlaces, {}, 3)
    const fare = summary.lines.find((line) => line.id.startsWith('derived-route-fare'))
    expect(fare?.expected).toBe(24)
    expect(fare?.source).toBe('map-route')
  })

  it('uses a manual segment charge instead of double-counting an automatic toll', () => {
    const state = stateWithRoute()
    state.budget!.settings.vehicle = { enabled: true, energyType: 'fuel', vehicleCount: 1, consumptionPer100Km: 8, energyUnitPrice: 8, perKmOther: 0, includeMapTolls: true }
    const firstStop = state.days[0].stops[0]
    const toll = createExpenseDraft('segment', segmentExpenseOwnerId(firstStop.uid, 'cd'), 'toll', '实际高速费')
    toll.unitPrice = 10
    toll.status = 'confirmed'
    state.budget!.expenses.push(toll)
    const routeCache = { [transportRouteCacheKey('cq', 'cd', 'driving')]: [100, 60, 20] as [number, number, number] }

    const summary = calculateBudgetSummary(state, basePlaces, routeCache, 1)
    const tollLines = summary.lines.filter((line) => line.category === 'toll')
    expect(tollLines).toHaveLength(1)
    expect(tollLines[0].expected).toBe(10)
    expect(tollLines[0].source).toBe('manual')
  })

  it('keeps unknown prices separate from free items and reports incomplete vehicle settings', () => {
    const state = stateWithRoute()
    const unknown = createExpenseDraft('place', 'cd', 'ticket', '价格待确认')
    unknown.status = 'unknown'
    const free = createExpenseDraft('place', 'cq', 'ticket', '免费参观')
    free.status = 'free'
    state.budget!.expenses.push(unknown, free)

    const summary = calculateBudgetSummary(state, basePlaces, {}, 1)

    expect(summary.unknownCount).toBe(1)
    expect(summary.totalExpected).toBe(0)
    expect(summary.warnings).toContain('还有 1 项费用价格未知')
    expect(summary.warnings.some((warning) => warning.includes('尚未启用车辆成本计算'))).toBe(true)
  })

  it('normalizes plans created before budget support', () => {
    const normalized = normalizeBudgetState(undefined)
    expect(normalized.settings.currency).toBe('CNY')
    expect(normalized.settings.vehicle.vehicleCount).toBe(1)
    expect(normalized.expenses).toEqual([])
  })
})
