export const PLAN_QUERY_KEY = 'plan'

export type PlanNavigationMode = 'push' | 'replace' | 'none'

export function planIdFromUrl(value: string | URL): string | null {
  const url = value instanceof URL ? value : new URL(value, 'http://localhost')
  const planId = url.searchParams.get(PLAN_QUERY_KEY)?.trim() ?? ''
  return planId || null
}

export function urlWithPlanId(value: string | URL, planId: string | null): URL {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(value, 'http://localhost')
  if (planId?.trim()) url.searchParams.set(PLAN_QUERY_KEY, planId.trim())
  else url.searchParams.delete(PLAN_QUERY_KEY)
  return url
}
