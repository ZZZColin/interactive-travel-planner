import { describe, expect, it } from 'vitest'
import { planIdFromUrl, urlWithPlanId } from '../planUrl'

describe('plan detail URL', () => {
  it('reads a stable plan identifier from the query string', () => {
    expect(planIdFromUrl('https://tp.example.com/?plan=plan_abc')).toBe('plan_abc')
    expect(planIdFromUrl('https://tp.example.com/')).toBeNull()
  })

  it('adds and removes the plan identifier without losing other query parameters or hash', () => {
    const detail = urlWithPlanId('https://tp.example.com/?demo=1#map', 'plan_abc')
    expect(detail.toString()).toBe('https://tp.example.com/?demo=1&plan=plan_abc#map')
    expect(urlWithPlanId(detail, null).toString()).toBe('https://tp.example.com/?demo=1#map')
  })
})
