import { useCallback, useEffect, useRef, useState } from 'react'
import { getChat, sendChat, saveChatNotice } from './api'

// ─── 전체 채팅방 ─────────────────────────────────────────────────────
// 계정 전원이 같은 방 하나를 본다. 읽음 확인도 방 목록도 없다(게임 채팅창).
//
// 실시간은 폴링이다. 창이 열려 있을 때만 2초마다 since 이후를 받아간다.
// 닫혀 있을 때는 아무 요청도 안 한다 — 배지는 보드 폴링에 실려 오는 chat_latest_id가 만든다.
const POLL_MS = 2000

// 위치·크기는 이 PC에만 저장한다(단말마다 화면이 다르다). 서버로 보내지 않는다.
const BOX_KEY = 'infusion-room-chat-box'
const MIN_W = 260
const MIN_H = 220

function clampToScreen(box) {
  const maxX = Math.max(0, window.innerWidth - box.w)
  const maxY = Math.max(0, window.innerHeight - box.h)
  return {
    w: Math.max(MIN_W, Math.min(box.w, window.innerWidth)),
    h: Math.max(MIN_H, Math.min(box.h, window.innerHeight)),
    x: Math.max(0, Math.min(box.x, maxX)),
    y: Math.max(0, Math.min(box.y, maxY)),
  }
}

// 기본은 우하단. 저장된 값이 있으면 그걸 쓰되 화면 밖으로 나가 있으면 끌어들인다
// (창 크기가 작은 단말로 옮겨갔을 때 창을 영영 못 찾는 일을 막는다).
function loadBox() {
  const w = 340
  const h = 420
  const fallback = { w, h, x: Math.max(0, window.innerWidth - w - 16), y: Math.max(0, window.innerHeight - h - 16) }
  try {
    const raw = localStorage.getItem(BOX_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw)
    if (![saved?.x, saved?.y, saved?.w, saved?.h].every(Number.isFinite)) return fallback
    return clampToScreen(saved)
  } catch {
    return fallback
  }
}

