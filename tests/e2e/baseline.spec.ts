import { expect, test, type Locator, type Page } from '@playwright/test'

const amapKey = process.env.AMAP_TEST_KEY
const amapSecurityCode = process.env.AMAP_TEST_SECURITY_CODE

if (!amapKey || !amapSecurityCode) {
  throw new Error('E2E requires AMAP_TEST_KEY and AMAP_TEST_SECURITY_CODE environment variables')
}

async function installMockAi(page: Page, draft: unknown): Promise<void> {
  const profile = {
    id: 'mock-ai',
    name: '测试 AI 接入实例',
    presetId: null,
    protocol: 'openai-chat-completions',
    baseUrl: 'https://mock-ai.local/v1',
    models: ['mock-travel-model', 'vendor-vision-pro', 'custom-no-keyword-201'],
    model: 'mock-travel-model',
    timeoutSeconds: 30,
    maxOutputTokens: 3000,
  }
  await page.addInitScript(({ profile }) => {
    localStorage.setItem('interactiveTravel.ai.providers.v1', JSON.stringify({ profiles: [profile], activeId: profile.id }))
    sessionStorage.setItem('interactiveTravel.ai.secrets.session.v1', JSON.stringify({ [profile.id]: 'test-key' }))
  }, { profile })
  await page.evaluate(({ profile }) => {
    localStorage.setItem('interactiveTravel.ai.providers.v1', JSON.stringify({ profiles: [profile], activeId: profile.id }))
    sessionStorage.setItem('interactiveTravel.ai.secrets.session.v1', JSON.stringify({ [profile.id]: 'test-key' }))
  }, { profile })
  await page.route('https://mock-ai.local/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }),
    })
  })
}


async function installMockRouteOptimizationAi(page: Page): Promise<void> {
  const profile = {
    id: 'mock-route-ai', name: '测试路线 AI', presetId: null, protocol: 'openai-chat-completions',
    baseUrl: 'https://mock-route-ai.local/v1', models: ['mock-route-model'], model: 'mock-route-model',
    timeoutSeconds: 30, contextWindowTokens: 128000, maxInputTokens: 120000, maxOutputTokens: 4000,
  }
  await page.addInitScript(({ profile }) => {
    localStorage.setItem('interactiveTravel.ai.providers.v1', JSON.stringify({ profiles: [profile], activeId: profile.id }))
    sessionStorage.setItem('interactiveTravel.ai.secrets.session.v1', JSON.stringify({ [profile.id]: 'test-route-key' }))
    const records = JSON.parse(localStorage.getItem('interactiveTravel.plans.continuous.v1') ?? '[]')
    if (records[0]) {
      records[0].routeCache = {
        ...records[0].routeCache,
        'transport:driving:cq>cd': [300, 210],
        'transport:driving:cd>sig': [220, 250],
        'transport:driving:sig>shuang': [18, 30],
        'transport:driving:shuang>hotel': [12, 20],
        'transport:driving:hotel>danba': [145, 200],
        'transport:driving:cd>shuang': [215, 242],
        'transport:driving:shuang>sig': [18, 30],
        'transport:driving:sig>hotel': [9, 15],
      }
      localStorage.setItem('interactiveTravel.plans.continuous.v1', JSON.stringify(records))
    }
  }, { profile })
  await page.route('https://mock-route-ai.local/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
      return
    }
    const body = route.request().postDataJSON() as any
    const content = body?.messages?.[1]?.content
    const userText = Array.isArray(content) ? String(content.find((item: any) => item.type === 'text')?.text ?? '') : String(content ?? '')
    const jsonStart = userText.indexOf('{')
    const input = JSON.parse(userText.slice(jsonStart))
    const dayArrangements = input.days.map((day: any) => ({ dayId: day.dayId, stopUids: day.stops.map((stop: any) => stop.stopUid) }))
    const day2 = input.days.find((day: any) => day.dayId === 'd2')
    const proposedDay2 = dayArrangements.find((day: any) => day.dayId === 'd2')
    if (day2 && proposedDay2) {
      const byPlace = Object.fromEntries(day2.stops.map((stop: any) => [stop.placeId, stop.stopUid]))
      proposedDay2.stopUids = [byPlace.cd, byPlace.shuang, byPlace.sig, byPlace.hotel]
    }
    const result = {
      summary: 'Day 2 存在折返，可以调整双桥沟和四姑娘山镇的先后顺序。',
      issues: [{ category: 'detour', severity: 'attention', title: 'Day 2 存在折返', detail: '两个相邻地点的顺序可以进一步验证。', dayIds: ['d2'], stopUids: proposedDay2?.stopUids ?? [] }],
      dayArrangements,
      returnToPoolStopUids: [],
      reasons: ['将 Day 2 的地点顺序调整后交给高德地图重新验证。'],
      cautions: ['地图验证结果优先于 AI 的距离判断。'],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }) })
  })
}

test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.title.includes('prompts for engine-specific configuration')) {
    await page.addInitScript(({ key, securityJsCode }) => {
      localStorage.setItem('interactiveTravel.map.amap.config', JSON.stringify({ key, securityJsCode }))
    }, { key: amapKey, securityJsCode: amapSecurityCode })
  }
  await page.goto('/?scene=2')
  await expect(page.locator('.continuous-itinerary')).toBeVisible()
})


test('prompts for engine-specific configuration on first use', async ({ page }) => {
  await expect(page.getByText('配置高德地图后开始规划')).toBeVisible()
  await expect(page.locator('.map-config-empty').getByRole('button', { name: '配置高德地图', exact: true })).toBeVisible()
  await page.locator('.map-config-empty').getByRole('button', { name: '配置高德地图', exact: true }).click()
  await expect(page.getByRole('heading', { name: '高德地图配置' })).toBeVisible()
  await expect(page.getByText('这组配置只属于高德地图引擎')).toBeVisible()
  await expect(page.getByLabel('Web 服务 Key（分享地图，可选）')).toBeVisible()
})

test('renders the baseline planner and AMap markers', async ({ page }) => {
  await expect(page.locator('.daytab.active')).toContainText('Day 2')
  await expect(page.locator('.stopcard')).toHaveCount(6)
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 15_000 })
  await expect(page.locator('.statuspill')).toContainText('计划可行')
  await expect(page.getByText('准备完成', { exact: true })).toHaveCount(0)
  await expect(page.locator('.route-options-trigger').first()).toContainText('路线方案')
})

test('draws the complete continuous route with global stop numbers', async ({ page }) => {
  test.slow()
  await expect(page.locator('.map-route-info')).toHaveCount(5, { timeout: 40_000 })
  await expect(page.locator('.travel-marker[data-place="cq"]')).toHaveAttribute('data-order', '1')
  await expect(page.locator('.travel-marker[data-place="cd"]')).toHaveAttribute('data-order', '2')
  await expect(page.locator('.travel-marker[data-place="sig"]')).toHaveAttribute('data-order', '3')
  await expect(page.locator('.travel-marker[data-place="shuang"]')).toHaveAttribute('data-order', '4')
  await expect(page.locator('.travel-marker[data-place="hotel"]')).toHaveAttribute('data-order', '5')
  await expect(page.locator('.travel-marker[data-place="danba"]')).toHaveAttribute('data-order', '6')
  await expect(page.locator('.cross-day-segment')).toHaveCount(2)
  await expect(page.locator('.cross-day-segment').first()).toContainText('成都酒店 → 四姑娘山镇')
  await expect(page.locator('.floating-route-summary')).toContainText('全程路线')
  await page.locator('.daytab').filter({ hasText: 'Day 3' }).click()
  await expect(page.locator('.daytab.active')).toContainText('Day 3')
  await expect(page.locator('.continuous-day-section.active')).toContainText('Day 3')
  await expect(page.locator('.map-route-info')).toHaveCount(5, { timeout: 30_000 })
})


