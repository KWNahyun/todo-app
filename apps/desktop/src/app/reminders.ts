/**
 * 일정 알림 (v1: 'N분 전 알림'). 알릴 때가 된 일정을 고름 — 화면 · OS 와 무관한 순수 함수.
 * 알릴 때 ~ 시작 전 사이면 알림 (앱을 늦게 켰어도 시작 전이면 알려 줌). 시작한 뒤엔 안 알림.
 * 알린 기록은 이 창 메모리에만 (동기화 안 함).
 */
import type { Event } from "@dailytodo/core";
import { at } from "./dates.ts";

export function reminderKey(e: Event): string {
  return `${e.id}@${e.day} ${e.time}`; // 날짜 · 시각을 바꾸면 다시 알림
}

export function dueReminders(events: Event[], now: number, fired: Set<string>, defaultMin: number): Event[] {
  return events.filter((e) => {
    if (!e.time) return false;
    const min = e.remindMin ?? defaultMin;
    if (min <= 0) return false;
    const start = at(e.day, e.time);
    return now >= start - min * 60_000 && now < start && !fired.has(reminderKey(e));
  });
}
