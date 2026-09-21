import { expect, test } from '@playwright/test'

test('shows a visible recycle-bin entry after deleting a plan and allows restoring it', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('interactiveTravel.locale.v1', 'zh-CN')
    sessionStorage.clear()
  })
  await page.goto('/')
  await page.getByRole('button', { name: '查看川西示例' }).click()
  await page.getByRole('button', { name: /全部计划/ }).click()

  const card = page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' })
  await expect(card).toBeVisible()
  await card.locator('.plan-delete-button').click()
  await page.getByRole('button', { name: '移入回收站' }).click()

  await expect(page.locator('.home-recycle-entry')).toContainText('1')
  await page.locator('.home-recycle-entry').click()
  await expect(page.getByRole('heading', { name: '计划回收站' })).toBeVisible()
  const recycled = page.locator('.plan-history-section.recycle article').filter({ hasText: '川西 6 日自驾' })
  await expect(recycled).toBeVisible()
  await recycled.getByRole('button', { name: '恢复' }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await expect(page.locator('.home-recycle-entry')).toHaveCount(0)
  await expect(page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' })).toBeVisible()
})
