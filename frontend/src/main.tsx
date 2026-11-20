import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/app.css'
import { AppRouter } from './app/router'

// 入口は新しい画面。前の版の画面（`App.tsx`・`index.css`・`features/input`・`result`・`scenario`）は T13 で消した（タグ `v1-final`）
const root = document.getElementById('root')
if (root === null) {
  throw new Error('index.html に #root がありません')
}

createRoot(root).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
