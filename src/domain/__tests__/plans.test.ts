import { describe, expect, it } from 'vitest'
import { createBaseDays } from '../data'
import { createDaysFromRange, createEmptyPlannerState, createPlanRecord, formatPlanDateTime, normalizeParticipants, normalizePlaceAddedAt, reconcilePlannerRange, removedPlannerDays } from '../plans'
import { createExpenseDraft } from '../budget'
import type { PersistedPlannerState } from '../types'

describe('plan metadata and date range', () => {
  it('creates one Day per calendar day and keeps exact endpoint minutes', () => {
    const days = createDaysFromRange('2026-11-01T08:09:10+08:00', '2026-11-03T20:21:22+08:00')
    expect(days).toHaveLength(3)
    expect(days.map((day) => day.date)).toEqual(['11/01', '11/02', '11/03'])
    expect(days[0].start).toBe(8 * 60 + 9)
    expect(days[2].end).toBe(20 * 60 + 21)
  })

  it('migrates legacy participant names and keeps richer participant details', () => {
    expect(normalizeParticipants(['张三', '李四'])).toEqual([
      expect.objectContaining({ name: '张三', age: null }),
      expect.objectContaining({ name: '李四', age: null }),
    ])
    expect(normalizeParticipants([{ id: 'p1', name: '儿童', age: 8, note: '儿童票' }])).toEqual([
      { id: 'p1', name: '儿童', age: 8, note: '儿童票' },
    ])
  })

  it('creates a plan with its initial budget limit', () => {
    const record = createPlanRecord({
      name: '预算计划', startAt: '2026-10-01T08:00:00+08:00', endAt: '2026-10-03T20:00:00+08:00',
      participants: [{ id: 'p1', name: '张三', age: 32 }], budgetLimit: 12000,
    })
    expect(record.metadata.participants[0]).toEqual({ id: 'p1', name: '张三', age: 32, note: undefined })
    expect(record.plannerState.budget?.settings.limit).toBe(12000)
  })

  it('creates a new plan without carrying demo places into the unarranged pool', () => {
    const state = createEmptyPlannerState('2026-10-01T08:00:00+08:00', '2026-10-03T20:00:00+08:00')
    expect(state.known).toEqual([])
    expect(state.customPlaces).toEqual({})
    expect(state.placeAddedAt).toEqual({})
    expect(state.days.flatMap((day) => day.stops)).toEqual([])
  })

  it('formats plan timestamps with seconds', () => {
    expect(formatPlanDateTime('2026-11-01T00:09:10.000Z')).toMatch(/2026\/11\/01 08:09:10|2026\/11\/01 00:09:10/)
  })

  it('fills missing place added times while preserving existing values', () => {
    const values = normalizePlaceAddedAt(['first', 'second', 'third'], { second: 12345 })
    expect(values.second).toBe(12345)
    expect(values.first).toBeLessThan(values.third)
    expect(Object.keys(values)).toEqual(['first', 'second', 'third'])
  })

  it('preserves days by calendar date when the start date changes', () => {
    const state: PersistedPlannerState = {
      days: createBaseDays(),
      selectedDay: 'd2',
      selectedPlace: null,
      poolOpen: true,
      satellite: false,
      categoryFilter: 'all',
      customPlaces: {},
      known: [],
      placeAddedAt: {},
      demo: 2,
    }
    const oldDay2PlaceIds = state.days[1].stops.map((stop) => stop.placeId)
    const reconciled = reconcilePlannerRange(state, '2026-10-03T08:00:00+08:00', '2026-10-07T20:00:00+08:00', '2026-10-02T08:00:00+08:00')
    expect(reconciled.days).toHaveLength(5)
    expect(reconciled.days[0].date).toBe('10/03')
    expect(reconciled.days[0].stops.map((stop) => stop.placeId)).toEqual(oldDay2PlaceIds)
    expect(reconciled.selectedDay).toBe('d1')
  })

  it('keeps day expenses attached to the same calendar date when the range shifts', () => {
    const state = createEmptyPlannerState('2026-10-02T08:00:00+08:00', '2026-10-04T20:00:00+08:00')
    const expense = createExpenseDraft('day', 'd2', 'lodging', '10 月 3 日住宿')
    expense.unitPrice = 500
    state.budget!.expenses.push(expense)

    const reconciled = reconcilePlannerRange(state, '2026-10-03T08:00:00+08:00', '2026-10-04T20:00:00+08:00', '2026-10-02T08:00:00+08:00')
    expect(reconciled.budget?.expenses[0].ownerId).toBe('d1')
  })

  it('detects removed dates from either side of the range', () => {
    const state = { ...createEmptyPlannerState('2026-10-02T08:00:00+08:00', '2026-10-07T20:00:00+08:00'), days: createBaseDays() }
    const removedFromStart = removedPlannerDays(state, '2026-10-02T08:00:00+08:00', '2026-10-03T08:00:00+08:00', '2026-10-07T20:00:00+08:00')
    const removedFromEnd = removedPlannerDays(state, '2026-10-02T08:00:00+08:00', '2026-10-02T08:00:00+08:00', '2026-10-06T20:00:00+08:00')
    expect(removedFromStart.map((day) => day.date)).toEqual(['10/02'])
    expect(removedFromEnd.map((day) => day.date)).toEqual(['10/07'])
  })
})
