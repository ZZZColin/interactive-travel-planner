import { expect, test } from '@playwright/test'

test('switches the existing interface between Chinese and English and persists the locale', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('i18n-test-initialized')) {
      localStorage.clear()
      localStorage.setItem('interactiveTravel.locale.v1', 'zh-CN')
      sessionStorage.setItem('i18n-test-initialized', '1')
    }
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(page.getByRole('heading', { name: '我的旅行计划' })).toBeVisible()

  await page.locator('.locale-switcher').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByRole('heading', { name: 'My trips' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Map setup' })).toBeVisible()
  await expect(page).toHaveTitle(/TripPath/)

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
  await expect(page.getByRole('heading', { name: 'My trips' })).toBeVisible()

  await page.locator('.locale-switcher').click()
  await expect(page.getByRole('heading', { name: '我的旅行计划' })).toBeVisible()
})


test('translates the planner shell while preserving trip and place content', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('interactiveTravel.locale.v1', 'en-US')
    sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'View sample trip' }).click()
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.getByRole('button', { name: /All trips/ })).toBeVisible()
  await expect(page.getByText('Trip looks feasible', { exact: true })).toBeVisible()
  await expect(page.getByText('Unscheduled places', { exact: true })).toBeVisible()
})
