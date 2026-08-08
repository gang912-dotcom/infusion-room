import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 본문 폰트 — 자체 호스팅이라 오프라인 LAN에서도 동작한다. 앱이 쓰는 굵기만 불러온다
// (400·500·600·700). 800을 쓰는 규칙 7곳은 브라우저가 700으로 맞춘다.
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/ibm-plex-sans-kr/700.css'
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