test('renders the existing itinerary in the tokenless Cesium baseline', async ({ page }) => {
  test.slow()
  await page.evaluate(() => {
    localStorage.setItem('interactiveTravel.map.cesium.config.v1', JSON.stringify({ imageryMode: 'natural-earth', useWorldTerrain: false, useOsmBuildings: false, terrainExaggeration: 1 }))
    localStorage.setItem('interactiveTravel.map.runtimeSelection.v1', JSON.stringify({ rendererId: 'cesium', placeServiceId: 'amap', routingServiceId: 'amap' }))
  })
  await page.reload()
  await expect(page.locator('.cesium-widget canvas')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.cesium-place-marker')).toHaveCount(11)
  await expect(page.locator('.cesium-place-marker-svg').first()).toBeVisible()
  await expect(page.locator('.map-provider-select')).toContainText('Cesium')
  await expect(page.getByRole('button', { name: '路况' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '卫星图' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '从地图拾取地点' })).toBeVisible()
  await expect(page.locator('.route-options-trigger').first()).toBeVisible()
  await expect(page.locator('.floating-route-summary')).toContainText('全程路线')
  await expect(page.locator('.cesium-route-badge').first()).toContainText('驾车')
  await expect(page.locator('.cesium-route-badge').first()).not.toContainText('驾 驾车')
  await page.locator('.cesium-place-marker.scheduled').first().click()
  await expect(page.locator('.floating-place-card')).toBeVisible()
})

test('runs an immersive Cesium route tour with stop introductions and playback controls', async ({ page }) => {
  test.slow()
  await page.evaluate(() => {
    localStorage.setItem('interactiveTravel.map.cesium.config.v1', JSON.stringify({ imageryMode: 'natural-earth', useWorldTerrain: false, useOsmBuildings: false, terrainExaggeration: 1 }))
    localStorage.setItem('interactiveTravel.map.runtimeSelection.v1', JSON.stringify({ rendererId: 'cesium', placeServiceId: 'amap', routingServiceId: 'amap' }))
  })
  await page.reload()
  await expect(page.locator('.cesium-widget canvas')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '漫游' }).click()
  const tour = page.locator('.cesium-tour-panel')
  await expect(tour).toBeVisible()
  await expect(page.locator('.cesium-tour-vehicle')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.floating-place-card')).toBeVisible({ timeout: 30_000 })
  await expect(tour).toHaveClass(/status-playing/, { timeout: 20_000 })
  await tour.getByRole('button', { name: '暂停' }).click()
  await expect(tour).toHaveClass(/status-paused/)
  await expect(tour.getByRole('button', { name: '0.1×' })).toBeVisible()
  await expect(tour.getByRole('button', { name: '0.25×' })).toBeVisible()
  const customSpeed = tour.getByRole('spinbutton', { name: '自定义漫游速度' })
  await customSpeed.fill('0.15')
  await customSpeed.press('Tab')
  await expect(customSpeed).toHaveValue('0.15')
  await tour.getByRole('button', { name: '2×' }).click()
  await tour.getByRole('button', { name: '继续' }).click()
  await expect(tour).toHaveClass(/status-playing/)
  await tour.getByRole('button', { name: '退出' }).click()
  await expect(tour).toHaveCount(0)
})

test('switches configured map renderers without reloading or leaving the active plan', async ({ page }) => {
  test.slow()
  await page.evaluate(() => {
    localStorage.setItem('interactiveTravel.map.cesium.config.v1', JSON.stringify({ imageryMode: 'natural-earth', useWorldTerrain: false, useOsmBuildings: false, terrainExaggeration: 1 }))
    ;(window as any).__mapSwitchSentinel = 'alive'
  })
  await page.locator('.map-provider-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: 'Cesium 3D 地球' }).click()
  await expect(page.locator('.amap-loading-card')).toContainText('正在加载Cesium 3D 地球与路线服务')
  await expect(page.locator('.cesium-widget canvas')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.map-provider-select')).toContainText('Cesium')
  expect(await page.evaluate(() => (window as any).__mapSwitchSentinel)).toBe('alive')
  await expect(page.locator('.tripname')).toContainText('川西 6 日自驾')

  await page.locator('.map-provider-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '高德地图' }).click()
  await expect(page.locator('.travel-marker').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.map-provider-select')).toContainText('高德')
  expect(await page.evaluate(() => (window as any).__mapSwitchSentinel)).toBe('alive')
  await expect(page.locator('.tripname')).toContainText('川西 6 日自驾')
})

test('edits the transport mode of a cross-day connection', async ({ page }) => {
  const segment = page.locator('.cross-day-segment').first()
  await expect(segment).toContainText('承接上一日')
  await expect(segment).toContainText('成都酒店 → 四姑娘山镇')
  await segment.locator('.transport-mode-select').click()
  await page.locator('.transport-mode-options:visible .el-select-dropdown__item').filter({ hasText: '火车' }).click()
  await expect(segment.locator('.transport-mode-select')).toContainText('火车')
  await expect(segment).toContainText('待填写用时')
  await expect(page.locator('.map-route-info[data-route-mode="train"]')).toBeVisible({ timeout: 20_000 })
})

test('uses the branded site title and application icons', async ({ page }) => {
  await expect(page).toHaveTitle('川西 6 日自驾 · 行途规划')
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/site.webmanifest')
  await page.getByRole('button', { name: '全部计划' }).click()
  await expect(page).toHaveTitle('行途规划 · 旅行路线规划器')
})

test('locates the current position from the custom map toolbar', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'], { origin: 'http://127.0.0.1:8765' })
  await context.setGeolocation({ latitude: 30.657, longitude: 104.066, accuracy: 28 })

  const locateButton = page.getByRole('button', { name: '定位当前位置' })
  await expect(locateButton).toBeEnabled({ timeout: 15_000 })
  await expect(locateButton.locator('.pi-compass')).toBeVisible()
  await locateButton.click()
  await expect(page.locator('.toast')).toContainText('已定位到当前位置', { timeout: 15_000 })
  await expect(locateButton.locator('.pi-compass')).toBeVisible()
})

test('picks map coordinates into the unarranged pool or current day', async ({ page }) => {
  const pickButton = page.getByTitle('从地图拾取地点')
  const map = page.locator('.amap-container')
  const clickMap = async (x: number, y: number) => {
    const bounds = await map.boundingBox()
    if (!bounds) throw new Error('Map bounds unavailable')
    await page.mouse.click(bounds.x + x, bounds.y + y)
    await expect(page.locator('.map-pick-card')).toBeVisible({ timeout: 15_000 })
    const select = page.locator('.map-pick-form .el-select')
    await select.click()
    await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '使用点击坐标创建地点' }).click()
  }

  await pickButton.click()
  await expect(page.locator('.map-pick-hint')).toContainText('点击地图任意位置')
  await clickMap(720, 250)
  await page.locator('.map-pick-form .el-input__inner').fill('地图拾取未安排点')
  await page.getByRole('button', { name: '加入未安排地点' }).click()
  await expect(page.locator('.poolcard').filter({ hasText: '地图拾取未安排点' })).toBeVisible()
  await expect(page.locator('.map-place-card')).toContainText('地图拾取未安排点')
  await expect(page.locator('.map-place-card .place-introduction')).toHaveCount(0, { timeout: 15_000 })

  await pickButton.click()
  await clickMap(650, 330)
  await page.locator('.map-pick-form .el-input__inner').fill('地图拾取计划点')
  await page.locator('.map-pick-actions').getByRole('button', { name: '加入 Day 2' }).click()
  await expect(page.locator('.stopcard').filter({ hasText: '地图拾取计划点' })).toBeVisible()
})

test('searches places directly from the map toolbar and adds them to a chosen destination', async ({ page }) => {
  const input = page.getByPlaceholder('搜索地点、酒店或美食')
  await expect(input).toBeVisible()
  await expect(page.getByTitle('配置高德地图')).toBeVisible()
  await expect(page.locator('.mapcontrol')).not.toContainText('配置高德地图')

  await input.fill('成都火锅')
  const results = page.locator('.map-search-result')
  await expect(results.first()).toBeVisible({ timeout: 20_000 })
  const poolName = (await results.first().locator('b').innerText()).trim()
  await expect(results.first().getByRole('button', { name: '加入未安排' })).toBeVisible()
  await expect(results.first().getByRole('button', { name: '加入当天' })).toBeVisible()
  await results.first().getByRole('button', { name: '加入未安排' }).click()
  await expect(input).toHaveValue('')
  await expect(page.locator('.poolcard').filter({ hasText: poolName })).toBeVisible()

  await input.fill('成都博物馆')
  await expect(results.first()).toBeVisible({ timeout: 20_000 })
  const dayName = (await results.first().locator('b').innerText()).trim()
  await results.first().getByRole('button', { name: '加入当天' }).click()
  await expect(page.locator('.continuous-day-section[data-day-section="d2"]')).toContainText(dayName)
})

test('searches AMap POIs without replacing the input', async ({ page }) => {
  const input = page.getByPlaceholder('搜索已有地点或高德 POI')
  await input.fill('成都火锅')
  await expect(input).toBeFocused()
  await expect(page.locator('.poollist')).toHaveCount(0)
  await expect(page.locator('.pool-guidance')).toHaveCount(0)
  await expect(page.getByText('没有本地匹配')).toHaveCount(0)
  expect((await page.locator('.pool').boundingBox())!.height).toBeLessThan(110)
  await expect(page.getByText('高德地点搜索')).toBeVisible({ timeout: 12_000 })
  await expect(page.locator('.poi-result')).toHaveCount(9)
  await page.locator('.poi-result').first().click()
  await expect(input).toHaveValue('')
  await expect(page.locator('.poollist')).toBeVisible()
})

test('drags a candidate into an empty day', async ({ page }) => {
  await page.getByRole('button', { name: '收集地点' }).click()
  const candidate = page.locator('.poolcard').filter({ hasText: '重庆' })
  const target = page.locator('.emptyday')
  await candidate.dragTo(target)
  await expect(page.locator('.stopcard')).toHaveCount(1)
  await expect(page.getByText('1 / 11 个地点已安排')).toBeVisible()
})

test('shows cached daily weather on itinerary stops and supports provider selection', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('interactiveTravel.weather.provider.v1', 'amap')
    const fetchedAt = Date.now()
    localStorage.setItem('interactiveTravel.weather.cache.v1', JSON.stringify({
      'amap|shuang|2026-10-03': {
        status: 'available', fetchedAt,
        result: { status: 'available', providerId: 'amap', providerName: '高德天气', date: '2026-10-03', condition: '小雨', kind: 'rain', minTemp: 8, maxTemp: 14, dayWind: '东', dayPower: '3', reportedAt: '2026-10-03 08:00:00', fetchedAt },
      },
    }))
  })
  await page.reload()

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await expect(attraction.locator('.weather-badge')).toContainText('小雨')
  await expect(attraction.locator('.weather-badge')).toContainText('8~14°')
  await expect(attraction).toHaveClass(/weather-rain/)
  await expect(page.locator('.stopcard[data-place="sig"] .weather-badge')).toHaveCount(0)
  await expect(page.locator('.weather-range-banner')).toContainText('最长预报 4 天')
  await expect(page.locator('.weather-range-banner')).toContainText('超出范围')
  const rainyBackground = await attraction.evaluate((element) => getComputedStyle(element).backgroundImage)
  expect(rainyBackground).toContain('linear-gradient')

  await page.locator('.header-weather-button').click()
  const modal = page.locator('.weather-settings-modal')
  await expect(modal).toContainText('高德天气')
  await expect(modal).toContainText('最长 4 天')
  await modal.locator('.el-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '关闭天气展示' }).click()
  await modal.getByRole('button', { name: '保存天气服务' }).click()
  await expect(attraction.locator('.weather-badge')).toHaveCount(0)
  await expect(page.locator('.weather-range-banner')).toHaveCount(0)
})

test('uses Azure Maps Weather for a 45-day itinerary forecast', async ({ page }) => {
  test.slow()
  let requestCount = 0
  await page.route('https://atlas.microsoft.com/weather/**', async (route) => {
    requestCount += 1
    expect(route.request().headers()['subscription-key']).toBe('test-subscription-key')
    expect(route.request().url()).toContain('duration=45')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: { startDate: '2026-09-15T00:00:00+08:00' },
        forecasts: ['02', '03', '04', '05', '06', '07'].map((day) => ({
          date: `2026-10-${day}T07:00:00+08:00`,
          temperature: { minimum: { value: 7 }, maximum: { value: 16 } },
          day: { iconPhrase: '阵雨', precipitationType: 'Rain', wind: { direction: { localizedDescription: '东北' }, speed: { value: 18 } } },
        })),
      }),
    })
  })

  await page.locator('.header-weather-button').click()
  const modal = page.locator('.weather-settings-modal')
  const providerSelect = modal.locator('.field').filter({ hasText: '天气服务商' }).locator('.el-select')
  await providerSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: 'Azure Maps Weather' }).click()
  await modal.locator('.field').filter({ hasText: 'Subscription Key' }).locator('.el-input__inner').fill('test-subscription-key')
  await expect(modal).toContainText('最长 45 天')
  await modal.getByRole('button', { name: '保存天气服务' }).click()

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await expect(attraction.locator('.weather-badge')).toContainText('阵雨', { timeout: 15_000 })
  await expect(attraction.locator('.weather-badge')).toContainText('7~16°')
  expect(requestCount).toBeGreaterThan(0)
  await expect(page.locator('.weather-range-banner')).toHaveCount(0)

  await page.locator('.header-weather-button').click()
  await expect(modal).toContainText('Azure Maps Weather')
  await expect(modal).toContainText('最长 45 天')
  const keyLayout = await modal.locator('.azure-subscription-field').evaluate((element) => {
    const wrapper = element.querySelector('.el-input__wrapper')!.getBoundingClientRect()
    const input = element.querySelector('.el-input__inner')!.getBoundingClientRect()
    const suffix = element.querySelector('.el-input__suffix')!.getBoundingClientRect()
    return { wrapperWidth: wrapper.width, inputRight: input.right, suffixLeft: suffix.left }
  })
  expect(keyLayout.wrapperWidth).toBeGreaterThan(250)
  expect(keyLayout.inputRight).toBeLessThanOrEqual(keyLayout.suffixLeft + 1)
})

test('uses QWeather 30-day city forecasts with the configured API Host', async ({ page }) => {
  test.slow()
  const requestedUrls: string[] = []
  let qweatherAuthSeen = false
  await page.route('https://qweather.test/**', async (route) => {
    const url = route.request().url()
    requestedUrls.push(url)
    if (route.request().headers()['x-qw-api-key'] === 'test-qweather-key') qweatherAuthSeen = true
    if (url.includes('/geo/v2/city/lookup')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: '200', location: [{ id: '101271406' }] }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: '200', updateTime: '2026-09-15T09:30+08:00', daily: ['02', '03', '04', '05', '06', '07'].map((day) => ({ fxDate: `2026-10-${day}`, tempMin: '7', tempMax: '16', textDay: '小雨', windDirDay: '东北风', windScaleDay: '3-4', pop: '70' })) }),
    })
  })

  await page.locator('.header-weather-button').click()
  const modal = page.locator('.weather-settings-modal')
  const providerSelect = modal.locator('.weather-settings-content > .field').first().locator('.el-select')
  await providerSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '和风天气' }).click()
  await modal.locator('.field').filter({ hasText: 'API Host' }).locator('.el-input__inner').fill('https://qweather.test')
  await modal.locator('.field').filter({ hasText: 'API KEY' }).locator('.el-input__inner').fill('test-qweather-key')
  const horizonSelect = modal.locator('.field').filter({ hasText: '最长预测天数' }).locator('.el-select')
  await horizonSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '30 天城市预报' }).click()
  await expect(modal).toContainText('最长 30 天')
  await modal.getByRole('button', { name: '保存天气服务' }).click()

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await expect(attraction.locator('.weather-badge')).toContainText('小雨', { timeout: 15_000 })
  await expect(attraction.locator('.weather-badge')).toContainText('7~16°')
  expect(requestedUrls.some((url) => url.includes('/geo/v2/city/lookup'))).toBe(true)
  expect(qweatherAuthSeen).toBe(true)
  expect(requestedUrls.some((url) => url.includes('/v7/weather/30d') && url.includes('location=101271406'))).toBe(true)
  await expect(page.locator('.weather-range-banner')).toHaveCount(0)
})

