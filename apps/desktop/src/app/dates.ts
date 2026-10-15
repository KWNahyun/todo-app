/** 날짜는 "YYYY-MM-DD" (이 PC 현지 날짜), 시각은 epoch ms. */

const pad = (n: number) => String(n).padStart(2, "0");

export function dayOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = toDate(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

/** b - a (일) */
export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** "10월 15일 목요일" */
export function longDay(day: string): string {
  const d = toDate(day);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
}

/** "10.15 목" */
export function shortDay(day: string): string {
  const d = toDate(day);
  return `${d.getMonth() + 1}.${d.getDate()} ${WEEK[d.getDay()]}`;
}

export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "1:25:00" */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** "1시간 25분" · "40분" */
export function hoursMinutes(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h && r ? `${h}시간 ${r}분` : h ? `${h}시간` : `${r}분`;
}

export function ddayText(n: number): string {
  return n === 0 ? "D-DAY" : n > 0 ? `D-${n}` : `D+${-n}`;
}

/** "2시간 후" · "25분 후" (일정까지 남은 시간) */
export function until(ms: number): string {
  const mins = Math.floor(ms / 60_000) + 1;
  if (mins < 60) return `${mins}분 후`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}시간 ${m}분 후` : `${h}시간 후`;
}

/** 그날 HH:MM 의 epoch ms */
export function at(day: string, time: string): number {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const d = toDate(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
