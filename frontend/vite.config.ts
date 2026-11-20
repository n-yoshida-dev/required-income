/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages のサブパス配信に備えて相対パスで出力する
  base: './',
  build: {
    rolldownOptions: {
      output: {
        // 大きな依存を別チャンクに分ける。アプリ本体を直しても依存側のチャンクはブラウザのキャッシュが効く。
        // Vite 8（rolldown）では manualChunks の代わりに codeSplitting.groups を使う
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            // 保存の形を確かめる Zod（`storage/planStorageV2.ts`）
            { name: 'zod', test: /node_modules[\\/]zod[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    // domain 層はブラウザ環境を必要としないため node で回す。
    // UI のテストを足すときは environmentMatchGlobs で jsdom を割り当てる。
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // 全体は既定の 5 秒のまま（緩めると「本当に固まったテスト」の検知が遅れる）。
    // 並列で回すと 5 秒を超えうる画面のテスト（`tests/app/router.test.tsx`・`tests/features/plan/PlanPage.test.tsx`）は、
    // そのファイルの中で延ばしている
    testTimeout: 5000,
    coverage: {
      provider: 'v8',
      include: ['src/domain/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
})