test('uses Caiyun v2.6 daily forecasts with provider-specific token configuration', async ({ page }) => {
  test.slow()
  const requestedUrls: string[] = []
  await page.route('https://caiyun.test/**', async (route) => {
    requestedUrls.push(route.request().url())
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok', server_time: 1789437600,
        result: { daily: {
          status: 'ok',
          temperature: ['20', '21', '22', '23', '24', '25'].map((day) => ({ date: `2026-09-${day}T00:00+08:00`, min: 8, max: 15, avg: 11 })),
          skycon_08h_20h: ['20', '21', '22', '23', '24', '25'].map((day) => ({ date: `2026-09-${day}T00:00+08:00`, value: 'MODERATE_RAIN' })),
          wind_08h_20h: ['20', '21', '22', '23', '24', '25'].map((day) => ({ date: `2026-09-${day}T00:00+08:00`, avg: { speed: 18, direction: 45 } })),
          precipitation: ['20', '21', '22', '23', '24', '25'].map((day) => ({ date: `2026-09-${day}T00:00+08:00`, probability: 0.8 })),
        } },
      }),
    })
  })

  await page.locator('.header-weather-button').click()
  const modal = page.locator('.weather-settings-modal')
  const providerSelect = modal.locator('.weather-settings-content > .field').first().locator('.el-select')
  await providerSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '彩云天气' }).click()
  await modal.locator('.field').filter({ hasText: 'API Endpoint' }).locator('.el-input__inner').fill('https://caiyun.test')
  await modal.locator('.field').filter({ hasText: 'Token' }).locator('.el-input__inner').fill('test-caiyun-token')
  await expect(modal).toContainText('最长 15 天')
  await modal.getByRole('button', { name: '保存天气服务' }).click()
  await expect(page.locator('.weather-range-banner')).toContainText('最长预报 15 天')
  expect(requestedUrls).toHaveLength(0)

  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('interactiveTravel.plans.continuous.v1') ?? '[]')
    records[0].metadata.startAt = '2026-09-20T08:00:00+08:00'
    records[0].metadata.endAt = '2026-09-25T20:00:00+08:00'
    localStorage.setItem('interactiveTravel.plans.continuous.v1', JSON.stringify(records))
  })
  await page.goto('/')
  await page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' }).click()

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await expect(attraction.locator('.weather-badge')).toContainText('中雨', { timeout: 30_000 })
  await attraction.locator('.weather-badge').click()
  await expect(page.locator('.weather-detail-popover:visible')).toContainText('中雨')
  await page.keyboard.press('Escape')
  await expect(attraction.locator('.weather-badge')).toContainText('8~15°')
  expect(requestedUrls.some((url) => url.includes('/v2.6/test-caiyun-token/') && url.includes('dailysteps=15'))).toBe(true)
  await expect(page.locator('.weather-range-banner')).toHaveCount(0)
})

test('aggregates official weather alerts into stop, map and plan risk views', async ({ page }) => {
  test.slow()
  await page.route('https://risk-qweather.test/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/weatheralert/v1/current/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ alerts: [{ id: 'alert-risk', senderName: '阿坝州气象台', eventType: { code: '11B03', name: '暴雨' }, headline: '暴雨橙色预警', description: '预计局地出现强降雨，请注意山洪和道路风险。', instruction: '减少户外活动并关注道路管制。', severity: 'Severe', urgency: 'Immediate', certainty: 'Likely', effectiveTime: '2026-09-16T08:00:00+08:00', expireTime: '2026-09-17T20:00:00+08:00' }], metadata: { attributions: [{ name: 'QWeather' }] } }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ days: ['16', '17', '18', '19', '20', '21'].map((day) => ({ forecastStartTime: `2026-09-${day}T00:00:00+08:00`, forecastEndTime: `2026-09-${Number(day) + 1}T00:00:00+08:00`, temperatureMax: { value: 14, unit: 'celsius' }, temperatureMin: { value: -2, unit: 'celsius' }, daytime: { condition: { text: '小雨' }, precipitation: { probability: 0.8, type: 'rain' }, wind: { direction: { compass: 'NE' }, scale: 3 } } })) }),
    })
  })

  await page.locator('.header-weather-button').click()
  const weatherModal = page.locator('.weather-settings-modal')
  const providerSelect = weatherModal.locator('.weather-settings-content > .field').first().locator('.el-select')
  await providerSelect.click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '和风天气' }).click()
  await weatherModal.locator('.field').filter({ hasText: 'API Host' }).locator('.el-input__inner').fill('https://risk-qweather.test')
  await weatherModal.locator('.field').filter({ hasText: 'API KEY' }).locator('.el-input__inner').fill('test-risk-key')
  await weatherModal.getByRole('button', { name: '保存天气服务' }).click()

  await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem('interactiveTravel.plans.continuous.v1') ?? '[]')
    records[0].metadata.startAt = '2026-09-16T08:00:00+08:00'
    records[0].metadata.endAt = '2026-09-21T20:00:00+08:00'
    localStorage.setItem('interactiveTravel.plans.continuous.v1', JSON.stringify(records))
  })
  await page.goto('/')
  await page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' }).click()

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await expect(attraction.locator('.risk-badge')).toBeVisible({ timeout: 20_000 })
  await expect(attraction).toHaveClass(/risk-critical/)
  const weatherBox = await attraction.locator('.weather-badge').boundingBox()
  const riskBox = await attraction.locator('.risk-badge').boundingBox()
  expect(weatherBox).not.toBeNull()
  expect(riskBox).not.toBeNull()
  expect(Math.abs(weatherBox!.y - riskBox!.y)).toBeLessThan(6)
  expect(weatherBox!.x).toBeLessThan(riskBox!.x)
  await attraction.locator('.risk-badge').hover()
  const riskPreview = page.locator('.risk-preview-popover:visible')
  await expect(riskPreview).toContainText('暴雨橙色预警')
  await expect(riskPreview).toContainText('低温 -2℃')
  await expect(riskPreview).toContainText('阿坝州气象台')

  await page.locator('.travel-marker[data-place="shuang"]').dispatchEvent('click')
  const mapRisks = page.locator('.map-place-card .map-place-risks')
  await expect(mapRisks).toContainText('暴雨橙色预警')
  await expect(mapRisks).toContainText('低温 -2℃')

  await page.getByRole('button', { name: '检查计划' }).click()
  const check = page.locator('.resultmodal')
  await expect(check.locator('.risk-check-warnings')).toContainText('风险提示')
  await expect(check.locator('.risk-check-warnings')).toContainText('暴雨橙色预警')
})


test('reviews, validates and applies an AI route rearrangement only after confirmation', async ({ page }) => {
  test.slow()
  await installMockRouteOptimizationAi(page)
  await page.reload()
  await page.getByRole('button', { name: '检查计划' }).click()
  await page.locator('.resultmodal').getByRole('button', { name: 'AI 分析路线' }).click()

  const modal = page.locator('.ai-route-optimization-modal')
  await expect(modal).toContainText('AI 路线优化')
  await expect(modal).toContainText('测试路线 AI')
  await modal.getByRole('button', { name: '开始分析路线' }).click()
  await expect(modal.locator('.ai-route-comparison')).toContainText('高德路线验证', { timeout: 60_000 })
  await expect(modal.locator('.ai-route-day-plans')).toContainText('双桥沟 → 四姑娘山镇')
  await modal.getByRole('button', { name: '确认并应用调整' }).click()

  await expect(page.locator('.toast')).toContainText('已应用 AI 路线调整')
  await expect.poll(() => page.locator('.stopcard').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-place')))).toEqual(['cd', 'shuang', 'sig', 'hotel'])
  await page.getByTitle('撤销').click()
  await expect.poll(() => page.locator('.stopcard').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-place')))).toEqual(['cd', 'sig', 'shuang', 'hotel'])
})

test('uses Chinese duration units in summaries and limit warnings', async ({ page }) => {
  await expect(page.locator('.planner-headline')).toContainText('地点')
  await expect(page.locator('.daymetrics')).toContainText(/驾驶 \d+小时/)

  await page.getByRole('button', { name: '演示超时' }).click()
  const warning = page.locator('.warningbar')
  await expect(warning).toContainText('驾驶')
  await expect(warning).toContainText('小时')
  const warningText = await warning.innerText()
  expect(warningText).not.toMatch(/\d+h|\d+m/)
})

test('sets an independent driving limit for each day', async ({ page }) => {
  await page.locator('.daytab').filter({ hasText: 'Day 1' }).click()
  const limitButton = page.locator('.drive-limit-trigger')
  await expect(limitButton).toContainText('驾驶上限 6小时')
  await limitButton.click()

  const editor = page.locator('.drive-limit-editor')
  await expect(editor).toContainText('Day 1 驾驶上限')
  await editor.locator('.drive-limit-hours input').fill('10')
  await editor.locator('.drive-limit-minutes input').fill('30')
  await editor.getByRole('button', { name: '保存' }).click()
  await expect(limitButton).toContainText('驾驶上限 10小时30分')
  await expect(page.locator('.toast')).toContainText('Day 1 驾驶上限已设为 10小时30分')

  await page.locator('.daytab').filter({ hasText: 'Day 2' }).click()
  await expect(limitButton).toContainText('驾驶上限 6小时')
  await page.locator('.daytab').filter({ hasText: 'Day 1' }).click()
  await expect(limitButton).toContainText('驾驶上限 10小时30分')

  await page.getByTitle('撤销').click()
  await expect(limitButton).toContainText('驾驶上限 6小时')
})

test('shows the deliberate conflict and resolves it', async ({ page }) => {
  await page.getByRole('button', { name: '演示超时' }).click()
  await expect(page.getByText('将丹巴调整到 Day 3 →')).toBeVisible()
  await page.getByText('将丹巴调整到 Day 3 →').click()
  await expect(page.locator('.statuspill')).toContainText('计划可行')
})

test('builds a traceable trip budget from driving settings and place expenses', async ({ page }) => {
  test.slow()
  await page.locator('.header-budget-button').click()
  const budgetModal = page.locator('.budget-modal')
  await expect(budgetModal).toContainText('旅行预算')
  await expect(budgetModal).toContainText('尚未设置预算上限')
  await budgetModal.getByRole('button', { name: '预算与自驾参数' }).click()
  await expect(budgetModal).toContainText('自驾成本自动计算')

  await budgetModal.locator('.vehicle-cost-heading .el-switch').click()
  const consumption = budgetModal.locator('label').filter({ hasText: '百公里油耗' }).locator('.el-input__inner')
  const energyPrice = budgetModal.locator('label').filter({ hasText: '油价（元/L）' }).locator('.el-input__inner')
  const limit = budgetModal.locator('label').filter({ hasText: '预算上限（元）' }).locator('.el-input__inner')
  await consumption.fill('8')
  await energyPrice.fill('8')
  await limit.fill('5000')
  await budgetModal.getByRole('button', { name: '保存预算设置' }).click()

  const automaticSegmentCost = page.locator('.transport-segment .cost-chip').first()
  await automaticSegmentCost.hover()
  await expect(page.locator('.expense-hover-preview:visible')).toContainText('油费')
  await page.locator('.stopcard[data-place="sig"] .cost-chip').hover()
  await expect(page.locator('.expense-hover-preview:visible')).toHaveCount(0)

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  await attraction.locator('.cost-chip').click()
  const expense = page.locator('.expense-editor-popover:visible')
  await expect(expense).toContainText('双桥沟费用')
  await expense.locator('label').filter({ hasText: '费用名称' }).locator('.el-input__inner').fill('双桥沟门票和观光车')
  await expense.locator('label').filter({ hasText: '状态' }).locator('.el-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '已确认' }).click()
  await expense.locator('label').filter({ hasText: '数量' }).locator('.el-input__inner').fill('2')
  await expense.locator('label').filter({ hasText: '单价（元）' }).locator('.el-input__inner').fill('80')
  await expense.getByRole('button', { name: '添加费用' }).click()

  await expect(attraction.locator('.cost-chip')).toContainText('¥160')
  await attraction.locator('.cost-chip').click()
  await attraction.locator('.cost-chip').hover()
  const hoverPreview = page.locator('.expense-hover-preview:visible')
  await expect(hoverPreview).toContainText('双桥沟门票和观光车')
  await expect(hoverPreview).toContainText('已确认')
  await expect(hoverPreview.getByRole('button', { name: '编辑' })).toHaveCount(0)
  await expect(hoverPreview.getByRole('button', { name: '添加或管理费用' })).toHaveCount(0)
  const inlineAmount = hoverPreview.getByRole('spinbutton', { name: '双桥沟门票和观光车费用金额' })
  await expect(inlineAmount).toBeVisible()
  await expect(inlineAmount).toHaveValue('160.00')
  expect((await inlineAmount.boundingBox())!.width).toBeLessThanOrEqual(92)
  await inlineAmount.fill('180')
  await inlineAmount.blur()
  await expect(attraction.locator('.cost-chip')).toContainText('¥180')
  await expect(page.locator('.expense-editor-popover:visible')).toHaveCount(0)

  const attractionMarker = page.locator('.travel-marker[data-place="shuang"]')
  await attractionMarker.dispatchEvent('click')
  const mapPlaceCard = page.locator('.map-place-card')
  await expect(mapPlaceCard.locator('.map-place-expenses')).toBeVisible()
  await expect(mapPlaceCard.locator('.map-place-expenses')).toContainText('双桥沟门票和观光车')
  await expect(mapPlaceCard.locator('.map-place-expenses')).toContainText('已确认')
  await expect(mapPlaceCard.locator('.map-place-expenses')).toContainText('¥180')

  const townMarker = page.locator('.travel-marker[data-place="sig"]')
  await townMarker.dispatchEvent('click')
  await expect(mapPlaceCard.locator('.map-place-expenses')).toHaveCount(0)

  await expect(page.locator('.header-budget-button')).not.toContainText('预算')
  await page.locator('.header-budget-button').click()
  await expect(budgetModal).toContainText('预计剩余')
  await budgetModal.getByRole('button', { name: /费用明细/ }).click()
  await expect(budgetModal).toContainText('双桥沟门票和观光车')
  await expect(budgetModal).toContainText('高德驾车路线估算')
  await budgetModal.getByRole('button', { name: '取消' }).click()

  await page.getByRole('button', { name: '检查计划' }).click()
  await expect(page.locator('.resultmodal')).toContainText('预计预算')
  await page.locator('.resultmodal').getByRole('button', { name: '完成' }).click()

  const savedBudgetText = await page.locator('.header-budget-button').innerText()
  await page.goto('/')
  await page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' }).click()
  await expect(page.locator('.header-budget-button')).toHaveText(savedBudgetText)
  await expect(page.locator('.stopcard[data-place="shuang"] .cost-chip')).toContainText('¥180')
})


test('builds an actionable departure-readiness checklist with lodging coverage', async ({ page }) => {
  await page.getByRole('button', { name: '检查计划' }).click()
  const check = page.locator('.resultmodal')
  await expect(check.locator('.readiness-overview')).toContainText('出发准备完成度')
  await expect(check.locator('.readiness-task-list')).toContainText('Day 3 尚未覆盖住宿')
  await check.locator('.readiness-task-list').getByText('Day 3 尚未覆盖住宿').click()
  await expect(page.locator('.daytab.active')).toContainText('Day 3')
  await page.locator('.overnight-mode-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '露营' }).click()
  await page.getByRole('button', { name: '检查计划' }).click()
  await expect(page.locator('.readiness-task-list')).not.toContainText('Day 3 尚未覆盖住宿')
})

test('uses validated route data for cross-day continuity details', async ({ page }) => {
  await page.locator('.daytab').filter({ hasText: 'Day 4' }).click()
  await page.locator('.poolcard').filter({ hasText: '新都桥' }).locator('.addmini').click()
  await page.getByRole('button', { name: '检查计划' }).click()
  await expect(page.locator('.continuity-check-warnings')).toContainText('高德驾车约', { timeout: 30_000 })
})

test('previews share styles and exports a mobile-ready image', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 1300, height: 1100 })
  await page.evaluate(() => {
    const config = JSON.parse(localStorage.getItem('interactiveTravel.map.amap.config') ?? '{}')
    config.webServiceKey = 'test-static-map-key'
    localStorage.setItem('interactiveTravel.map.amap.config', JSON.stringify(config))
  })
  await page.route('https://restapi.amap.com/v3/staticmap**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6mQAAAAASUVORK5CYII=', 'base64') })
  })
  await page.getByRole('button', { name: '分享' }).click()
  const modal = page.locator('.share-studio-modal')
  await expect(modal).toContainText('分享工作室')
  await expect(modal.locator('.share-style-grid button')).toHaveCount(4)
  await expect(modal.locator('.share-export-page').first()).toContainText('川西 6 日自驾')
  await expect(modal.locator('.share-map-status.ready')).toContainText('高德真实底图路线页')
  await modal.locator('.share-preview-panel>header .el-button').last().click()
  await expect(modal.locator('.share-preview-panel .share-kind-map img')).toBeVisible()
  await modal.locator('.share-preview-panel>header .el-button').first().click()
  const layoutBox = await modal.locator('.share-studio-layout').boundingBox()
  const settingsBox = await modal.locator('.share-settings-panel').boundingBox()
  expect(settingsBox!.height).toBeGreaterThan(layoutBox!.height * 0.9)
  expect(await modal.locator('.share-settings-panel').evaluate((element) => getComputedStyle(element).maxHeight)).toBe('none')
  await modal.locator('.share-style-grid button').filter({ hasText: '抖音杂志' }).click()
  await expect(modal.locator('.share-preview-panel>header')).toContainText('1080 × 1920')
  expect((await modal.locator('.share-preview-shell').boundingBox())!.width).toBeGreaterThan(380)
  await modal.getByRole('button', { name: '单张长图' }).click()
  await expect(modal.locator('.share-preview-panel>header')).toContainText('1 张')
  await modal.getByRole('button', { name: '多图卡片' }).click()
  await modal.locator('.share-prompt-toggle').click()
  await expect(modal.locator('.share-settings-panel textarea').first()).toBeVisible()
  const download = page.waitForEvent('download')
  await modal.getByRole('button', { name: '下载当前图' }).click()
  expect((await download).suggestedFilename()).toMatch(/\.png$/)
})

