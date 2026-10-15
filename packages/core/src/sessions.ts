/**
 * 타이머 = 측정 구간(세션)들의 모음 (설계 5.3).
 * 잰 시간 = 그 할 일 세션들의 (끝 ?? 지금) - 시작 합계. 세션은 기기마다 따로 생기므로 합쳐도 충돌 없음.
 */
import type { Replica } from "./replica.ts";
import type { Day, Session, SessionKind } from "./schema.ts";

export function sessionMs(s: Session, now: number): number {
  return Math.max(0, (s.end ?? now) - s.start);
}

export function sessionsOf(rep: Replica, taskId: string): Session[] {
  return rep.list("session", (s) => s.taskId === taskId).sort((a, b) => a.start - b.start);
}

/** 할 일 하나의 잰 시간. children 이면 하위 할 일까지 (묶음 합계) */
export function taskElapsedMs(rep: Replica, taskId: string, now: number, opts: { children?: boolean } = {}): number {
  let ms = sessionsOf(rep, taskId).reduce((a, s) => a + sessionMs(s, now), 0);
  if (opts.children) {
    for (const c of rep.list("task", (t) => t.parentId === taskId)) ms += taskElapsedMs(rep, c.id, now);
  }
  return ms;
}

export function runningSessions(rep: Replica): Session[] {
  return rep.list("session", (s) => s.end == null);
}

export function isRunning(rep: Replica, taskId: string): boolean {
  return runningSessions(rep).some((s) => s.taskId === taskId);
}

/**
 * 타이머 켜기. single(기본) 이면 다른 할 일의 재는 중 세션은 닫음 (v1 의 "하나만 켜기").
 * 이미 이 기기에서 이 할 일을 재는 중이면 그 세션을 그대로 돌려줌.
 * deviceId: 세션에 적을 기기 (기본은 복제본 ID). PC 의 위젯 · 메인 창처럼 창마다 복제본이 따로여도
 * 같은 PC 로 치려면 PC ID 를 넘김.
 */
export function startTimer(
  rep: Replica,
  taskId: string,
  now: number,
  opts: { single?: boolean; kind?: SessionKind; deviceId?: string } = {},
): string {
  const device = opts.deviceId ?? rep.deviceId;
  const running = runningSessions(rep);
  const mine = running.find((s) => s.taskId === taskId && s.deviceId === device);
  if (opts.single ?? true) {
    for (const s of running) if (s.taskId !== taskId) stopSession(rep, s.id, now);
  }
  if (mine) return mine.id;
  return rep.create("session", { taskId, start: now, end: null, deviceId: device, kind: opts.kind ?? "normal" });
}

export function stopSession(rep: Replica, sessionId: string, now: number): void {
  const s = rep.get<"session">(sessionId);
  if (s && s.end == null) rep.update<"session">(sessionId, { end: Math.max(now, s.start) });
}

/** 할 일의 재는 중 세션을 모두 닫음 (완료 체크하면 타이머 정지 등) */
export function stopTask(rep: Replica, taskId: string, now: number): void {
  for (const s of runningSessions(rep)) if (s.taskId === taskId) stopSession(rep, s.id, now);
}

/** 두 기기 이상에서 같은 할 일을 재는 중인 경우 → 화면이 "두 기기에서 재는 중" 안내 */
export function runningOnManyDevices(rep: Replica): { taskId: string; devices: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const s of runningSessions(rep)) {
    let d = by.get(s.taskId);
    if (!d) by.set(s.taskId, (d = new Set()));
    d.add(s.deviceId);
  }
  return [...by].filter(([, d]) => d.size > 1).map(([taskId, d]) => ({ taskId, devices: [...d].sort() }));
}

/** 날짜별 잰 시간 (할 일의 day 기준 — v1 통계와 같은 기준) */
export function dayTotalsMs(rep: Replica, now: number): Record<Day, number> {
  const dayOf = new Map(rep.list("task").map((t) => [t.id, t.day]));
  const out: Record<Day, number> = {};
  for (const s of rep.list("session")) {
    const day = dayOf.get(s.taskId);
    if (day) out[day] = (out[day] ?? 0) + sessionMs(s, now);
  }
  return out;
}
