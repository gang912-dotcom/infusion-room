import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/static/pretendard-dynamic-subset.css' // 브랜드 폰트(자체 호스팅 · 오프라인 LAN에서도 동작)
import './index.css'
import App from './App.jsx'

// 최초 테마: 저장된 선택 우선, 없으면 기기 설정(라이트/다크) 따라감. 렌더 전에 지정해 깜빡임 방지.
const savedTheme = localStorage.getItem('iv-theme')
const initialTheme =
  savedTheme ||
  (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
document.documentElement.setAttribute('data-theme', initialTheme)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
