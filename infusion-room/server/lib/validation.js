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

export function isUniqueConstraintError(err) {
  return err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
}

// 숫자만 허용, 앞자리 0 제거("001234" -> "1234", "0" -> "0")
export function normalizeChartNo(raw) {
  const trimmed = String(raw ?? '').trim()
  if (!/^\d+$/.test(trimmed)) return null
  return trimmed.replace(/^0+(?=\d)/, '')
}
