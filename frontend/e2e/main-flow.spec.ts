import { expect, test, type Locator, type Page } from '@playwright/test'

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

/** その進路の選択肢に添えてある目標額（「418」のような万円の数字の字）。金額をテストに書かないため、画面から読む */
async function courseAmount(card: Locator, course: string): Promise<string> {
  const option = card.locator('label.choice__option').filter({ hasText: course })
  return (await option.locator('.choice__amount .num').textContent()) ?? ''
}

// PR #95 の受け入れレビューの指摘：大学資金の進路を選ぶと、目標額がその進路の額に替わり、階段も変わる
test('大学資金を足す → 進路（私立理系・私立文系・国立）を選ぶと目標額が替わる → 階段が変わる', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('./')
  await shownStairs(page)
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { name: '計画' })).toBeVisible()

  // 大学資金を足すと、カードが開いた状態で入る。足した直後は私立理系
  await page.getByRole('button', { name: '大学資金（2人目）を足す' }).click()
  const card = page.locator('details[open]')
  await expect(card).toHaveCount(1)
  const courses = card.getByRole('radiogroup', { name: /^進路/ })
  const radio = (name: string) => courses.getByRole('radio', { name: new RegExp(`^${name}`) })
  const target = card.getByLabel(/^目標額/)
  await expect(radio('私立理系')).toBeChecked()
  const science = await courseAmount(card, '私立理系')
  await expect(target).toHaveValue(science)
  await expectNoHorizontalOverflow(page, '大学資金のカードを開いた「計画」')

  // 私立理系のときの階段を覚えておく
  await goTo(page, 'ながめる')
  const withScience = await shownStairs(page)

  // 「計画」に戻ってカードを開き、私立文系 → 国立と選ぶと、目標額がその進路の額に替わる
  await goTo(page, '計画')
  const universityCard = page.locator('details').filter({ hasText: '大学資金（2人目）' })
  if (!(await universityCard.evaluate((details) => (details as HTMLDetailsElement).open))) {
    await universityCard.locator('summary').click()
  }
  const courses2 = universityCard.getByRole('radiogroup', { name: /^進路/ })
  const target2 = universityCard.getByLabel(/^目標額/)
  await expect(target2).toHaveValue(science)

  const humanities = await courseAmount(universityCard, '私立文系')
  expect(humanities).not.toBe(science)
  await courses2.getByRole('radio', { name: /^私立文系/ }).check()
  await expect(target2).toHaveValue(humanities)

  const national = await courseAmount(universityCard, '国立')
  expect(national).not.toBe(humanities)
  await courses2.getByRole('radio', { name: /^国立/ }).check()
  await expect(target2).toHaveValue(national)
  await expect(courses2.getByRole('radio', { name: /^国立/ })).toBeChecked()

  // 「ながめる」の階段が、私立理系のときと変わっている
  await goTo(page, 'ながめる')
  await changedStairs(page, withScience)

  expect(errors, '画面のエラー').toEqual([])
})

// T23：自分の計画を始めたあとでも、見本の世帯に戻れる（入れた数字が消えることを 2 回押しで確かめる）
test('自分の計画を始める → 見本の世帯に戻す → 見本の印が出て、開き直しても見本のまま', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('./')
  const sampleStairs = await shownStairs(page)
  await expect(page.getByText('見本', { exact: true })).toBeVisible()

  // 自分の計画を始めて家を足す（見本と違う計画にする）
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { name: '計画' })).toBeVisible()
  await page.getByRole('button', { name: '家を足す' }).click()

  // いちばん下の「見本の世帯に戻す」は 2 回押し。1 回目は言葉が変わるだけ
  const back = page.getByRole('button', { name: '見本の世帯に戻す' })
  await back.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page, '自分の計画の「計画」のいちばん下')
  await back.click()
  await page.getByRole('button', { name: '入れた数字を消して戻す' }).click()

  // 「ながめる」の見本に戻る（階段もはじめて開いたときと同じ）
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  await expect(page.getByText('見本', { exact: true })).toBeVisible()
  await expect.poll(() => stairLabels(page)).toEqual(sampleStairs)

  await page.reload()
  await expect(page.getByText('見本', { exact: true })).toBeVisible()
  await expect.poll(() => stairLabels(page)).toEqual(sampleStairs)

  expect(errors, '画面のエラー').toEqual([])
})
