/**
 * 위젯이 뒤에서 지키는 것 (v1 ui_timers.py) — 화면 · OS 와 무관한 순수 부분.
 * - 뽀모도로: 집중 → 휴식(4번마다 긴 휴식) → 휴식 끝, 상태는 위젯 메모리에만 (기록은 세션 kind=pomodoro)
 * - 오늘 정리하기에 보일 것
 */
import { taskElapsedMs, type Replica, type Session, type Task } from "@dailytodo/core";

export interface PomoConfig {
  focus: number; // 분
  brk: number;
  long: number;
  every: number;
}

export const POMO_DEFAULTS: PomoConfig = { focus: 25, brk: 5, long: 15, every: 4 };

export type Pomo =
  | { phase: "focus"; sessionId: string; taskId: string; ends: number; count: number }
  | { phase: "break"; taskId: string; ends: number; count: number; long: boolean }
  | { phase: "ready"; taskId: string; count: number };

export type PomoEvent =
  | { type: "focusDone"; sessionId: string; taskId: string; end: number; count: number; breakMin: number }
  | { type: "breakDone"; taskId: string };

/** 1초마다: 지금 상태 + 재는 중인 세션 → 다음 상태 (+ 알릴 일) */
export function pomoTick(p: Pomo | null, running: Session[], now: number, cfg: PomoConfig): { next: Pomo | null; event?: PomoEvent } {
  const focusOn = (s: Session, count: number): Pomo => ({ phase: "focus", sessionId: s.id, taskId: s.taskId, ends: s.start + cfg.focus * 60_000, count });
  if (!p || p.phase !== "focus") {
    // 타이머를 켜면 (위젯이든 메인 창이든) 집중 시작
    const s = running[0];
    if (s) return pomoTick(focusOn(s, p?.count ?? 0), running, now, cfg);
    if (p?.phase === "break" && now >= p.ends) return { next: { phase: "ready", taskId: p.taskId, count: p.count }, event: { type: "breakDone", taskId: p.taskId } };
    return { next: p };
  }
  const s = running.find((x) => x.id === p.sessionId);
  if (!s) return { next: running[0] ? focusOn(running[0], p.count) : null }; // 직접 멈췄거나 완료함 → 뽀모도로 끝
  if (now < p.ends) return { next: p };
  const count = p.count + 1;
  const long = count % cfg.every === 0;
  const breakMin = long ? cfg.long : cfg.brk;
  return {
    next: { phase: "break", taskId: p.taskId, ends: p.ends + breakMin * 60_000, count, long },
    event: { type: "focusDone", sessionId: p.sessionId, taskId: p.taskId, end: p.ends, count, breakMin },
  };
}

/** 1분 넘게 이벤트 고리가 멈춰 있었으면 절전이었던 것 → 그 시작 시각 */
export function sleepGap(lastTick: number, now: number): number | null {
  return now - lastTick > 120_000 ? lastTick : null;
}

// ---------- 오늘 정리하기 ----------

export interface ReviewData {
  done: number;
  total: number;
  ms: number;
  pomos: number;
  worked: { label: string; detail: string }[];
  undone: { id: string; label: string }[];
}

export function reviewData(rep: Replica, day: string, now: number): ReviewData {
  const tasks = rep.list("task", (t) => t.day === day);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kidsOf = (t: Task) => tasks.filter((c) => c.parentId === t.id);
  const parents = new Set(tasks.map((t) => t.parentId).filter(Boolean));
  const leaves = tasks.filter((t) => !parents.has(t.id));
  const tops = tasks.filter((t) => !t.parentId || !byId.has(t.parentId)).sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1));
  const ms = (t: Task) => taskElapsedMs(rep, t.id, now);
  const hm = (x: number) => {
    const m = Math.round(x / 60_000);
    return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`;
  };
  const worked: ReviewData["worked"] = [];
  for (const t of tops) {
    const kids = kidsOf(t);
    const total = ms(t) + kids.reduce((a, c) => a + ms(c), 0);
    if (kids.length && (total >= 60_000 || kids.some((c) => c.done))) {
      worked.push({ label: `▸ ${t.title}`, detail: `${kids.filter((c) => c.done).length}/${kids.length} · ${hm(total)}` });
    } else if (!kids.length && (t.done || total >= 60_000)) {
      worked.push({ label: `${t.done ? "✓" : "○"} ${t.title}`, detail: hm(total) });
    }
  }
  const ids = new Set(tasks.map((t) => t.id));
  return {
    done: leaves.filter((t) => t.done).length,
    total: leaves.length,
    ms: tasks.reduce((a, t) => a + ms(t), 0),
    pomos: tasks.reduce((a, t) => a + (t.pomos ?? 0), 0) + rep.list("session", (s) => s.kind === "pomodoro" && ids.has(s.taskId)).length,
    worked,
    undone: leaves
      .filter((t) => !t.done)
      .map((t) => ({ id: t.id, label: t.parentId && byId.has(t.parentId) ? `${byId.get(t.parentId)!.title} › ${t.title}` : t.title })),
  };
}
