// 以「UTC 日序號」處理日期，避免時區與夏令時間造成的一天誤差
const DAY = 86_400_000

export function toDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}

export function fromDay(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10)
}

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(s: string, n: number): string {
  return fromDay(toDay(s) + n)
}

export function parts(n: number) {
  const d = new Date(n * DAY)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() }
}

export function monthStart(n: number): number {
  const p = parts(n)
  return Math.round(Date.UTC(p.y, p.m - 1, 1) / DAY)
}

export function nextMonth(n: number): number {
  const p = parts(n)
  return Math.round(Date.UTC(p.y, p.m, 1) / DAY)
}

/** 工期（含頭尾） */
export function duration(start: string, end: string): number {
  return toDay(end) - toDay(start) + 1
}

export function fmtMD(s: string): string {
  const [, m, d] = s.split('-')
  return `${Number(m)}/${Number(d)}`
}

export function fmtYMD(s: string): string {
  return s.replace(/-/g, '/')
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
