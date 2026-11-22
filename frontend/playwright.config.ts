import { defineConfig } from '@playwright/test'

// 通しテスト（E2E）の設定。回し方は `npm run e2e`（手元ではビルドしてから `vite preview` で出す）。
// 公開するのはビルド済みの静的ファイルなので、開発サーバーではなくビルド済みを出して確かめる。

/** 通しテストで立てるサーバーの置き場（ポートと URL はここだけに書く） */
const HOST = '127.0.0.1'
const PORT = 4173
const BASE_URL = `http://${HOST}:${PORT}/`

/** CI（GitHub Actions）の中か */
const isCI = Boolean(process.env.CI)

/** ビルド済み（dist）を出すコマンド。CI はビルドを別の手順で済ませるので、出すだけにする */
const preview = `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`

export default defineConfig({
  testDir: './e2e',
  // CI で test.only の消し忘れを落とす
  forbidOnly: isCI,
  // CI の揺れだけ 1 回やり直す。手元では落ちたらすぐ分かるよう 0
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    // 公開の条件 1 がスマホの幅なので、スマホの大きさを既定にする
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // 同じ通しテストを、スマホの幅（既定の 390×844）と PC の幅（1280px）の 2 つで回す。CI の `npm run e2e` がそのまま両方を回す
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'chromium-desktop',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: isCI ? preview : `npm run build && ${preview}`,
    url: BASE_URL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
