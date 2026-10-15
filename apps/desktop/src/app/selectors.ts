/** 화면에 보일 모양으로 복제본 읽기 */
import {
  isRunning, runningSessions, sessionsOf, sortByOrder, taskElapsedMs,
  type Deadline, type Event, type Moment, type Replica, type Task,
} from "@dailytodo/core";
import { at, dayOf, daysBetween, hhmm, hoursMinutes } from "./dates.ts";

export interface TaskNode {
  task: Task;
  children: Task[];
}

/** 그날 할 일: 묶음(상위) 아래 하위. 상위가 없거나 지워진 하위는 맨 위로 */
export function dayTree(rep: Replica, day: string): TaskNode[] {
  const tasks = rep.list("task", (t) => t.day === day);
  const ids = new Set(tasks.map((t) => t.id));
  const top = sortByOrder(tasks.filter((t) => !t.parentId || !ids.has(t.parentId)));
  return top.map((task) => ({ task, children: sortByOrder(tasks.filter((c) => c.parentId === task.id)) }));
}

/** 같은 묶음 안의 형제 (순서대로) */
export function siblings(rep: Replica, task: Task): Task[] {
  const tasks = rep.list("task", (t) => t.day === task.day);
  const ids = new Set(tasks.map((t) => t.id));
  const parentOf = (t: Task) => (t.parentId && ids.has(t.parentId) ? t.parentId : null);
  const p = parentOf(task);
  return sortByOrder(tasks.filter((t) => parentOf(t) === p));
}

/** 완료 수 / 전체 (하위가 있는 묶음은 하위만 셈) */
export function progress(tree: TaskNode[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const n of tree) {
    const xs = n.children.length ? n.children : [n.task];
    total += xs.length;
    done += xs.filter((t) => t.done).length;
  }
  return { done, total };
}

export function dayTotal(rep: Replica, tree: TaskNode[], now: number): number {
  return tree.reduce((a, n) => a + taskElapsedMs(rep, n.task.id, now, { children: true }), 0);
}

export function eventsOf(rep: Replica, day: string): Event[] {
  // 시간 미정은 맨 위, 그다음 시간 순
  return rep.list("event", (e) => e.day === day).sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}

/** 다음 일정 (지금 이후 첫 일정) */
export function nextEvent(events: Event[], day: string, now: number): Event | undefined {
  if (day !== dayOf(new Date(now))) return undefined;
  return events.find((e) => e.time && at(day, e.time) > now);
}

export interface DeadlineView extends Deadline {
  dday: number;
}

/** 다가오는 마감 (오늘 포함, 가까운 순) */
export function upcomingDeadlines(rep: Replica, today: string, limit = 5): DeadlineView[] {
  return rep
    .list("deadline", (d) => d.date >= today)
    .map((d) => ({ ...d, dday: daysBetween(today, d.date) }))
    .sort((a, b) => a.dday - b.dday || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export interface TimelineItem {
  id: string;
  at: number;
  text: string;
  /** 자동으로 끼어든 항목 (흐리게) */
  auto: boolean;
  kind: "moment" | "done" | "event";
}

/** 그날 타임라인: 직접 쓴 기록 + 완료한 할 일 + 시간 있는 일정 (설계 4.3) */
export function timeline(rep: Replica, day: string, now: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const m of rep.list("moment") as Moment[]) {
    if (dayOf(new Date(m.at)) === day) items.push({ id: m.id, at: m.at, text: m.text, auto: false, kind: "moment" });
  }
  for (const t of rep.list("task", (t) => t.day === day && !!t.done && typeof t.doneAt === "number")) {
    const ms = taskElapsedMs(rep, t.id, now);
    items.push({
      id: t.id, at: t.doneAt as number, auto: true, kind: "done",
      text: `✓ ${t.title} 완료${ms >= 60_000 ? ` · ${hoursMinutes(ms)}` : ""}`,
    });
  }
  for (const e of eventsOf(rep, day)) {
    if (e.time) items.push({ id: e.id, at: at(day, e.time), text: e.title, auto: true, kind: "event" });
  }
  // 같은 시각이면 자동 항목(완료 등)이 먼저 — "완료하고 나서 남긴 기록" 순서
  return items.sort((a, b) => a.at - b.at || Number(b.auto) - Number(a.auto));
}

export { hhmm, isRunning, runningSessions, sessionsOf };
