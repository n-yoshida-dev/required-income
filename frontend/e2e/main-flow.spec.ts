import { expect, test, type Page } from '@playwright/test'

// 主な操作 1 本の通しテスト（公開の条件 2）：目標を足す → 階段が変わる → 見直して採用 → 開き直しても残る。
// あわせて、各画面で横にはみ出さないこと（公開の条件 1）、画面のエラーが無いこと、
// アプリの出どころ以外へ通信しないこと（公開の条件 3「入力がブラウザの外へ出ない」）を確かめる。
// 金額はテストに書かず、「前と違う」「案と同じ」で比べる（見本の値や制度の数値が変わっても落ちないように）。

/** 階段の段の読み上げ名（年と金額）を上から順に。階段が変わったかを比べる */
async function stairLabels(page: Page): Promise<string[]> {
  return page
    .getByRole('group', { name: '階段' })
    .getByRole('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''))
}

/** 階段が出るまで待ってから、その読み上げ名を返す */
async function shownStairs(page: Page): Promise<string[]> {
  await expect(page.getByRole('group', { name: '階段' }).getByRole('button').first()).toBeVisible()
  return stairLabels(page)
}

/**
 * 階段が `from` から変わるまで待ち、変わった後の読み上げ名を返す。
 * 画面の移り変わりの途中は階段が無く `[]` になるので、段が 1 つ以上あることも見る（空の配列との比較で通さない）
 */
async function changedStairs(page: Page, from: string[]): Promise<string[]> {
  let latest: string[] = []
  await expect
    .poll(async () => {
      latest = await stairLabels(page)
      return latest.length > 0 && JSON.stringify(latest) !== JSON.stringify(from)
    })
    .toBe(true)
  return latest
}

/** 下のタブで移る */
async function goTo(page: Page, tab: 'ながめる' | '計画' | '見直す'): Promise<void> {
  await page.getByRole('link', { name: tab }).click()
}

/** 横にはみ出していないこと（スマホの幅で横に送れる画面にしない） */
async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(size.scrollWidth, `${where}で横にはみ出している`).toBeLessThanOrEqual(size.clientWidth)
}

test('目標を足す → 階段が変わる → 見直して採用 → 開き直しても残る', async ({ page, baseURL }) => {
  if (baseURL === undefined) throw new Error('baseURL が設定されていない')
  const appOrigin = new URL(baseURL).origin

  // アプリの出どころ以外への通信（data: や blob: はブラウザの外へ出ないので数えない）
  const outside: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    if (url.origin !== appOrigin) outside.push(request.url())
  })
  // 画面のエラー（console の error と、捕まえられなかった例外）
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  // 1. 開くと、ボタンを押さずに見本の世帯の概要の枠と階段が出る
  await page.goto('./')
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  const sampleStairs = await shownStairs(page)
  expect(sampleStairs.length).toBeGreaterThan(0)
  await expectNoHorizontalOverflow(page, '見本の「ながめる」')

  // 2. 「自分の数字にする」で自分の計画を始める（「計画」へ移る）
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { name: '計画' })).toBeVisible()

  // 目標を足す前の階段を覚えておく
  await goTo(page, 'ながめる')
  const before = await shownStairs(page)

  // 「計画」で家を足す（雛形の値で入り、その場で保存される）
  await goTo(page, '計画')
  await page.getByRole('button', { name: '家を足す' }).click()
  await expectNoHorizontalOverflow(page, '「計画」')

  // 3. 「ながめる」に戻ると、階段が足す前と変わっている
  await goTo(page, 'ながめる')
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  const withHome = await changedStairs(page, before)

  // 4. 「見直す」で家をオフにすると、階段がその場で変わる → 「この案にする」
  await goTo(page, '見直す')
  await expect.poll(() => stairLabels(page)).toEqual(withHome)
  await expect(page.getByRole('button', { name: 'この案にする' })).toBeDisabled()
  await page.getByRole('checkbox', { name: '家' }).uncheck()
  const draft = await changedStairs(page, withHome)
  await expectNoHorizontalOverflow(page, '「見直す」')

  await page.getByRole('button', { name: 'この案にする' }).click()
  await expect(page.getByRole('button', { name: '今の計画にしました' })).toBeDisabled()

  // 5. 「ながめる」に案が反映されていて、開き直しても残っている
  await goTo(page, 'ながめる')
  await expect.poll(() => stairLabels(page)).toEqual(draft)
  await expectNoHorizontalOverflow(page, '採用した後の「ながめる」')

  await page.reload()
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  await expect.poll(() => stairLabels(page)).toEqual(draft)
  await goTo(page, '見直す')
  await expect(page.getByRole('checkbox', { name: '家' })).not.toBeChecked()

  expect(errors, '画面のエラー').toEqual([])
  expect(outside, 'アプリの出どころ以外への通信').toEqual([])
})
