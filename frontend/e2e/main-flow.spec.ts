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

/** 家族の区分の題（「自分の数字にする」を押すと、ここへ移る。T21） */
const FAMILY_TITLE = '家族の生まれ年を入れましょう'

/** 「計画」の区分の帯で区分へ移る（帯の字は「4 目標」など。済んだ区分には読み上げの「済み」が付く） */
async function showSection(page: Page, label: '家族' | '収入' | '暮らし' | '目標'): Promise<void> {
  await page
    .getByRole('navigation', { name: '計画の区分' })
    .getByRole('link', { name: new RegExp(`^\\d ${label}`) })
    .click()
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

  // 2. 「自分の数字にする」で自分の計画を始める（「計画」の家族へ移る）
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()

  // 入力の途中の「ながめる」は、結果（概要の枠と階段）を出さず「続きを入れる」だけ（T25）
  await goTo(page, 'ながめる')
  await expect(page.getByRole('link', { name: '続きを入れる' })).toBeVisible()
  await expect(page.getByRole('region', { name: '概要' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '階段' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page, '入力の途中の「ながめる」')
  const before: string[] = []

  // 「計画」の目標の区分で家を足す（雛形の値で入り、その場で保存される）
  await goTo(page, '計画')
  await showSection(page, '目標')
  await page.getByRole('button', { name: '家を足す' }).click()
  await expectNoHorizontalOverflow(page, '「計画」')

  // 目標を足しても、入力の途中なら「ながめる」は「続きを入れる」だけ（見本の値が残っているため。W35）
  await goTo(page, 'ながめる')
  await expect(page.getByRole('link', { name: '続きを入れる' })).toBeVisible()
  await expect(page.getByRole('region', { name: '概要' })).toHaveCount(0)
  // 「見直す」も同じ。数字・階段・動かす欄を出さない
  await goTo(page, '見直す')
  await expect(page.getByRole('link', { name: '続きを入れる' })).toBeVisible()
  await expect(page.getByRole('group', { name: '階段' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: '家' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page, '入力の途中の「見直す」')

  // 3. 「要る年収を見る」で入力を終えると、概要の枠と階段が出る
  await goTo(page, '計画')
  await showSection(page, '目標')
  await page.getByRole('button', { name: '要る年収を見る' }).click()
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
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()
  await showSection(page, '目標')

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

  // 私立理系のときの階段を覚えておく（入力の途中は結果が出ないので、「要る年収を見る」で入力を終える。W35）
  await page.getByRole('button', { name: '要る年収を見る' }).click()
  const withScience = await shownStairs(page)

  // 「計画」に戻ってカードを開き、私立文系 → 国立と選ぶと、目標額がその進路の額に替わる
  await goTo(page, '計画')
  await showSection(page, '目標')
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
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()
  await showSection(page, '目標')
  await page.getByRole('button', { name: '家を足す' }).click()

  // 目標のページのいちばん下の「見本の世帯に戻す」は 2 回押し。1 回目は言葉が変わるだけ
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

// T21：「自分の数字にする」のあと、案内のとおり 4 つの区分を「次へ」で進むと自分の計画が埋まり、「ながめる」の図に着く
test('自分の数字にする → 家族 → 次へ ×3 → 目標を 1 つ足す → 要る年収を見る → ながめるの図', async ({
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
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()
  await expectNoHorizontalOverflow(page, '家族の区分')

  // 家族 → 収入 → 暮らし → 目標（区分ごとに題が替わり、横にはみ出さない）
  const steps = [
    { next: '次へ：収入', title: '今の収入を入れましょう', where: '収入の区分' },
    { next: '次へ：暮らし', title: '毎月の暮らしにかかるお金は？', where: '暮らしの区分' },
    { next: '次へ：目標', title: 'やりたいことをひとつ足してみましょう', where: '目標の区分' },
  ]
  for (const step of steps) {
    await page.getByRole('button', { name: step.next }).click()
    await expect(page.getByRole('heading', { level: 1, name: step.title })).toBeVisible()
    await expectNoHorizontalOverflow(page, step.where)
  }

  // 目標を 1 つ足すと、最後のボタンが「目標はあとで足す」から「要る年収を見る」に替わる
  await expect(page.getByRole('button', { name: '目標はあとで足す' })).toBeVisible()
  await page.getByRole('button', { name: '家を足す' }).click()
  await page.getByRole('button', { name: '要る年収を見る' }).click()

  // 「ながめる」の概要の枠と階段の図に着く。目標の一覧に足した家がある
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  expect((await shownStairs(page)).length).toBeGreaterThan(0)
  await expect(page.getByRole('list', { name: '目標' }).getByText('家')).toBeVisible()
  await expectNoHorizontalOverflow(page, '案内を終えた「ながめる」')

  // 案内を終えたので、開き直して「計画」を開くと家族から（済みの印は出ない）
  await page.reload()
  await goTo(page, '計画')
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()
  await expect(page.getByText('済み')).toHaveCount(0)

  expect(errors, '画面のエラー').toEqual([])
})

// T25：案内を目標なしで終えると、「ながめる」は「目標を足す」だけを出し、押すと目標の区分へ。
// 途中で閉じて開き直したときは「続きを入れる」で、済んでいない最初の区分へ
test('目標なしで案内を終える → 「目標を足す」 → 目標の区分 / 途中なら「続きを入れる」 → 続きの区分', async ({
  page,
}) => {
  await page.goto('./')
  await shownStairs(page)
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()

  // 家族を済ませて閉じ、開き直す → 「続きを入れる」で収入の区分へ
  await page.getByRole('button', { name: '次へ：収入' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: '今の収入を入れましょう' }),
  ).toBeVisible()
  await page.goto('./')
  await page.reload()
  await page.getByRole('link', { name: '続きを入れる' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: '今の収入を入れましょう' }),
  ).toBeVisible()

  // 残りを進め、目標を足さずに終える
  await page.getByRole('button', { name: '次へ：暮らし' }).click()
  await page.getByRole('button', { name: '次へ：目標' }).click()
  await page.getByRole('button', { name: '目標はあとで足す' }).click()

  await expect(page.getByRole('link', { name: '目標を足す' })).toBeVisible()
  await expect(page.getByRole('link', { name: '続きを入れる' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '概要' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page, '案内を目標なしで終えた「ながめる」')

  // 「見直す」も「目標を足す」だけ（動かす欄が子の費用だけの案を出さない）
  await goTo(page, '見直す')
  await expect(page.getByRole('link', { name: '目標を足す' })).toBeVisible()
  await expect(page.getByRole('group', { name: '階段' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page, '案内を目標なしで終えた「見直す」')

  await page.getByRole('link', { name: '目標を足す' }).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'やりたいことをひとつ足してみましょう' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '車を足す' }).click()
  await goTo(page, 'ながめる')
  await expect(page.getByRole('region', { name: '概要' })).toBeVisible()
  expect((await shownStairs(page)).length).toBeGreaterThan(0)
})

// T21 の完成の条件 3：幅 375px・高さ 812px で、家族・収入・暮らしの「次へ」が送らずに見える（下のタブ 3.5rem の上、756px まで）。
// 目標の区分の最後のボタンの位置も測って残す（見えなくてよい）。どの区分も横にはみ出さない。測った数字は結果の添え書きに出す
test('幅 375px・高さ 812px で、家族・収入・暮らしの「次へ」が最初の画面に見える', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    '幅を 375px に固定して測るので、スマホの幅の回だけ',
  )
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('./')
  await shownStairs(page)
  await page.getByRole('button', { name: '自分の数字にする' }).click()
  await expect(page.getByRole('heading', { level: 1, name: FAMILY_TITLE })).toBeVisible()

  /** 見える範囲の下端（画面の高さから下のタブの高さを引いた所） */
  const visibleBottom = await page.evaluate(
    () =>
      window.innerHeight - (document.querySelector('.tabs')?.getBoundingClientRect().height ?? 0),
  )
  const sections = [
    { label: '家族', button: '次へ：収入', mustFit: true },
    { label: '収入', button: '次へ：暮らし', mustFit: true },
    { label: '暮らし', button: '次へ：目標', mustFit: true },
    { label: '目標', button: '目標はあとで足す', mustFit: false },
  ] as const
  const measured: string[] = []
  for (const section of sections) {
    await showSection(page, section.label)
    const button = page.getByRole('button', { name: section.button })
    await expect(button).toBeAttached()
    const box = await button.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom) }
    })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    measured.push(
      `${section.label}：上端 ${box.top}px・下端 ${box.bottom}px（見える所 ${visibleBottom}px まで）・横のはみ出し ${overflow}px`,
    )
    expect(overflow, `${section.label}の区分で横にはみ出している`).toBeLessThanOrEqual(0)
    if (section.mustFit) {
      expect(box.bottom, `${section.label}の「次へ」が最初の画面に入らない`).toBeLessThanOrEqual(
        visibleBottom,
      )
    }
  }
  testInfo.annotations.push({ type: '測った位置', description: measured.join(' ／ ') })
  console.log(measured.join('\n'))
})