test('opens the final deterministic plan check', async ({ page }) => {
  await page.getByRole('button', { name: '形成计划' }).click()
  await expect(page.getByText(/行程可行，预算仍有/)).toBeVisible()
  await expect(page.locator('.resultmodal').getByRole('button', { name: /完成/ })).toBeVisible()
  await expect(page.getByText('分享预览')).toHaveCount(0)
})


test('jumps from plan check results to the affected day and budget', async ({ page }) => {
  await page.getByRole('button', { name: '检查计划' }).click()
  const check = page.locator('.resultmodal')
  await check.locator('.checkrow.actionable').filter({ hasText: 'Day 1' }).click()
  await expect(page.locator('.daytab.active')).toContainText('Day 1')
  await page.getByRole('button', { name: '检查计划' }).click()
  await check.locator('.budget-check-warnings.actionable').click()
  await expect(page.locator('.budget-modal')).toBeVisible()
})

test('moves a stop to another day', async ({ page }) => {
  const stop = page.locator('.stopcard').filter({ hasText: '双桥沟' })
  const day3 = page.locator('.daytab').filter({ hasText: 'Day 3' })
  await stop.dragTo(day3)
  await expect(page.locator('.daytab.active')).toContainText('Day 3')
  await expect(page.locator('.stopcard').filter({ hasText: '双桥沟' })).toBeVisible()
})

test('edits explicit stop time ranges and highlights crossing nodes', async ({ page }) => {
  const town = page.locator('.stopcard[data-place="sig"]')
  await expect(town.locator('.stop-time-arrival .el-input__inner')).toHaveValue(/\d{2}:\d{2}/)
  await expect(town.locator('.stop-time-departure .el-input__inner')).toHaveValue(/\d{2}:\d{2}/)

  const attraction = page.locator('.stopcard[data-place="shuang"]')
  const attractionArrival = attraction.locator('.stop-time-arrival .el-input__inner')
  await attractionArrival.fill('09:00')
  await attractionArrival.blur()
  await expect(attractionArrival).toHaveValue('09:00')

  await expect(page.locator('.stopcard.conflict')).toHaveCount(2)
  await expect(attraction).toContainText('最早只能在')
  await expect(page.locator('.travel-marker.conflict')).toHaveCount(2)
  await expect(page.locator('.segmentline.bad')).toHaveCount(1)
})


test('renders repeated visits as separate globally numbered map occurrences', async ({ page }) => {
  await page.locator('.travel-marker[data-place="shuang"]').dispatchEvent('click')
  const card = page.locator('.map-place-card')
  await expect(card).toContainText('已安排 1 次')
  await card.getByRole('button', { name: '再次加入 Day 2' }).click()
  await expect(page.locator('.stopcard[data-place="shuang"]')).toHaveCount(2)
  await expect(page.locator('.travel-marker[data-place="shuang"]')).toHaveCount(2)
  const orders = await page.locator('.travel-marker[data-place="shuang"]').evaluateAll((markers) => markers.map((marker) => marker.getAttribute('data-order')))
  expect(new Set(orders).size).toBe(2)
  await page.locator('.travel-marker[data-place="shuang"]').first().dispatchEvent('click')
  await expect(card).toContainText('已安排 2 次')
})


test('queries, previews and persists a provider-backed route option', async ({ page }) => {
  test.slow()
  const firstSegment = page.locator('.transport-segment').first()
  await firstSegment.getByTitle('选择地图路线').click()
  const popover = page.locator('.route-options-popover:visible')
  await expect(popover).toContainText('高德地图', { timeout: 30_000 })
  const options = popover.locator('.route-option-list > button')
  await expect(options.first()).toBeVisible({ timeout: 30_000 })
  const count = await options.count()
  expect(count).toBeGreaterThan(0)
  const chosen = count > 1 ? options.nth(1) : options.first()
  const chosenLabel = (await chosen.locator('.route-option-main b').innerText()).trim()
  await chosen.hover()
  await chosen.click()
  await expect(firstSegment.locator('.selected-route-chip')).toHaveText(chosenLabel)
  await page.getByRole('button', { name: '全部计划' }).click()
  await page.locator('.plan-card').filter({ hasText: '川西 6 日自驾' }).click()
  await expect(page.locator('.transport-segment').first().locator('.selected-route-chip')).toHaveText(chosenLabel)
  const persistedRoute = await page.evaluate(() => {
    const plans = JSON.parse(localStorage.getItem('interactiveTravel.plans.continuous.v1') ?? '[]')
    return plans[0]?.plannerState?.days?.[0]?.stops?.[0]?.selectedRoute
  })
  expect(persistedRoute.encodedPath).toBeTruthy()
  expect(persistedRoute.path).toBeUndefined()
})


test('compares a whole-day route through all driving waypoints and applies its preference', async ({ page }) => {
  test.slow()
  await page.locator('.day-route-options-trigger').click()
  const popover = page.locator('.day-route-options-popover:visible')
  await expect(popover.locator('.day-route-option-list button').first()).toBeVisible({ timeout: 30_000 })
  await expect(popover).toContainText('四姑娘山镇 → 双桥沟 → 四姑娘山酒店')
  await popover.getByRole('button', { name: '应用到每段' }).click()
  await expect(page.locator('.selected-route-chip')).toHaveCount(2, { timeout: 30_000 })
  await page.getByTitle('撤销').click()
  await expect(page.locator('.selected-route-chip')).toHaveCount(0)
})

test('switches and persists provider-backed 2D and 2.5D map views', async ({ page }) => {
  const flat = page.getByTitle('高德 2D 平面视角')
  const tilted = page.getByTitle('高德 2.5D 立体视角')
  await expect(flat).toHaveClass(/active/)
  await tilted.click()
  await expect(tilted).toHaveClass(/active/)
  await expect(page.locator('.toast')).toContainText('2.5D 立体视角')
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 20_000 })
  await expect.poll(() => page.evaluate(() => localStorage.getItem('interactiveTravel.map.amap.displayMode'))).toBe('tilted')

  await page.reload()
  await expect(page.locator('.continuous-itinerary')).toBeVisible()
  await expect(page.getByTitle('高德 2.5D 立体视角')).toHaveClass(/active/)
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 20_000 })
})

test('toggles the official real-time traffic layer from the map toolbar', async ({ page }) => {
  const traffic = page.locator('.map-traffic-button')
  await expect(traffic).toBeEnabled({ timeout: 20_000 })
  await traffic.click()
  await expect(traffic).toHaveClass(/active/)
  await traffic.click()
  await expect(traffic).not.toHaveClass(/active/)
})


test('offers AMap public-transit alternatives while keeping manual schedule fallback', async ({ page }) => {
  const segment = page.locator('.transport-segment').nth(1)
  await segment.locator('.transport-mode-select').click()
  await page.locator('.transport-mode-options:visible .el-select-dropdown__item').filter({ hasText: '公交 / 地铁' }).click()
  await expect(segment.getByTitle('选择地图路线')).toBeVisible()
  await expect(segment.getByTitle('填写交通用时')).toBeVisible()
})

