/**
 * 입력 한 줄 해석 (v1 dailytodo/core.py 의 parse_event · parse_date_prefix · parse_deadline 를 옮김 + 새 문법).
 *
 *   모델링                 할 일
 *   KAMP > 모델링          하위 할 일 (KAMP 묶음이 없으면 만듦)
 *   13:30 회의 · 오후 3시 반 회의 · 미정 MT · 10/5 13:30 회의    일정
 *   마감 10/20 KAMP 제출   마감
 *   - 점심 맛있었다         타임라인 기록 (새로)
 */
import { addDays, toDate, dayOf } from "./dates.ts";

export type Parsed =
  | { kind: "task"; title: string; parentTitle?: string }
  | { kind: "event"; day: string; time: string | null; title: string }
  | { kind: "deadline"; date: string; title: string }
  | { kind: "moment"; text: string }
  | { kind: "error"; message: string };

export type Kind = Parsed["kind"];

export const KIND_LABEL: Record<Exclude<Kind, "error">, string> = {
  task: "할 일",
  event: "일정",
  deadline: "마감",
  moment: "기록",
};

const UNTIMED_RE = /^(?:미정|종일|하루\s*종일)\s+(\S.*)$/;
const EVENT_RE = /^(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분|(반))?)\s+(\S.*)$/;
const DATE_PREFIX_RE = /^(?:(\d{1,2})[/.](\d{1,2})|(\d{1,2})월\s*(\d{1,2})일)\s+(.+)$/;
const DEADLINE_RE = /^마감\s+(.+)$/;
const MOMENT_RE = /^[-–]\s+(.+)$/;

/** '13:30 회의' → { time: "13:30", title }, '미정 회의' → time null. 일정 형식이 아니면 null */
export function parseEvent(text: string): { time: string | null; title: string } | null {
  const t = text.trim();
  const m0 = UNTIMED_RE.exec(t);
  if (m0) return { time: null, title: m0[1]!.trim() };
  const m = EVENT_RE.exec(t);
  if (!m) return null;
  const [, ampm, hs, mColon, mBun, half, title] = m;
  let h = Number(hs);
  const min = Number(mColon ?? mBun ?? (half ? 30 : 0));
  if (ampm === "오후" && h < 12) h += 12;
  else if (ampm === "오전" && h === 12) h = 0;
  else if (!ampm && !mColon && h >= 1 && h <= 6) h += 12; // '3시 회의' 는 보통 오후
  if (h > 23 || min > 59) return null;
  return { time: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, title: title!.trim() };
}

/** 앞의 '10/5' · '10월 5일' → 날짜. 두 달 넘게 지난 날짜면 내년. */
export function parseDatePrefix(text: string, today: string): { day: string | null; rest: string; error?: string } {
  const m = DATE_PREFIX_RE.exec(text.trim());
  if (!m) return { day: null, rest: text.trim() };
  const month = Number(m[1] ?? m[3]);
  const dd = Number(m[2] ?? m[4]);
  const year = toDate(today).getFullYear();
  const make = (y: number) => {
    const d = new Date(y, month - 1, dd);
    return d.getMonth() === month - 1 && d.getDate() === dd ? dayOf(d) : null;
  };
  let day = make(year);
  if (!day) return { day: null, rest: m[5]!.trim(), error: `${month}월 ${dd}일은 없는 날짜예요.` };
  if (day < addDays(today, -60)) day = make(year + 1) ?? day;
  return { day, rest: m[5]!.trim() };
}

export function parseInput(text: string, viewDay: string, today: string): Parsed {
  const t = text.trim();
  if (!t) return { kind: "error", message: "내용을 적어 주세요." };

  const mm = MOMENT_RE.exec(t);
  if (mm) return { kind: "moment", text: mm[1]!.trim() };

  const md = DEADLINE_RE.exec(t);
  if (md) {
    const { day, rest, error } = parseDatePrefix(md[1]!, today);
    if (error) return { kind: "error", message: error };
    if (!day) return { kind: "error", message: "'마감 10/20 KAMP 제출' 처럼 날짜를 함께 적어 주세요." };
    if (!rest) return { kind: "error", message: "마감 이름을 적어 주세요." };
    return { kind: "deadline", date: day, title: rest };
  }

  // '10/5 13:30 회의' — 날짜 + 시간이 있을 때만 일정 ('3.5 리포트' 같은 할 일과 헷갈리지 않게)
  const dp = parseDatePrefix(t, today);
  if (dp.day) {
    const ev = parseEvent(dp.rest);
    if (ev) return { kind: "event", day: dp.day, ...ev };
  }
  const ev = parseEvent(t);
  if (ev) return { kind: "event", day: viewDay, ...ev };

  const gt = t.indexOf(">");
  if (gt > 0) {
    const parentTitle = t.slice(0, gt).trim();
    const title = t.slice(gt + 1).trim();
    if (parentTitle && title) return { kind: "task", title, parentTitle };
  }
  return { kind: "task", title: t };
}

/**
 * 일정표의 입력 (v1 parse_dated_event · parse_deadline 와 같음): 고른 날이 기본.
 *   일정: '13:30 회의' · '10/5 13:30 회의' · 'KAMP 회의'(시간 미정) · '10/7 MT'(그날 시간 미정)
 *   마감: 'KAMP 제출' · '10/20 KAMP 제출' · '마감 10/20 KAMP 제출'
 */
export function parseScheduleInput(
  text: string,
  kind: "event" | "deadline",
  selectedDay: string,
  today: string,
): Extract<Parsed, { kind: "event" | "deadline" | "error" }> {
  let t = text.trim();
  if (kind === "deadline") t = t.replace(DEADLINE_RE, "$1");
  if (!t) return { kind: "error", message: kind === "event" ? "일정 내용을 적어 주세요." : "마감 이름을 적어 주세요." };
  const { day, rest, error } = parseDatePrefix(t, today);
  if (error) return { kind: "error", message: error };
  const d = day ?? selectedDay;
  if (kind === "deadline") return rest ? { kind: "deadline", date: d, title: rest } : { kind: "error", message: "마감 이름을 적어 주세요." };
  const ev = parseEvent(rest) ?? { time: null, title: rest };
  return { kind: "event", day: d, ...ev };
}

/** 입력창 왼쪽 표시: 지금 무엇으로 들어갈지 */
export function previewKind(text: string, viewDay: string, today: string): { label: string; sub?: boolean } {
  if (!text.trim()) return { label: KIND_LABEL.task };
  // '마감 ' 까지만 쳐도 마감으로 보임 (날짜를 아직 안 적었어도)
  if (/^마감(\s|$)/.test(text.trimStart())) return { label: KIND_LABEL.deadline };
  const p = parseInput(text, viewDay, today);
  if (p.kind === "error") return { label: KIND_LABEL.task };
  if (p.kind === "task" && p.parentTitle) return { label: "하위 할 일", sub: true };
  return { label: KIND_LABEL[p.kind] };
}
