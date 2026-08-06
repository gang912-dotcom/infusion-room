export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.status = 400
  }
}

export function assertInRange(value, min, max, label) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ValidationError(`${label}: 값이 유효하지 않습니다`)
  }
  if (value < min || value > max) {
    throw new ValidationError(`${label}: 허용 범위를 벗어났습니다`)
  }
}

// ─── 주사제 수량 ─────────────────────────────────────────────────────
// 0.01 단위까지 받는다(반 앰플 0.5, 그보다 잘게 나누는 분할이 실제로 있다).
// 0.01의 배수인지 검사하지 않고 반올림해서 받는다 — 부동소수 때문에 멀쩡한 값이
// 검사에서 걸리는 일을 피하려고. Math.round(n / 0.01) * 0.01은 0.3을
// 0.30000000000000004로 만들므로 100을 곱해 정수로 반올림한 뒤 나눈다.
// 상한을 두는 이유: 오타로 들어간 큰 수가 기록지에 그대로 인쇄된다.
// 처방 저장(orders.js)과 관리자 묶음 저장(adminOrders.js)이 반드시 같은 규칙이어야
// 한다 — 한쪽만 고치면 화면에서 넣은 0.25가 저장에서 0.3으로 뭉개진다.
// 화면 쪽 짝은 App.jsx의 normalizeQty다(번들이 달라 코드를 공유하지 못한다).
export const QTY_MAX = 99
export function roundQty(n) {
  return Math.round(n * 100) / 100
}

export function isUniqueConstraintError(err) {
  return err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

// 숫자만 허용, 앞자리 0 제거("001234" -> "1234", "0" -> "0")
export function normalizeChartNo(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  return trimmed.replace(/^0+(?=\d)/, '')
}