test('selects transport modes and requires reliable timing for flights', async ({ page }) => {
  await expect(page.locator('.map-route-info[data-route-mode="driving"]')).toHaveCount(3, { timeout: 20_000 })
  await expect(page.locator('.map-route-info[data-route-mode="driving"]').first()).toContainText(/驾车 · \d+/)
  const firstSegment = page.locator('.stopwrap').filter({ has: page.locator('.stopcard[data-place="cd"]') }).locator('.transport-segment')
  const modeSelect = firstSegment.locator('.transport-mode-select')
  await expect(modeSelect).toContainText('驾车')
  await modeSelect.click()
  await expect(page.locator('.transport-mode-options:visible .el-select-dropdown__item')).toHaveCount(7)
  await page.locator('.transport-mode-options:visible .el-select-dropdown__item').filter({ hasText: '飞机' }).click()

  await expect(firstSegment).toContainText('待填写用时')
  await expect(page.locator('.warningbar')).toContainText('飞机用时未填写')
  const flightLabel = page.locator('.map-route-info[data-route-mode="flight"]')
  await expect(flightLabel).toContainText('飞机 · 待填用时', { timeout: 10_000 })
  await expect(flightLabel).toHaveClass(/mode-flight/)
  await firstSegment.getByTitle('填写交通用时').click()
  const editor = page.locator('.manual-transport-editor')
  await expect(editor).toContainText('成都酒店 → 四姑娘山镇')
  await editor.locator('.manual-transport-schedule input').nth(0).fill('CA1234')
  await editor.locator('.manual-transport-schedule input').nth(1).fill('成都天府机场')
  await editor.locator('.manual-transport-schedule input').nth(2).fill('四姑娘山机场')
  const departureInput = editor.locator('label').filter({ hasText: '出发时间' }).locator('input')
  const arrivalInput = editor.locator('label').filter({ hasText: '到达时间' }).locator('input')
  await departureInput.fill('09:00')
  await departureInput.blur()
  await arrivalInput.fill('10:30')
  await arrivalInput.blur()
  await editor.locator('label').filter({ hasText: '提前到达' }).locator('input').fill('60')
  await editor.locator('label').filter({ hasText: '票务状态' }).locator('.el-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '已出票' }).click()
  await editor.locator('label').filter({ hasText: '订单' }).locator('input').fill('订单号 TEST-CA1234')
  await expect(editor.locator('.manual-transport-derived')).toContainText('1小时30分')
  await editor.locator('.manual-transport-km input').fill('1200')
  await editor.getByRole('button', { name: '保存' }).click()

  await expect(firstSegment).toContainText('1小时30分')
  await expect(firstSegment).toContainText('1200 km')
  await expect(firstSegment).toContainText('CA1234')
  await expect(page.locator('.stopcard[data-place="sig"] .stop-time-arrival .el-input__inner')).toHaveValue('10:30')
  await expect(flightLabel).toContainText('飞机 · 1小时30分')
  await expect(flightLabel).toContainText('1200 km')
  await expect(flightLabel).toContainText('手动')
  await expect(page.locator('.daymetrics')).toContainText('交通')
  await expect(page.locator('.warningbar')).toHaveCount(0)

  const walkingSegment = page.locator('.stopwrap').filter({ has: page.locator('.stopcard[data-place="sig"]') }).locator('.transport-segment')
  await walkingSegment.locator('.transport-mode-select').click()
  await page.locator('.transport-mode-options:visible .el-select-dropdown__item').filter({ hasText: '步行' }).click()
  await expect(walkingSegment.locator('.transport-mode-select')).toContainText('步行')
  await expect(walkingSegment.getByTitle('填写交通用时')).toHaveCount(0)
  const walkingLabel = page.locator('.map-route-info[data-route-mode="walking"]')
  await expect(walkingLabel).toContainText(/步行 · \d+/, { timeout: 20_000 })
  await expect(walkingLabel).toHaveClass(/mode-walking/)
  await expect(page.locator('.map-route-info')).toHaveCount(3, { timeout: 20_000 })
  await expect(page.locator('.map-route-info[data-route-mode="driving"]')).toHaveCount(1)
})

test('supports undo and redo for itinerary changes', async ({ page }) => {
  const candidate = page.locator('.poolcard').filter({ hasText: '猫鼻梁' })
  await candidate.locator('.addmini').click()
  await expect(page.locator('.stopcard')).toHaveCount(5)
  await page.getByTitle('撤销').click()
  await expect(page.locator('.stopcard')).toHaveCount(4)
  await page.getByTitle('重做').click()
  await expect(page.locator('.stopcard')).toHaveCount(5)
})

test('filters map markers by place category while preserving current stops', async ({ page }) => {
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 15_000 })
  await page.getByTitle('地点图例').click()
  await page.getByRole('button', { name: '美食' }).click()
  await expect(page.locator('.travel-marker')).toHaveCount(4)
})

test('focuses the map only from the place icon control', async ({ page }) => {
  const stop = page.locator('.stopcard[data-place="shuang"]')
  await stop.locator('.place-map-focus-button').click()
  const marker = page.locator('.travel-marker[data-place="shuang"]')
  await expect(marker).toHaveClass(/selected/)
  await expect(page.locator('.map-place-card')).toContainText('双桥沟')
  const distanceFromMapCenter = async (target: Locator) => {
    const mapBox = await page.locator('.amap-container').boundingBox()
    const markerBox = await target.locator('.travel-marker-core').boundingBox()
    if (!mapBox || !markerBox) return 9999
    return Math.hypot(
      markerBox.x + markerBox.width / 2 - (mapBox.x + mapBox.width / 2),
      markerBox.y + markerBox.height / 2 - (mapBox.y + mapBox.height / 2),
    )
  }
  await expect.poll(() => distanceFromMapCenter(marker), { timeout: 20_000 }).toBeLessThan(100)

  const townStop = page.locator('.stopcard[data-place="sig"]')
  await townStop.locator('.stopname').click()
  await expect(page.locator('.travel-marker[data-place="sig"]')).toHaveClass(/selected/)
  await expect.poll(() => distanceFromMapCenter(marker)).toBeLessThan(100)

  await townStop.locator('.place-map-focus-button').click()
  await expect.poll(() => distanceFromMapCenter(page.locator('.travel-marker[data-place="sig"]')), { timeout: 20_000 }).toBeLessThan(100)
})

test('opens map place details from a marker', async ({ page }) => {
  const marker = page.locator('.amap-marker').filter({ hasText: '成都酒店' })
  await marker.locator('.travel-marker-core').click({ force: true })
  await expect(page.locator('.map-place-card')).toContainText('成都酒店')
  await expect(page.locator('.map-place-card')).toContainText('已安排 2 次（Day 1、Day 2）')
})


test('searches nearby POIs from the selected place card without losing the center', async ({ page }) => {
  await page.locator('.travel-marker[data-place="cd"]').dispatchEvent('click')
  const card = page.locator('.map-place-card')
  await expect(card.getByRole('heading', { name: '成都酒店' })).toBeVisible()
  await card.getByRole('button', { name: '搜周边' }).click()
  const nearby = card.locator('.map-nearby-search')
  await expect(nearby).toContainText('以 成都酒店 为中心')
  await expect(nearby.locator('.nearby-result-card').first()).toBeVisible({ timeout: 20_000 })
  await expect(nearby.locator('.nearby-result-card').first()).toContainText(/米|公里/)
  await nearby.locator('.nearby-result-card').first().getByRole('button', { name: '未安排' }).click()
  await expect(page.locator('.toast')).toContainText('加入未安排地点')
  await expect(card.getByRole('heading', { name: '成都酒店' })).toBeVisible()
  await expect(nearby.locator('.nearby-result-card').first().getByRole('button', { name: '已收集' })).toBeDisabled()
})

test('stores personal place notes and altitude and reflects altitude risk', async ({ page }) => {
  await page.locator('.travel-marker[data-place="shuang"]').dispatchEvent('click')
  const card = page.locator('.map-place-card')
  await card.getByRole('button', { name: '添加' }).click()
  await card.locator('.map-place-personal textarea').fill('提前一天预约观光车，优先走右侧栈道。')
  await card.locator('.map-place-personal .el-input-number input').fill('3600')
  const visitTimes = card.locator('.place-visit-times .el-input__inner')
  await visitTimes.nth(0).fill('09:00')
  await visitTimes.nth(1).fill('09:30')
  await visitTimes.nth(2).fill('10:00')
  await card.locator('.place-reservation-row .el-switch').click()
  await card.locator('.place-reservation-fields .el-select').click()
  await page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: '待预约' }).click()
  await card.locator('.map-place-personal').getByRole('button', { name: '保存' }).click()
  await expect(card.locator('.map-place-personal')).toContainText('提前一天预约观光车')
  await expect(card.locator('.map-place-personal')).toContainText('海拔 3,600 m')
  await expect(page.locator('.stopcard[data-place="shuang"] .risk-badge')).toBeVisible()
  await expect(page.locator('.stopcard[data-place="shuang"] .stop-readiness')).toContainText('1 项待处理')
  await page.locator('.stopcard[data-place="shuang"] .risk-badge').hover()
  await expect(page.locator('.risk-preview-popover:visible')).toContainText('高海拔 3,600 m')
  await page.getByRole('button', { name: '检查计划' }).click()
  const check = page.locator('.resultmodal')
  await expect(check.locator('.place-constraint-warnings')).toContainText('尚未完成预约')
  await expect(check.locator('.place-constraint-warnings')).toContainText('可能错过最晚入场')
})

test('separates provider templates from configured AI connection instances', async ({ page }) => {
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  await expect(page.locator('.ai-import-provider .el-select__placeholder')).toContainText('选择已配置的 AI 接入实例')
  await expect(page.locator('.ai-no-instance')).toContainText('还没有可用的 AI 接入实例')
  await page.getByTitle('配置 AI 接入实例').click()
  const settings = page.locator('.ai-settings-modal')
  await expect(settings).toContainText('AI 接入实例配置')
  await expect(settings).toContainText('预置 Provider 只提供参数模板')
  await expect(settings.locator('.ai-profile-select .el-select__placeholder')).toContainText('选择已保存的接入实例')
  await expect(settings).toContainText('OpenAI · Responses')
  await expect(settings.locator('.ai-endpoint-grid')).toContainText('Base URL')
  await expect(settings.locator('.ai-endpoint-grid')).toContainText('API Key')
  await expect(settings.locator('.ai-default-model-input input')).toHaveAttribute('placeholder', /任意模型 ID/)
  await expect(settings).not.toContainText('模型候选列表')
  await settings.getByRole('button', { name: /高级设置/ }).click()
  await expect(settings).toContainText('模型候选列表')
  await expect(settings.locator('.ai-model-list-field .el-tag')).toHaveCount(3)
  await expect(settings).toContainText('默认系统提示词')
  await expect(settings.getByRole('button', { name: '恢复内置默认' })).toBeVisible()
  await expect(settings).toContainText('上下文窗口')
  await expect(settings).toContainText('最大输入')
  await expect(settings).toContainText('最大输出')
  await expect(settings).toContainText('浏览器直连模式')
  const switchWidth = await settings.locator('.ai-secret-switch .el-switch__core').evaluate((element) => element.getBoundingClientRect().width)
  expect(switchWidth).toBeLessThan(60)
  await expect(settings.getByRole('button', { name: '测试连接' })).toBeVisible()
})

test('allows custom model IDs and fetches provider models from the configured endpoint', async ({ page }) => {
  const draft = {
    title: '模型查询测试', durationDays: 1, origin: null, returnToOrigin: null,
    days: [{ sourceLabel: 'D1', startArea: null, endArea: null, overnightArea: null, places: [] }],
    generalNotes: [], uncertainties: [],
  }
  await installMockAi(page, draft)
  await page.route('https://mock-ai.local/v1/models', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ object: 'list', data: [
      { id: 'vendor/model-large', object: 'model', created: 1, owned_by: 'vendor' },
      { id: 'vendor/model-fast', object: 'model', created: 2, owned_by: 'vendor' },
    ] }) })
  })
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  await page.getByTitle('配置 AI 接入实例').click()
  const settings = page.locator('.ai-settings-modal')
  const modelInput = settings.locator('.ai-default-model-input input')
  await modelInput.fill('vendor/manually-entered-model')
  await expect(modelInput).toHaveValue('vendor/manually-entered-model')
  await settings.getByRole('button', { name: '查询模型' }).click()
  await expect(page.locator('.toast')).toContainText('已从供应商获取 2 个模型')
  await expect(settings).toContainText('最近从供应商获取 2 个模型')
  await modelInput.fill('')
  await modelInput.click()
  await expect(page.locator('.el-autocomplete-suggestion:visible')).toContainText('vendor/model-large')
  await modelInput.fill('vendor/manually-entered-model')
  await expect(modelInput).toHaveValue('vendor/manually-entered-model')
})

