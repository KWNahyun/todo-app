/** 기록장: 다이어리(글 · 타임라인 · 기분 · 그날 요약) + 데이트 일기 — 화면 없는 읽기 */
import { taskElapsedMs, type Journal, type Mood, type Moment, type RecordItem, type Replica } from "@dailytodo/core";
import { dayOf, hoursMinutes } from "./dates.ts";

/** v1 과 같은 다섯 단계 */
export const MOODS = [
  { level: 1, label: "힘듦" },
  { level: 2, label: "지침" },
  { level: 3, label: "보통" },
  { level: 4, label: "좋음" },
  { level: 5, label: "최고" },
] as const;

/** 오늘의 질문 (v1 records.py) — 날짜마다 하나 */
export const PROMPTS = [
  "오늘 가장 좋았던 순간은?", "오늘 새로 알게 된 것 하나는?", "내일의 나에게 한마디",
  "오늘 나를 힘들게 한 것은?", "고마웠던 사람이나 일은?", "오늘 집중이 잘 된 때는 언제였나?",
  "다시 한다면 다르게 할 것은?", "오늘 나를 웃게 한 것은?", "요즘 가장 많이 생각하는 것은?",
];

export function promptOf(day: string): string {
  const n = Math.round(new Date(`${day}T00:00:00Z`).getTime() / 86_400_000);
  return PROMPTS[((n % PROMPTS.length) + PROMPTS.length) % PROMPTS.length]!;
}

/** 그날 일기 (가져온 것과 새로 쓴 것이 겹치면 먼저 만든 것) */
export function journalOf(rep: Replica, day: string): Journal | undefined {
  return rep.list("journal", (j) => j.day === day).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
}

export function moodOf(rep: Replica, day: string): Mood | undefined {
  return rep.list("mood", (m) => m.day === day).sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))[0];
}

export function momentsOf(rep: Replica, day: string): Moment[] {
  return rep.list("moment", (m) => dayOf(new Date(m.at)) === day).sort((a, b) => a.at - b.at);
}

export interface DiaryRow {
  day: string;
  mood?: number;
  preview: string;
}

/** 목록: 그달에 무엇이든 남긴 날 (q 가 있으면 모든 달에서 글 · 기록 검색) — 최근 날짜가 위 */
export function diaryDays(rep: Replica, month: string, q = ""): DiaryRow[] {
  const query = q.trim().toLowerCase();
  const days = new Map<string, DiaryRow>();
  const row = (day: string) => {
    let r = days.get(day);
    if (!r) days.set(day, (r = { day, preview: "" }));
    return r;
  };
  const inScope = (day: string) => (query ? true : day.startsWith(month));
  const hit = (text: string) => !query || text.toLowerCase().includes(query);
  for (const j of rep.list("journal")) {
    if (inScope(j.day) && j.text.trim() && hit(j.text)) row(j.day).preview ||= j.text.trim().split("\n")[0]!;
  }
  for (const m of rep.list("moment")) {
    const day = dayOf(new Date(m.at));
    if (inScope(day) && hit(m.text)) {
      const r = row(day);
      if (!r.preview) r.preview = m.text;
    }
  }
  if (!query) {
    for (const m of rep.list("mood", (x) => x.day.startsWith(month))) row(m.day);
  }
  for (const r of days.values()) r.mood = moodOf(rep, r.day)?.level;
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** 그날 한 줄 요약 (v1 day_summary) */
export function daySummary(rep: Replica, day: string, now: number): string {
  const tasks = rep.list("task", (t) => t.day === day);
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  const leaves = tasks.filter((t) => !parents.has(t.id));
  const parts: string[] = [];
  if (leaves.length) parts.push(`할 일 ${leaves.filter((t) => t.done).length}/${leaves.length} 완료`);
  const total = tasks.reduce((a, t) => a + taskElapsedMs(rep, t.id, now), 0);
  if (total >= 60_000) parts.push(`${hoursMinutes(total)} 기록`);
  const habits = new Map(rep.list("habit").map((h) => [h.id, h.name]));
  const names = rep.list("habitCheck", (c) => c.day === day).map((c) => habits.get(c.habitId)).filter(Boolean);
  if (names.length) parts.push(`습관 ${names.join(", ")}`);
  const events = rep.list("event", (e) => e.day === day).length;
  if (events) parts.push(`일정 ${events}개`);
  return parts.join(" · ") || "이 날의 할 일 기록은 없어요";
}

// ---------- 데이트 일기 ----------

export const DATE = "date";

export function dateRecords(rep: Replica, q = ""): RecordItem[] {
  const query = q.trim().toLowerCase();
  return rep
    .list("record", (r) => r.collection === DATE)
    .filter((r) => !query || [r.title, r.note ?? "", String(r.f?.where ?? ""), ...(r.tags ?? [])].join(" ").toLowerCase().includes(query))
    .sort((a, b) => ((a.day ?? a.createdDay ?? "") < (b.day ?? b.createdDay ?? "") ? 1 : -1) || (a.createdAt < b.createdAt ? 1 : -1));
}

/** '#기념일 #맛집' → ['기념일', '맛집'] (v1 split_tags) */
export function parseTags(text: string): string[] {
  return [...new Set([...text.matchAll(/#?([^\s#,]+)/g)].map((m) => m[1]!))];
}
