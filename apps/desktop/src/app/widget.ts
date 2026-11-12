/**
 * 휴대폰 홈 화면 달력 위젯에 넘길 내용 (MainActivity → filesDir/widget.json → MonthWidget.kt).
 * 위젯은 보관함을 직접 못 읽으니, 앱이 켜져 있을 때 지난달 ~ 6달 뒤의 날짜별 줄을 미리 만들어 둠.
 * 줄: 마감은 '◆ 이름', 일정은 시각 순 '13:30 이름' (시각 없으면 이름만)
 */
import type { Replica } from "@dailytodo/core";
import { addDays, dayOf, toDate } from "./dates.ts";

export interface WidgetData {
  v: 1;
  /** 만든 시각 (ms) */
  at: number;
  days: Record<string, string[]>;
}

export function widgetData(rep: Replica, today: string, now = Date.now()): WidgetData {
  const t = toDate(today);
  const from = dayOf(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const to = dayOf(new Date(t.getFullYear(), t.getMonth() + 7, 0));
  const days: Record<string, string[]> = {};
  const push = (d: string, s: string) => (days[d] ??= []).push(s);
  for (const x of rep.list("deadline", (x) => x.date >= from && x.date <= to).sort((a, b) => a.title.localeCompare(b.title))) push(x.date, `◆ ${x.title}`);
  const events = rep.list("event", (e) => e.day <= to && (e.endDay ?? e.day) >= from)
    .sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
  for (const e of events) {
    push(e.day, e.time ? `${e.time} ${e.title}` : e.title);
    // 여러 날 일정: 이어지는 날엔 '› 이름'
    for (let d = addDays(e.day, 1); e.endDay && d <= e.endDay && d <= to; d = addDays(d, 1)) if (d >= from) push(d, `› ${e.title}`);
  }
  return { v: 1, at: now, days };
}