test('shows AI connection test feedback above nested dialogs', async ({ page }) => {
  const draft = {
    title: '连接测试', durationDays: 1, origin: null, returnToOrigin: null,
    days: [{ sourceLabel: 'D1', startArea: null, endArea: null, overnightArea: null, places: [] }],
    generalNotes: [], uncertainties: [],
  }
  await installMockAi(page, draft)
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  await page.getByTitle('配置 AI 接入实例').click()
  const settings = page.locator('.ai-settings-modal')
  await settings.getByRole('button', { name: '测试连接' }).click()

  const toast = page.locator('.toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('AI 接入实例连接测试成功')
  const toastZIndex = await toast.evaluate((element) => Number(getComputedStyle(element).zIndex))
  const overlayZIndexes = await page.locator('.el-overlay:visible').evaluateAll((elements) => elements.map((element) => Number(getComputedStyle(element).zIndex) || 0))
  expect(toastZIndex).toBeGreaterThan(Math.max(...overlayZIndexes))
})

test('accepts pasted travel images and exposes an editable system prompt', async ({ page }) => {
  const draft = {
    title: '图片识别行程', durationDays: 1, origin: null, returnToOrigin: null,
    days: [{ sourceLabel: 'D1', startArea: null, endArea: null, overnightArea: null, places: [
      { name: '双桥沟', kind: 'poi', category: 'attraction', note: '图片中的景点', stayMinutes: 120, transportToNext: null },
    ] }],
    generalNotes: [], uncertainties: [],
  }
  await installMockAi(page, draft)
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  const modal = page.locator('.ai-import-modal')
  await modal.locator('.ai-prompt-toggle').click()
  const prompt = modal.locator('.ai-prompt-body textarea')
  await expect(prompt).toBeVisible()
  await prompt.fill('只识别图片正文中的旅行地点，忽略水印和广告。')

  await modal.locator('textarea').first().evaluate((element) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6mQAAAAASUVORK5CYII='), (character) => character.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'share.png', { type: 'image/png' }))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })
  await expect(modal.locator('.ai-image-item')).toHaveCount(1)
  await expect(modal.locator('.ai-input-budget')).toContainText('含 1 张图片')
  await expect(modal.getByRole('button', { name: '解析并核验地点' })).toBeEnabled()
  await modal.getByRole('button', { name: '解析并核验地点' }).click()
  await expect(modal.locator('.ai-day-preview')).toHaveCount(1, { timeout: 20_000 })
})

test('keeps the AI import preview readable on a compact desktop viewport', async ({ page }) => {
  test.slow()
  await page.setViewportSize({ width: 1080, height: 1130 })
  const dayNames = ['重庆', '陇南', '若尔盖', '玛曲', '松潘']
  const draft = {
    title: '五日跨城旅行', durationDays: 5, origin: '重庆', returnToOrigin: false,
    days: dayNames.map((name, index) => ({
      sourceLabel: `D${index + 1}`, startArea: name, endArea: dayNames[index + 1] ?? '重庆', overnightArea: name,
      places: [{ name, kind: 'poi', category: 'attraction', note: `${name}行程地点`, stayMinutes: 90, transportToNext: index < dayNames.length - 1 ? 'driving' : null }],
    })),
    generalNotes: [], uncertainties: ['具体班次需要再次确认'],
  }
  await installMockAi(page, draft)
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  const modal = page.locator('.ai-import-modal')
  await expect(modal.locator('.ai-import-model')).toContainText('mock-travel-model')
  await modal.locator('textarea').first().fill('这是一段包含重庆、陇南、若尔盖、玛曲和松潘的五日旅行分享，用于验证导入预览布局。')
  await modal.getByRole('button', { name: '解析并核验地点' }).click()
  await expect(modal.locator('.ai-day-preview')).toHaveCount(5, { timeout: 30_000 })

  const modalBox = await modal.boundingBox()
  const sourceBox = await modal.locator('.ai-import-source').boundingBox()
  const previewBox = await modal.locator('.ai-import-preview').boundingBox()
  const footerBox = await modal.locator('.el-dialog__footer').boundingBox()
  const nameInputBox = await modal.locator('.ai-preview-meta .el-input').first().boundingBox()
  expect(modalBox!.x).toBeGreaterThanOrEqual(0)
  expect(modalBox!.y + modalBox!.height).toBeLessThanOrEqual(1130)
  expect(previewBox!.x).toBeGreaterThan(sourceBox!.x + sourceBox!.width)
  expect(nameInputBox!.width).toBeGreaterThan(450)
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(1130)
  expect(await modal.locator('.ai-day-preview').evaluateAll((cards) => cards.every((card) => card.scrollHeight <= card.clientHeight + 1))).toBe(true)
  await expect(modal.getByRole('button', { name: '创建并进入新计划' })).toBeVisible()
})

test('generates an AI cover background while keeping factual overlays in the share template', async ({ page }) => {
  const aiDraft = { title: '封面测试', durationDays: 1, origin: null, returnToOrigin: null, days: [{ sourceLabel: 'D1', startArea: null, endArea: null, overnightArea: null, places: [] }], generalNotes: [], uncertainties: [] }
  await installMockAi(page, aiDraft)
  await page.route('https://mock-ai.local/v1/images/generations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z6mQAAAAASUVORK5CYII=' }] }) })
  })
  await page.goto('/')
  await page.locator('.plan-card').first().click()
  await page.getByRole('button', { name: '分享' }).click()
  const modal = page.locator('.share-studio-modal')
  await modal.getByRole('button', { name: 'AI 多卡背景 + 真实内容' }).click()
  await modal.locator('.share-image-model-row .el-select').nth(1).click()
  const customModel = page.locator('.el-select-dropdown:visible .el-select-dropdown__item').filter({ hasText: 'custom-no-keyword-201' })
  await expect(customModel).toBeVisible()
  await customModel.click()
  await modal.getByRole('button', { name: /生成 \d+ 张卡片背景/ }).click()
  await expect(modal.locator('.share-cover-thumb-grid img')).toHaveCount(9)
  await expect(modal.locator('.share-preview-panel .share-cover-photo')).toBeVisible()
  await expect(modal.locator('.share-preview-panel .share-cover-copy')).toContainText('川西 6 日自驾')
})

test('preserves an AI-extracted total duration when only some days have details', async ({ page }) => {
  const draft = {
    title: '甘南五日心灵之旅', durationDays: 5, origin: '兰州', returnToOrigin: true,
    days: [
      { sourceLabel: 'D1', startArea: '兰州', endArea: '合作', overnightArea: '合作', places: [
        { name: '扎尕那', kind: 'poi', category: 'attraction', note: '藏地石城', stayMinutes: 120, transportToNext: 'driving' },
      ] },
      { sourceLabel: 'D2', startArea: '夏河', endArea: '兰州', overnightArea: null, places: [
        { name: '拉卜楞寺', kind: 'poi', category: 'culture', note: '转经长廊', stayMinutes: 120, transportToNext: null },
      ] },
    ],
    generalNotes: ['昼夜温差大'], uncertainties: ['具体出发日期未说明'],
  }
  await installMockAi(page, draft)
  await page.goto('/')
  await page.locator('.home-ai-import').click()
  const modal = page.locator('.ai-import-modal')
  await expect(modal.locator('.ai-import-model')).toContainText('mock-travel-model')
  await modal.locator('textarea').fill('这是一段足够长的甘南五日四晚旅行分享，包含扎尕那、拉卜楞寺以及兰州往返安排。')
  await modal.getByRole('button', { name: '解析并核验地点' }).click()
  await expect(modal.locator('.ai-day-preview')).toHaveCount(2, { timeout: 25_000 })
  await expect(modal.locator('.ai-preview-meta .el-input__inner').first()).toHaveValue('甘南五日心灵之旅')
  await expect(modal).toContainText('5 天')
  await expect(modal).toContainText('2 天有明细')
  await modal.getByLabel('参与人员 1 姓名').fill('AI 旅行者')
  await modal.getByLabel('参与人员 1 年龄').fill('30')
  await modal.locator('.field').filter({ hasText: '总预算（元）' }).locator('.el-input__inner').fill('9000')
  await expect(modal).toContainText('住宿区域待选')
  await expect(modal.getByRole('button', { name: '创建并进入新计划' })).toBeEnabled()
  await modal.getByRole('button', { name: '创建并进入新计划' }).click()

  await expect(page.locator('.tripname')).toHaveText('甘南五日心灵之旅')
  await expect(page.locator('.tripmeta')).toContainText('1 人')
  await expect(page.locator('.header-budget-button')).toContainText('预算 ¥9,000')
  await expect(page.locator('.daytab')).toHaveCount(5)
  await expect(page.locator('.stopcard')).toHaveCount(1)
})

test('merges an AI-extracted draft into the active plan without replacing it', async ({ page }) => {
  test.slow()
  const draft = {
    title: '补充观景点', durationDays: 1, origin: null, returnToOrigin: null,
    days: [{ sourceLabel: 'D1', startArea: null, endArea: null, overnightArea: null, places: [
      { name: '猫鼻梁', kind: 'poi', category: 'viewpoint', note: '观景点', stayMinutes: 45, transportToNext: null },
    ] }],
    generalNotes: [], uncertainties: [],
  }
  await installMockAi(page, draft)
  await page.reload()
  await page.locator('.ai-import-entry').click()
  const modal = page.locator('.ai-import-modal')
  await modal.locator('textarea').fill('补充一个川西观景点猫鼻梁，安排在第一天，停留约四十五分钟。')
  await modal.getByRole('button', { name: '解析并核验地点' }).click()
  await expect(modal.locator('.ai-day-preview')).toHaveCount(1, { timeout: 20_000 })
  await modal.getByRole('radio', { name: '合并当前计划' }).click()
  await modal.getByRole('button', { name: '合并到当前计划' }).click()

  await expect(page.locator('.tripname')).toHaveText('川西 6 日自驾')
  await expect(page.locator('.daytab.active')).toContainText('Day 1')
  await expect(page.locator('.stopcard').filter({ hasText: '猫鼻梁' })).toBeVisible()
})


test('keeps prototype demo mutations out of the normal planner', async ({ page }) => {
  await page.goto('/')
  await page.locator('.plan-card').first().click()
  await expect(page.getByRole('button', { name: '演示超时' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '收集地点' })).toHaveCount(0)
  await expect(page.locator('.autosave-status')).toContainText('已自动保存')
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 20_000 })
})

test('shows a real empty state and creates the demo only on demand', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('interactiveTravel.plans.continuous.v1'))
  await page.reload()
  await expect(page.getByRole('heading', { name: '还没有旅行计划' })).toBeVisible()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await page.getByRole('button', { name: '查看川西示例' }).click()
  await expect(page.locator('.continuous-itinerary')).toBeVisible()
})


test('shows polished migration menu hover feedback without list bullets', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '导入导出' }).click()
  const menu = page.locator('.home-migration-menu')
  const items = menu.locator('.el-dropdown-menu__item')
  await expect(items).toHaveCount(3)
  expect(await items.evaluateAll((elements) => elements.every((element) => getComputedStyle(element).listStyleType === 'none'))).toBe(true)
  const planItem = items.filter({ hasText: '仅旅行计划' })
  await planItem.hover()
  await page.waitForTimeout(220)
  expect(await planItem.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  expect(await planItem.locator('.home-migration-option').evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1')
})

test('exports and restores all travel plans from a JSON backup', async ({ page }) => {
  await page.goto('/')
  const initialCount = await page.locator('.plan-card').count()
  await page.getByRole('button', { name: '导入导出' }).click()
  await page.getByText('仅旅行计划', { exact: true }).click()
  const modal = page.locator('.plan-backup-modal')
  const downloadPromise = page.waitForEvent('download')
  await modal.getByRole('button', { name: '下载备份' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('旅行计划备份-')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  await modal.locator('input[type="file"]').setInputFiles(downloadPath!)
  await expect(modal).toContainText(`${initialCount} 个计划`)
  await modal.getByRole('button', { name: `导入 ${initialCount} 个计划` }).click()
  await expect(page.locator('.plan-card')).toHaveCount(initialCount * 2)
})

test('exports and restores plans plus service configuration from one complete migration file', async ({ page }) => {
  test.slow()
  await page.goto('/')
  await page.evaluate(() => {
    const profile = { id: 'complete-backup-ai', name: '完整迁移 AI', presetId: null, protocol: 'openai-chat-completions', baseUrl: 'https://ai.example.com/v1', models: ['model-a'], model: 'model-a', timeoutSeconds: 90, contextWindowTokens: 128000, maxInputTokens: 120000, maxOutputTokens: 8000, systemPrompt: 'test' }
    localStorage.setItem('interactiveTravel.ai.providers.v1', JSON.stringify({ profiles: [profile], activeId: profile.id }))
    localStorage.setItem('interactiveTravel.ai.secrets.local.v1', JSON.stringify({ [profile.id]: 'complete-secret' }))
  })
  const initialCount = await page.locator('.plan-card').count()
  await page.getByRole('button', { name: '导入导出' }).click()
  await page.getByText('完整迁移', { exact: true }).click()
  const modal = page.locator('.complete-backup-modal')
  await expect(modal).toContainText(`${initialCount} 个计划`)
  await expect(modal).toContainText('1 个实例 · 1 个密钥')
  const downloadPromise = page.waitForEvent('download')
  await modal.getByRole('button', { name: '下载完整迁移文件' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('行途规划-完整迁移-')
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  await modal.locator('input[type="file"]').setInputFiles(downloadPath!)
  await expect(modal).toContainText('包含敏感凭据')
  await expect(modal.locator('.complete-import-sections')).toContainText(`旅行计划`)
  await expect(modal.locator('.complete-import-sections')).toContainText(`AI 1 个`)
  await modal.getByRole('button', { name: '恢复全部并重新加载' }).click()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('.plan-card')).toHaveCount(initialCount * 2)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('interactiveTravel.ai.secrets.local.v1') ?? '{}')['complete-backup-ai'])).toBe('complete-secret')
})

