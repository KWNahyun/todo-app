/** 일정표 · 달력: 날짜 범위와 그날 항목 (주는 일요일부터 — v1 과 같음) */
import type { Deadline, Event, Replica } from "@dailytodo/core";
import { addDays, dayOf, toDate } from "./dates.ts";
import { eventsOf } from "./selectors.ts";

export type RangeMode = "week" | "2weeks" | "month";

export function weekStart(day: string): string {
  return addDays(day, -toDate(day).getDay());
}

/** 그달을 덮는 주들 (일요일 시작, 4~6주) */
export function monthGrid(day: string): string[] {
  const d = toDate(day);
  const first = dayOf(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = dayOf(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const out: string[] = [];
  for (let x = weekStart(first); x <= last || out.length % 7; x = addDays(x, 1)) out.push(x);
  return out;
}

export function rangeDays(mode: RangeMode, anchor: string): string[] {
  if (mode === "month") return monthGrid(anchor);
  const start = weekStart(anchor);
  return Array.from({ length: mode === "week" ? 7 : 14 }, (_, i) => addDays(start, i));
}

export function shiftAnchor(mode: RangeMode, anchor: string, n: number): string {
  if (mode === "month") {
    const d = toDate(anchor);
    return dayOf(new Date(d.getFullYear(), d.getMonth() + n, 1));
  }
  return addDays(anchor, n * (mode === "week" ? 7 : 14));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export interface DayItems {
  events: Event[];
  deadlines: Deadline[];
}

/** 날짜 → 그날 일정 · 마감 (범위 안만, 한 번에 모아서) */
export function itemsByDay(rep: Replica, days: string[]): Map<string, DayItems> {
  const set = new Set(days);
  const out = new Map<string, DayItems>(days.map((d) => [d, { events: eventsOf(rep, d), deadlines: [] }]));
  for (const dl of rep.list("deadline", (x) => set.has(x.date))) out.get(dl.date)!.deadlines.push(dl);
  for (const v of out.values()) v.deadlines.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}
