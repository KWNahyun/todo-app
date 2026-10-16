/**
 * 통계 (v1 stats.py + 기간 선택): 주(끝 날 포함 7일) · 달(그달) · 연(끝 달 포함 12달), 시간 / 완료 기준.
 * 하위 할 일은 상위 묶음 이름으로 합침 (v1 과 같음).
 */
import { taskElapsedMs, type Goal, type Replica, type Task } from "@dailytodo/core";
import { addDays, dayOf, toDate } from "./dates.ts";

export type Period = "week" | "month" | "year";
export type Basis = "time" | "done";

export interface Bucket {
  key: string; // 날짜 "YYYY-MM-DD" 또는 달 "YYYY-MM"
  label: string;
  sub: string;
  value: number; // 시간이면 ms, 완료면 개수
  mood?: number;
}

export interface Stats {
  days: string[];
  buckets: Bucket[];
  tiles: { label: string; value: string }[];
  top: { name: string; value: number }[];
  habits: { id: string; name: string; cells: boolean[]; count: number }[];
  goals: { id: string; title: string; period: number; total: number; targetMs: number | null }[];
  estimate: { within: number; count: number } | null;
}

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function periodDays(period: Period, end: string): string[] {
  if (period === "week") return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  const e = toDate(end);
  const start = period === "month" ? new Date(e.getFullYear(), e.getMonth(), 1) : new Date(e.getFullYear(), e.getMonth() - 11, 1);
  const last = new Date(e.getFullYear(), e.getMonth() + 1, 0);
  const out: string[] = [];
  for (let d = dayOf(start); d <= dayOf(last); d = addDays(d, 1)) out.push(d);
  return out;
}

export function shiftEnd(period: Period, end: string, n: number): string {
  if (period === "week") return addDays(end, 7 * n);
  const e = toDate(end);
  const k = period === "month" ? 1 : 12;
  return dayOf(new Date(e.getFullYear(), e.getMonth() + n * k + 1, 0)); // 그달 말일
}

export function periodLabel(period: Period, end: string): string {
  const days = periodDays(period, end);
  const a = toDate(days[0]!);
  const b = toDate(days[days.length - 1]!);
  if (period === "week") return `${a.getMonth() + 1}.${a.getDate()} – ${b.getMonth() + 1}.${b.getDate()}`;
  if (period === "month") return `${b.getFullYear()}년 ${b.getMonth() + 1}월`;
  return `${a.getFullYear()}.${a.getMonth() + 1} – ${b.getFullYear()}.${b.getMonth() + 1}`;
}

/** 하위가 있는 상위 할 일은 개수에서 뺌 */
function leaves(tasks: Task[]): Task[] {
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  return tasks.filter((t) => !parents.has(t.id));
}

export function hm(ms: number): string {
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60);
  return h && m % 60 ? `${h}시간 ${m % 60}분` : h ? `${h}시간` : `${m}분`;
}

export function hoursText(ms: number): string {
  const h = ms / 3_600_000;
  return h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")}시간` : `${Math.floor(h)}시간`;
}

/** 목표에 연결된 시간 (목표 이름 · 연결한 이름과 같은 할 일, 또는 그 이름 묶음의 하위) — v1 goal_seconds */
export function goalMs(rep: Replica, g: Goal, days: Set<string> | null, now: number): number {
  const names = new Set([g.title, ...(g.linkedTitles ?? [])]);
  const tasks = rep.list("task", (t) => !days || days.has(t.day));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let ms = 0;
  for (const t of tasks) {
    const owner = (t.parentId && byId.get(t.parentId)) || t;
    if (names.has(owner.title)) ms += taskElapsedMs(rep, t.id, now);
  }
  return ms;
}