test('opens a plan from home with immediate transition feedback', async ({ page }) => {
  await page.goto('/')
  const startedAt = await page.evaluate(() => {
    const start = performance.now()
    ;(document.querySelector('.plan-card') as HTMLElement).click()
    return start
  })
  await expect(page.locator('.plan-opening-screen, .planner-headline')).toBeVisible({ timeout: 1_500 })
  await expect(page.locator('.continuous-itinerary')).toBeVisible({ timeout: 3_000 })
  expect(await page.evaluate((start) => performance.now() - start, startedAt)).toBeLessThan(3_000)

  await page.getByRole('button', { name: '全部计划' }).click()
  const reopenStartedAt = await page.evaluate(() => {
    const start = performance.now()
    ;(document.querySelector('.plan-card') as HTMLElement).click()
    return start
  })
  await expect(page.locator('.continuous-itinerary')).toBeVisible({ timeout: 1_500 })
  expect(await page.evaluate((start) => performance.now() - start, reopenStartedAt)).toBeLessThan(1_500)
})

test('shows the home page and creates an exact-time plan', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '我的旅行计划' })).toBeVisible()
  await expect(page.locator('.plan-card')).toHaveCount(1)

  await page.locator('.home-create-top').click()
  const modal = page.locator('.plan-editor-modal')
  await page.getByLabel('计划名称').fill('新的城市漫游')
  await page.getByLabel('参与人员 1 姓名').fill('张三')
  await page.getByLabel('参与人员 1 年龄').fill('32')
  await modal.getByRole('button', { name: '添加人员' }).click()
  await page.getByLabel('参与人员 2 姓名').fill('李四')
  await page.getByLabel('参与人员 2 年龄').fill('28')
  await modal.getByRole('button', { name: '添加人员' }).click()
  await page.getByLabel('参与人员 3 姓名').fill('临时同行者')
  await modal.getByTitle('删除参与人员 3').click()
  await page.getByLabel('总预算').fill('12000')
  await page.getByPlaceholder('选择开始日期').click()
  await expect(page.locator('.el-picker-panel:visible')).toBeVisible()
  await expect(page.getByPlaceholder('开始时刻')).toHaveValue('08:00:00')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '创建并进入规划' }).last().click()

  await expect(page.locator('.tripname')).toHaveText('新的城市漫游')
  await expect(page.locator('.daytab')).toHaveCount(3)
  await expect(page.locator('.planner-head-metric')).toContainText('0 / 0 地点')
  await expect(page.locator('.poolcard[data-place]')).toHaveCount(0)
  await expect(page.locator('.header-budget-button')).toContainText('预算 ¥12,000')
  await expect(page.locator('.travel-marker')).toHaveCount(0)
  await page.getByRole('button', { name: '全部计划' }).click()
  const createdCard = page.locator('.plan-card').filter({ hasText: '新的城市漫游' })
  await expect(createdCard).toBeVisible()
  await expect(createdCard).toContainText(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:00/)
  await expect(createdCard).toContainText('张三')
  await expect(createdCard).toContainText('李四')
  await expect(createdCard).toContainText('32 岁')
  await expect(createdCard).toContainText('28 岁')
  await expect(createdCard).toContainText('总预算')
  await expect(createdCard).toContainText('¥12,000')
})

test('edits a plan from the home page', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.plan-card').first()
  await card.getByTitle('编辑计划').click()
  const modal = page.locator('.plan-editor-modal')
  await modal.locator('input').first().fill('川西秋日自驾')
  await expect(modal.locator('.participant-editor-row')).toHaveCount(2)
  await modal.getByTitle('删除参与人员 2').click()
  await modal.getByRole('button', { name: '添加人员' }).click()
  await modal.getByLabel('参与人员 2 姓名').fill('王五')
  await modal.getByLabel('参与人员 2 年龄').fill('35')
  await modal.getByLabel('总预算').fill('15000')
  await modal.getByRole('button', { name: '保存修改' }).click()
  const updatedCard = page.locator('.plan-card').first()
  await expect(updatedCard).toContainText('川西秋日自驾')
  await expect(updatedCard).toContainText('王五')
  await expect(updatedCard).toContainText('35 岁')
  await expect(updatedCard).toContainText('¥15,000')
})

test('auto-saves the current plan and returns home from the planner header', async ({ page }) => {
  await expect(page.locator('.autosave-status')).toContainText('已自动保存')
  await expect(page.getByRole('button', { name: '保存计划' })).toHaveCount(0)
  await page.getByRole('button', { name: '全部计划' }).click()
  await expect(page.getByRole('heading', { name: '我的旅行计划' })).toBeVisible()
  await expect(page.locator('.plan-card').first()).toContainText('最近编辑')
})

test('switches unarranged places between card and list views', async ({ page }) => {
  const poolList = page.locator('.poollist')
  await expect(poolList).toHaveClass(/card-view/)
  await expect.poll(() => poolList.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)

  await page.getByTitle('列表视图').click()
  await expect(poolList).toHaveClass(/list-view/)
  await expect.poll(() => poolList.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)

  await page.getByTitle('卡片视图').click()
  await expect(poolList).toHaveClass(/card-view/)
})

test('resizes the unarranged place panel and restores the saved height', async ({ page }) => {
  const pool = page.locator('.pool')
  const itinerary = page.locator('.itinerary')
  const handle = page.getByRole('separator', { name: '调整未安排地点面板高度' })
  const initialPoolHeight = await pool.evaluate((element) => element.getBoundingClientRect().height)
  const initialItineraryHeight = await itinerary.evaluate((element) => element.getBoundingClientRect().height)
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Pool resize handle unavailable')

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y - 78, { steps: 5 })
  await page.mouse.up()

  const resizedHeight = await pool.evaluate((element) => element.getBoundingClientRect().height)
  expect(resizedHeight).toBeGreaterThan(initialPoolHeight + 50)
  await expect.poll(() => itinerary.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(initialItineraryHeight - 50)
  expect(await page.evaluate(() => Number(localStorage.getItem('interactiveTravel.pool.height')))).toBe(Math.round(resizedHeight))

  await page.reload()
  await expect(page.getByRole('separator', { name: '调整未安排地点面板高度' })).toBeVisible()
  await expect.poll(() => pool.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(Math.round(resizedHeight))
})

test('clears all unarranged places without affecting scheduled stops and supports undo', async ({ page }) => {
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 15_000 })
  await expect(page.locator('.poolcard[data-place]')).toHaveCount(5)
  await page.getByTitle('一键清空未安排地点').click()
  const confirmation = page.locator('.el-popconfirm')
  await expect(confirmation).toContainText('清空全部 5 个未安排地点')
  await expect(confirmation).toContainText('已安排地点不会受到影响')
  await confirmation.getByRole('button', { name: '确认清空' }).click()

  await expect(page.locator('.poolcard[data-place]')).toHaveCount(0)
  await expect(page.locator('.stopcard')).toHaveCount(4)
  await expect(page.locator('.travel-marker')).toHaveCount(6)
  await expect(page.locator('.toast')).toContainText('已清空 5 个未安排地点')

  await page.getByTitle('撤销').click()
  await expect(page.locator('.poolcard[data-place]')).toHaveCount(5)
  await expect(page.locator('.travel-marker')).toHaveCount(11)
})

test('changes an unarranged place priority and includes must-go places in plan checks', async ({ page }) => {
  const candidate = page.locator('.poolcard[data-place="yuzu"]')
  const priority = candidate.getByRole('button', { name: /地点优先级/ })
  await expect(priority).toContainText('备选')
  await expect(page.locator('.statuspill')).toContainText('计划可行')

  await priority.click()
  await page.locator('.place-priority-menu:visible .el-dropdown-menu__item').filter({ hasText: '必去' }).click()

  await expect(priority).toContainText('必去')
  await expect(page.locator('.toast')).toContainText('已将“鱼子西”设为必去')
  await expect(page.getByText('1 个问题待处理')).toBeVisible()

  await page.getByTitle('撤销').click()
  await expect(priority).toContainText('备选')
  await expect(page.locator('.statuspill')).toContainText('计划可行')
})

test('reorders unarranged places by drag and supports undo', async ({ page }) => {
  const cards = page.locator('.poolcard[data-place]')
  await expect(cards.first()).toContainText('猫鼻梁')

  const source = page.locator('.poolcard').filter({ hasText: '新都桥' })
  const target = page.locator('.poolcard').filter({ hasText: '猫鼻梁' })
  await source.dragTo(target, { targetPosition: { x: 2, y: 20 } })
  await expect(cards.first()).toContainText('新都桥')
  await expect(page.locator('.toast')).toContainText('已调整未安排地点顺序')

  await page.getByTitle('撤销').click()
  await expect(cards.first()).toContainText('猫鼻梁')
})

test('sorts unarranged places by recorded added time', async ({ page }) => {
  test.slow()
  const cards = page.locator('.poolcard[data-place]')
  const sortSelect = page.locator('.pool-sort-select')

  await sortSelect.click()
  await page.locator('.el-select-dropdown__item').filter({ hasText: '最近添加优先' }).click()
  await expect(cards.first()).toContainText('鱼子西')
  await expect(page.locator('.pool-guidance')).toContainText('当前按添加时间排序')

  await sortSelect.click()
  await page.locator('.el-select-dropdown__item').filter({ hasText: '最早添加优先' }).click()
  await expect(cards.first()).toContainText('猫鼻梁')

  await sortSelect.click()
  await page.locator('.el-select-dropdown__item').filter({ hasText: '自定义排序' }).click()
  await expect(cards.first()).toContainText('猫鼻梁')
})

test('deletes an unarranged place after confirmation and supports undo', async ({ page }) => {
  await expect(page.locator('.travel-marker')).toHaveCount(11, { timeout: 15_000 })
  const candidate = page.locator('.poolcard').filter({ hasText: '猫鼻梁' })
  await candidate.getByTitle('删除未安排地点').click()
  const confirmation = page.locator('.el-popconfirm')
  await expect(confirmation).toContainText('从未安排地点中删除“猫鼻梁”')
  await confirmation.getByRole('button', { name: '删除' }).click()

  await expect(candidate).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('已从未安排地点删除“猫鼻梁”')
  await expect(page.locator('.travel-marker')).toHaveCount(10)

  await page.getByTitle('撤销').click()
  await expect(page.locator('.poolcard').filter({ hasText: '猫鼻梁' })).toBeVisible()
  await expect(page.locator('.travel-marker')).toHaveCount(11)
})


test('switches between itinerary and map on touch-sized screens', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 })
  const switcher = page.locator('.mobile-pane-switch')
  await expect(switcher).toBeVisible()
  await expect(page.locator('.workspace > .left')).toBeVisible()
  await expect(page.locator('.workspace > .map')).toBeHidden()
  await switcher.getByRole('button', { name: '地图' }).click()
  await expect(page.locator('.workspace > .map')).toBeVisible()
  await expect(page.locator('.workspace > .left')).toBeHidden()
  await switcher.getByRole('button', { name: '行程' }).click()
  await expect(page.locator('.workspace > .left')).toBeVisible()
})