function hhmm(ms) {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPanel({ account, onClose, onSeen }) {
  const [box, setBox] = useState(loadBox)
  const [messages, setMessages] = useState([])
  const [notice, setNotice] = useState(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [noticeEditing, setNoticeEditing] = useState(false)
  const [noticeDraft, setNoticeDraft] = useState('')

  const listRef = useRef(null)
  const sinceRef = useRef(0)
  // 사용자가 위로 올려 지난 대화를 보는 중이면 새 메시지가 와도 끌어내리지 않는다.
  const stickToBottomRef = useRef(true)
  const isAdmin = account?.role === 'admin'

  // ── 폴링 ──
  const pull = useCallback(async () => {
    try {
      const data = await getChat(sinceRef.current)
      setNotice(data.notice)
      if (data.messages.length) {
        sinceRef.current = data.messages[data.messages.length - 1].id
        setMessages((prev) => [...prev, ...data.messages])
      }
      // 창이 열려 있는 동안 본 것으로 친다 — 배지가 남지 않게.
      onSeen?.(data.latest_id)
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [onSeen])

  useEffect(() => {
    pull()
    const t = setInterval(pull, POLL_MS)
    return () => clearInterval(t)
  }, [pull])

  // 새 메시지가 붙으면 맨 아래로. 단 사용자가 올려서 보는 중이면 그대로 둔다.
  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, notice])

  function handleScroll(e) {
    const el = e.currentTarget
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // ── 드래그 / 리사이즈 ──
  // pointer 이벤트라 마우스와 터치가 같은 코드로 동작한다(아이패드가 주 사용 기기다).
  // CSS resize는 터치에서 안 잡혀 쓸 수 없다.
  const dragRef = useRef(null)

  function beginDrag(e, mode) {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, box }
  }

  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    setBox(clampToScreen(d.mode === 'move'
      ? { ...d.box, x: d.box.x + dx, y: d.box.y + dy }
      : { ...d.box, w: d.box.w + dx, h: d.box.h + dy }))
  }

  function endDrag() {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      localStorage.setItem(BOX_KEY, JSON.stringify(box))
    } catch {
      // 저장 실패가 창을 못 쓰게 만들면 안 된다 — 이번 세션 동안만 유지된다.
    }
  }

  // ── 전송 ──
  async function submit() {
    const content = draft.trim()
    if (!content) return
    setDraft('')
    stickToBottomRef.current = true
    try {
      await sendChat(content)
      await pull()
    } catch (err) {
      setError(err.message)
      setDraft(content) // 실패하면 입력을 돌려준다 — 다시 타이핑하게 만들지 않는다
    }
  }

  // 엔터 전송, 쉬프트+엔터 줄바꿈. 한글 조합 중(isComposing)에는 보내지 않는다 —
  // 조합이 끝나기 전에 전송되면 마지막 글자가 잘려 나간다(쪽지에서 겪은 것과 같은 함정).
  function onKeyDown(e) {
    if (e.key !== 'Enter' || e.shiftKey) return
    if (e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  async function submitNotice() {
    try {
      const { notice: next } = await saveChatNotice(noticeDraft.trim())
      setNotice(next)
      setNoticeEditing(false)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section
      className="chat-panel"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="전체 채팅"
    >
      <header className="chat-panel__bar" onPointerDown={(e) => beginDrag(e, 'move')}>
        <span className="chat-panel__title">전체 채팅</span>
        <button type="button" className="chat-panel__close" onClick={onClose} aria-label="채팅 닫기">✕</button>
      </header>

      {/* 공지 — 관리자만 쓴다. 없으면 관리자에게만 '공지 등록' 줄이 보인다. */}
      {notice ? (
        <div className="chat-notice">
          <p className="chat-notice__text">{notice.text}</p>
          <span className="chat-notice__by">
            {notice.by}{notice.at ? ` · ${hhmm(notice.at)}` : ''}
          </span>
          {isAdmin && !noticeEditing && (
            <button
              type="button"
              className="chat-notice__edit"
              onClick={() => { setNoticeDraft(notice.text); setNoticeEditing(true) }}
            >
              수정
            </button>
          )}
        </div>
      ) : isAdmin && !noticeEditing ? (
        <button type="button" className="chat-notice__add" onClick={() => { setNoticeDraft(''); setNoticeEditing(true) }}>
          + 공지 등록
        </button>
      ) : null}

      {noticeEditing && (
        <div className="chat-notice chat-notice--edit">
          <input
            className="chat-notice__input"
            value={noticeDraft}
            onChange={(e) => setNoticeDraft(e.target.value)}
            placeholder="공지 내용 (비우고 저장하면 내려갑니다)"
            aria-label="공지 내용"
          />
          <div className="chat-notice__actions">
            <button type="button" className="chat-panel__btn" onClick={() => setNoticeEditing(false)}>취소</button>
            <button type="button" className="chat-panel__btn chat-panel__btn--send" onClick={submitNotice}>저장</button>
          </div>
        </div>
      )}

      <div className="chat-log" ref={listRef} onScroll={handleScroll}>
        {messages.length === 0 && <p className="chat-log__empty">아직 대화가 없습니다.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg${m.account_id === account?.id ? ' chat-msg--mine' : ''}`}>
            <span className="chat-msg__who">{m.author}</span>
            <span className="chat-msg__body">{m.content}</span>
            <span className="chat-msg__at">{hhmm(m.created_at)}</span>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="chat-panel__error">{error}</p>}

      <div className="chat-input">
        <textarea
          className="chat-input__box"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="엔터로 전송 · 쉬프트+엔터 줄바꿈"
          aria-label="메시지 입력"
        />
        <button type="button" className="chat-panel__btn chat-panel__btn--send" onClick={submit}>전송</button>
      </div>

      {/* 우하단 모서리를 끌어 크기 조절. 아이패드에서도 잡히도록 넉넉히 잡았다. */}
      <span
        className="chat-panel__resize"
        onPointerDown={(e) => beginDrag(e, 'resize')}
        role="separator"
        aria-label="채팅창 크기 조절"
      />
    </section>
  )
}