export function computeStats(rep: Replica, period: Period, end: string, basis: Basis, now: number): Stats {
  const days = periodDays(period, end);
  const daySet = new Set(days);
  const tasks = rep.list("task", (t) => daySet.has(t.day));
  const byDay = new Map<string, Task[]>(days.map((d) => [d, []]));
  for (const t of tasks) byDay.get(t.day)!.push(t);
  const ms = new Map(tasks.map((t) => [t.id, taskElapsedMs(rep, t.id, now)]));
  const moods = new Map(rep.list("mood", (m) => daySet.has(m.day)).map((m) => [m.day, m.level]));

  const dayValue = (d: string) => {
    const ts = byDay.get(d)!;
    return basis === "time" ? ts.reduce((a, t) => a + ms.get(t.id)!, 0) : leaves(ts).filter((t) => t.done).length;
  };

  let buckets: Bucket[];
  if (period === "year") {
    const months = new Map<string, number>();
    for (const d of days) months.set(d.slice(0, 7), (months.get(d.slice(0, 7)) ?? 0) + dayValue(d));
    buckets = [...months].map(([k, v]) => ({ key: k, label: `${Number(k.slice(5))}월`, sub: k.slice(2, 4) === end.slice(2, 4) ? "" : `'${k.slice(2, 4)}`, value: v }));
  } else {
    buckets = days.map((d) => {
      const dt = toDate(d);
      return {
        key: d,
        label: period === "week" ? WEEK[dt.getDay()]! : String(dt.getDate()),
        sub: period === "week" ? `${dt.getMonth() + 1}/${dt.getDate()}` : "",
        value: dayValue(d),
        mood: moods.get(d),
      };
    });
  }

  const all = leaves(tasks);
  const done = all.filter((t) => t.done).length;
  const values = days.map(dayValue);
  const active = values.filter((v) => v > 0).length;
  const ids = new Set(tasks.map((t) => t.id));
  const pomos = tasks.reduce((a, t) => a + (t.pomos ?? 0), 0) + rep.list("session", (s) => s.kind === "pomodoro" && ids.has(s.taskId)).length;
  const tiles =
    basis === "time"
      ? [
          { label: "총 시간", value: hm(values.reduce((a, b) => a + b, 0)) },
          { label: "기록한 날 평균", value: active ? hm(values.reduce((a, b) => a + b, 0) / active) : "–" },
          { label: "완료", value: `${done} / ${all.length}` },
        ]
      : (() => {
          const withTasks = days.filter((d) => byDay.get(d)!.length).length;
          return [
            { label: "완료한 일", value: `${done}개` },
            { label: "하루 평균", value: withTasks ? `${(done / withTasks).toFixed(1).replace(/\.0$/, "")}개` : "–" },
            { label: "완료율", value: all.length ? `${Math.floor((done * 100) / all.length)}%` : "–" },
          ];
        })();
  if (pomos) tiles.push({ label: "뽀모도로", value: `${pomos}회` });

  // 가장 오래 한 일 / 가장 많이 끝낸 일 (하위는 상위 묶음 이름으로)
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const agg = new Map<string, number>();
  for (const t of basis === "time" ? tasks : all.filter((x) => x.done)) {
    const name = ((t.parentId && byId.get(t.parentId)) || t).title;
    agg.set(name, (agg.get(name) ?? 0) + (basis === "time" ? ms.get(t.id)! : 1));
  }
  const top = [...agg]
    .filter(([, v]) => v >= (basis === "time" ? 60_000 : 1))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));

  const checks = rep.list("habitCheck", (c) => daySet.has(c.day));
  const habits = rep
    .list("habit")
    .sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1))
    .map((h) => {
      const on = new Set(checks.filter((c) => c.habitId === h.id).map((c) => c.day));
      return { id: h.id, name: h.name, cells: days.map((d) => on.has(d)), count: on.size };
    });

  const upTo = new Set(rep.list("task", (t) => t.day <= days[days.length - 1]!).map((t) => t.day));
  const goals = rep.list("goal").map((g) => ({
    id: g.id,
    title: g.title,
    period: goalMs(rep, g, daySet, now),
    total: goalMs(rep, g, upTo, now),
    targetMs: g.targetHours ? g.targetHours * 3_600_000 : null,
  }));

  const est = tasks.filter((t) => t.done && t.estimateMin);
  const estimate = est.length
    ? {
        count: est.length,
        within: est.filter((t) => {
          const kids = tasks.filter((c) => c.parentId === t.id).reduce((a, c) => a + ms.get(c.id)!, 0);
          return ms.get(t.id)! + kids <= t.estimateMin! * 60_000;
        }).length,
      }
    : null;

  return { days, buckets, tiles, top, habits, goals, estimate };
}