test('resizes and persists the planner sidebar width', async ({ page }) => {
  const sidebar = page.locator('.left')
  const handle = page.locator('.workspace-resize-handle')
  await expect(handle).toBeVisible()
  const before = await sidebar.boundingBox()
  const grip = await handle.boundingBox()
  if (!before || !grip) throw new Error('Planner resize bounds unavailable')

  await page.mouse.move(grip.x + grip.width / 2, grip.y + 240)
  await page.mouse.down()
  await page.mouse.move(grip.x + 170, grip.y + 240, { steps: 8 })
  await page.mouse.up()

  const after = await sidebar.boundingBox()
  expect(after!.width).toBeGreaterThan(before.width + 120)
  const savedWidth = await page.evaluate(() => Number(localStorage.getItem('interactiveTravel.planner.sidebarWidth')))
  expect(savedWidth).toBeGreaterThan(before.width + 120)
  expect(await page.locator('.dayboardhead').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

  await page.reload()
  await expect(page.locator('.continuous-itinerary')).toBeVisible()
  const restored = await page.locator('.left').boundingBox()
  expect(Math.abs(restored!.width - savedWidth)).toBeLessThan(3)

  await page.locator('.workspace-resize-handle').dblclick()
  const reset = await page.locator('.left').boundingBox()
  expect(Math.abs(reset!.width - 520)).toBeLessThan(3)
})

test('uses themed scroll containers for days and place lists', async ({ page }) => {
  const values = await page.evaluate(() => {
    const days = getComputedStyle(document.querySelector('.daytabs')!)
    const places = getComputedStyle(document.querySelector('.poollist')!)
    const itinerary = getComputedStyle(document.querySelector('.itinerary')!)
    return {
      dayOverflow: days.overflowX,
      placeOverflow: places.overflowY,
      itineraryOverflow: itinerary.overflowY,
      placeDisplay: places.display,
    }
  })
  expect(values.dayOverflow).toBe('auto')
  expect(values.placeOverflow).toBe('auto')
  expect(values.itineraryOverflow).toBe('auto')
  expect(values.placeDisplay).toBe('grid')
})

test('moves only the route summary and place detail floating panels', async ({ page }) => {
  const routePanel = page.locator('.floating-route-summary')
  await expect(routePanel).toBeVisible({ timeout: 15_000 })
  const beforeRoute = await routePanel.boundingBox()
  if (!beforeRoute) throw new Error('route panel has no bounds')
  await page.mouse.move(beforeRoute.x + 60, beforeRoute.y + 20)
  await page.mouse.down()
  await page.mouse.move(beforeRoute.x - 140, beforeRoute.y + 120, { steps: 8 })
  await page.mouse.up()
  const afterRoute = await routePanel.boundingBox()
  expect(afterRoute?.x).not.toBe(beforeRoute.x)
  expect(afterRoute?.y).not.toBe(beforeRoute.y)

  await page.locator('.poolcard').filter({ hasText: '新都桥' }).click()
  const placePanel = page.locator('.floating-place-card')
  await expect(placePanel).toBeVisible()
  const beforePlace = await placePanel.boundingBox()
  if (!beforePlace) throw new Error('place panel has no bounds')
  const handle = placePanel.locator('.floating-panel-drag-handle')
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error('place panel handle has no bounds')
  await page.mouse.move(handleBox.x + 70, handleBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(handleBox.x - 170, handleBox.y + 90, { steps: 8 })
  await page.mouse.up()
  const afterPlace = await placePanel.boundingBox()
  expect(afterPlace?.x).not.toBe(beforePlace.x)
  expect(afterPlace?.y).not.toBe(beforePlace.y)
})

test('uses custom zoom controls instead of the AMap toolbar', async ({ page }) => {
  await expect(page.getByTitle('缩小地图')).toBeVisible()
  await expect(page.getByTitle('放大地图')).toBeVisible()
  await expect(page.locator('.amap-toolbar')).toHaveCount(0)
})

test('shows the current plan lifecycle status in the planner', async ({ page }) => {
  const status = page.locator('.plan-timeline-status')
  await expect(status).toContainText('未开始')
  await expect(status).toContainText('后出发')
  await expect(status).not.toContainText('距离开始还有')
  expect((await status.boundingBox())!.height).toBeLessThan(26)
  await expect(page.locator('.paneltitle, .summaryline')).toHaveCount(0)
})


test('selects a route segment from the map and links it to the itinerary', async ({ page }) => {
  const label = page.locator('.map-route-info').first()
  await expect(label).toBeVisible({ timeout: 20_000 })
  await label.click()
  await expect(page.locator('.transport-segment.selected')).toHaveCount(1)
  await expect(page.locator('.transport-segment.selected')).toBeInViewport()
})

test('creates automatic plan versions before later edits', async ({ page }) => {
  await page.locator('.poolcard').filter({ hasText: '猫鼻梁' }).locator('.addmini').click()
  await page.getByRole('button', { name: '全部计划' }).click()
  await page.getByRole('button', { name: '导入导出' }).click()
  await page.getByText('仅旅行计划', { exact: true }).click()
  const history = page.locator('.plan-history-section').first()
  await expect(history).toContainText('自动保存前')
  await history.getByRole('button', { name: '恢复', exact: true }).first().click()
  await page.locator('.el-popconfirm:visible').getByRole('button', { name: '恢复', exact: true }).click()
  await page.locator('.plan-backup-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('.plan-card').first().click()
  await expect(page.locator('.stopcard[data-place="maobi"]')).toHaveCount(0)
})

test('keeps the map legend collapsed and removes the redundant itinerary add prompt', async ({ page }) => {
  await expect(page.locator('.map-legend .category-filters')).toHaveCount(0)
  await expect(page.getByText('全部类型')).toHaveCount(0)
  await expect(page.getByText('从未安排地点中添加')).toHaveCount(0)
  await expect(page.getByText('拖动可调整顺序或放入行程')).toBeVisible()
  await page.getByTitle('地点图例').click()
  await expect(page.locator('.map-legend .category-filters')).toBeVisible()
  await expect(page.getByText('全部类型')).toHaveCount(0)
})

test('uses the themed Element Plus component layer for primary surfaces', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.plan-card.el-card')).toBeVisible()
  await expect(page.locator('.home-create-top.el-button')).toBeVisible()
  await page.locator('.home-create-top').click()
  await expect(page.locator('.plan-editor-modal.el-dialog')).toBeVisible()
  await expect(page.locator('.plan-editor-modal .plan-date-time-combo .el-date-editor')).toHaveCount(4)
  await expect(page.locator('.plan-editor-modal .plan-budget-field .el-input-number')).toBeVisible()
  await expect(page.locator('.plan-editor-modal .participant-editor-row')).toHaveCount(1)
})

test('deletes a plan only after explicit confirmation', async ({ page }) => {
  await page.goto('/')
  const card = page.locator('.plan-card').first()
  const title = await card.locator('.plan-card-title').textContent()
  await card.getByTitle('删除计划').click()
  const confirmDialog = page.locator('.travel-confirm-dialog')
  await expect(confirmDialog).toContainText(`确定删除“${title}”吗`)
  await confirmDialog.getByRole('button', { name: '取消' }).click()
  await expect(page.locator('.plan-card')).toHaveCount(1)

  await card.getByTitle('删除计划').click()
  await confirmDialog.getByRole('button', { name: '移入回收站' }).click()
  await expect(page.locator('.plan-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '还没有旅行计划' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建旅行计划' })).toBeVisible()
  await page.getByRole('button', { name: '打开回收站' }).click()
  const backup = page.locator('.plan-backup-modal')
  await expect(backup.locator('.plan-history-section.recycle')).toContainText(title ?? '')
  await backup.locator('.plan-history-section.recycle').getByRole('button', { name: '恢复', exact: true }).click()
  await backup.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.locator('.plan-card')).toHaveCount(1)
})

test('edits plan timing from the planner header', async ({ page }) => {
  await page.getByTitle('编辑计划信息').click()
  await expect(page.getByRole('heading', { name: '编辑旅行计划' })).toBeVisible()
  await page.getByPlaceholder('选择开始日期').click()
  await expect(page.locator('.el-picker-panel:visible')).toBeVisible()
  await expect(page.getByPlaceholder('开始时刻')).toHaveValue('08:00:00')
})

test('adds dates independently from the beginning or end of the list', async ({ page }) => {
  const startControls = page.locator('.day-boundary-control.start')
  const endControls = page.locator('.day-boundary-control.end')
  await expect.poll(() => startControls.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column')
  await expect.poll(() => endControls.evaluate((element) => getComputedStyle(element).flexDirection)).toBe('column')
  await expect(page.locator('.daytab')).toHaveCount(6)

  await page.getByTitle('向前增加一天').click()
  await expect(page.locator('.daytab')).toHaveCount(7)
  await expect(page.locator('.daytab').first()).toContainText('10/01')
  await expect(page.locator('.tripmeta')).toContainText('10 月 1 日')
  await expect(page.locator('.toast')).toContainText('已在行程前方增加一天')

  await page.getByTitle('向后增加一天').click()
  await expect(page.locator('.daytab')).toHaveCount(8)
  await expect(page.locator('.daytab').last()).toContainText('10/08')
  await expect(page.locator('.tripmeta')).toContainText('10 月 8 日')
})

test('can remove a day from the beginning while preserving overlapping calendar dates', async ({ page }) => {
  await page.getByTitle('移除第一天').click()

  const retention = page.locator('.reduce-days-dialog')
  await expect(retention).toContainText('原日期将移出新的计划范围')
  await expect(retention).toContainText('重庆')
  await retention.getByRole('button', { name: /返回未安排地点/ }).click()

  await expect(page.locator('.daytab')).toHaveCount(5)
  await expect(page.locator('.daytab').first()).toContainText('10/03')
  await expect(page.locator('.daytab').first()).toContainText('Day 1')
  await expect(page.locator('.stopcard')).toHaveCount(4)
  await expect(page.locator('.poolcard').filter({ hasText: '重庆' })).toBeVisible()
})

test('removes an empty boundary day without opening a confirmation dialog', async ({ page }) => {
  await expect(page.locator('.daytab').last()).toContainText('Day 6')
  await page.getByTitle('移除最后一天').click()
  await expect(page.locator('.reduce-days-dialog')).toHaveCount(0)
  await expect(page.locator('.daytab')).toHaveCount(5)
  await expect(page.locator('.toast')).toContainText('已从行程尾部移除一天')
})

test('asks how to retain places when reducing a populated day', async ({ page }) => {
  await page.locator('.daytab').filter({ hasText: 'Day 6' }).click()
  const candidate = page.locator('.poolcard').filter({ hasText: '猫鼻梁' })
  await candidate.locator('.addmini').click()
  await expect(page.locator('.stopcard').filter({ hasText: '猫鼻梁' })).toBeVisible()

  await page.getByTitle('移除最后一天').click()
  const dialog = page.locator('.reduce-days-dialog')
  await expect(dialog).toContainText('猫鼻梁')
  await expect(dialog.getByRole('button', { name: /返回未安排地点/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /不保留这些地点/ })).toBeVisible()
  await dialog.getByRole('button', { name: /返回未安排地点/ }).click()

  await expect(page.locator('.toast')).toContainText('地点已返回未安排列表')
  await expect(page.locator('.daytab')).toHaveCount(5)
  await expect(page.locator('.poolcard').filter({ hasText: '猫鼻梁' })).toBeVisible()
})

test('can discard places while reducing a populated day', async ({ page }) => {
  await page.locator('.daytab').filter({ hasText: 'Day 6' }).click()
  const candidate = page.locator('.poolcard').filter({ hasText: '新都桥' })
  await candidate.locator('.addmini').click()
  await page.getByTitle('移除最后一天').click()
  const dialog = page.locator('.reduce-days-dialog')
  await dialog.getByRole('button', { name: /不保留这些地点/ }).click()

  await expect(page.locator('.daytab')).toHaveCount(5)
  await expect(page.locator('.poolcard').filter({ hasText: '新都桥' })).toHaveCount(0)
  await expect(page.locator('.toast')).toContainText('并删除当日地点')
})

test('shows provider-backed place information inside the existing map card', async ({ page }) => {
  await page.locator('.stopcard[data-place="shuang"]').click()
  const card = page.locator('.floating-place-card')
  await expect(card).toContainText('地点介绍')
  await expect(card).toContainText('高德地图 POI')
  await expect(card.locator('.structured-place-summary')).toContainText('高德地图中归类为', { timeout: 15_000 })
  const photos = card.locator('.place-photo-strip .el-image')
  await expect(photos.first()).toBeVisible({ timeout: 15_000 })
  expect(await photos.count()).toBeGreaterThan(1)
  await photos.first().click()
  const viewer = page.locator('.el-image-viewer__wrapper')
  await expect(viewer).toBeVisible()
  const previewImage = viewer.locator('.el-image-viewer__canvas img')
  const firstPreviewSrc = await previewImage.getAttribute('src')
  await viewer.locator('.el-image-viewer__next').click()
  await expect.poll(() => previewImage.getAttribute('src')).not.toBe(firstPreviewSrc)
  await viewer.locator('.el-image-viewer__close').click()
  await expect(viewer).toHaveCount(0)
  await expect(card.locator('.place-data-reliability')).toHaveCount(0)
  await expect(card.locator('.place-source-note')).toHaveCount(0)
  expect(await card.locator('.place-photo-strip img').count()).toBeGreaterThan(0)
})
