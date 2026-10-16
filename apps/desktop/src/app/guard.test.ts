import { describe, expect, it } from "vitest";
import { MemoryFs, Replica, isRunning, taskElapsedMs, type Session } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { POMO_DEFAULTS, pomoTick, reviewData, sleepGap, type Pomo } from "./guard.ts";
import { dayTree } from "./selectors.ts";

const MIN = 60_000;
const ses = (id: string, start: number): Session => ({ id, type: "session", taskId: "t1", start, end: null, deviceId: "pc", kind: "normal", createdAt: "", updatedAt: "" });

async function setup(start = new Date(2026, 9, 15, 23, 50).getTime()) {
  let t = start;
  const clock = { now: () => t, set: (x: number) => (t = x), tick: (ms: number) => (t += ms) };
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-widget", wall: clock.now });
  return { rep, a: new Actions(rep, "pc-1", clock.now), clock };
}

describe("뽀모도로", () => {
  it("집중 25분 → 휴식 5분 → 휴식 끝, 4번째는 긴 휴식", () => {
    const cfg = POMO_DEFAULTS;
    let r = pomoTick(null, [ses("s1", 0)], 0, cfg);
    expect(r.next).toMatchObject({ phase: "focus", ends: 25 * MIN, count: 0 });
    r = pomoTick(r.next, [ses("s1", 0)], 25 * MIN, cfg);
    expect(r.event).toMatchObject({ type: "focusDone", sessionId: "s1", end: 25 * MIN, count: 1, breakMin: 5 });
    expect(r.next).toMatchObject({ phase: "break", ends: 30 * MIN });
    r = pomoTick(r.next, [], 29 * MIN, cfg);
    expect(r.next!.phase).toBe("break");
    r = pomoTick(r.next, [], 30 * MIN, cfg);
    expect(r).toMatchObject({ next: { phase: "ready", count: 1 }, event: { type: "breakDone" } });
    const p3: Pomo = { phase: "focus", sessionId: "s4", taskId: "t1", ends: 100 * MIN, count: 3 };
    expect(pomoTick(p3, [ses("s4", 75 * MIN)], 100 * MIN, cfg).event).toMatchObject({ count: 4, breakMin: 15 });
  });

  it("직접 멈추면 뽀모도로 끝, 쉬는 중에 타이머를 켜면 바로 집중", () => {
    const p: Pomo = { phase: "focus", sessionId: "s1", taskId: "t1", ends: 25 * MIN, count: 0 };
    expect(pomoTick(p, [], 10 * MIN, POMO_DEFAULTS).next).toBeNull();
    const b: Pomo = { phase: "break", taskId: "t1", ends: 30 * MIN, count: 1, long: false };
    expect(pomoTick(b, [ses("s2", 27 * MIN)], 27 * MIN, POMO_DEFAULTS).next).toMatchObject({ phase: "focus", sessionId: "s2", count: 1 });
  });

  it("집중이 끝나면 그 시각에 멈추고 뽀모도로로 기록", async () => {
    const { rep, a } = await setup();
    const r = a.add("모델링", "2026-10-15");
    if (!r.ok) throw new Error();
    a.toggleTimer(r.id);
    const s = rep.list("session")[0]!;
    a.finishPomodoro(s.id, s.start + 25 * MIN);
    expect(rep.get<"session">(s.id)).toMatchObject({ end: s.start + 25 * MIN, kind: "pomodoro" });
    expect(reviewData(rep, "2026-10-15", s.start + 60 * MIN).pomos).toBe(1);
  });
});

describe("자정 · 자리 비움 · 정리하기", () => {
  it("자정을 넘기면 어제 할 일은 자정에 끊고 오늘의 같은 할 일로 이어 잼", async () => {
    const { rep, a, clock } = await setup();
    a.add("KAMP > 모델링", "2026-10-15");
    const m = dayTree(rep, "2026-10-15")[0]!.children[0]!;
    a.toggleTimer(m.id); // 23:50
    clock.set(new Date(2026, 9, 16, 0, 5).getTime());
    expect(a.splitAtMidnight()).toBe(1);
    expect(taskElapsedMs(rep, m.id, clock.now())).toBe(10 * MIN);
    const today = dayTree(rep, "2026-10-16");
    expect(today.map((n) => [n.task.title, n.children.map((c) => c.title)])).toEqual([["KAMP", ["모델링"]]]);
    const copy = today[0]!.children[0]!;
    expect(isRunning(rep, copy.id)).toBe(true);
    expect(taskElapsedMs(rep, copy.id, clock.now())).toBe(5 * MIN);
    expect(a.splitAtMidnight()).toBe(0);
  });

  it("며칠 켜져 있었으면 끊기만 하고 이어 재지 않음", async () => {
    const { rep, a, clock } = await setup();
    const r = a.add("모델링", "2026-10-15");
    if (!r.ok) throw new Error();
    a.toggleTimer(r.id);
    clock.set(new Date(2026, 9, 17, 9, 0).getTime());
    a.splitAtMidnight();
    expect(rep.list("session", (s) => s.end == null)).toHaveLength(0);
  });

  it("자리 비운 시간 빼기: 계속 · 멈추기 · 되돌리기", async () => {
    const { rep, a, clock } = await setup(new Date(2026, 9, 15, 10, 0).getTime());
    const r = a.add("모델링", "2026-10-15");
    if (!r.ok) throw new Error();
    a.toggleTimer(r.id);
    const since = clock.now() + 20 * MIN;
    clock.tick(70 * MIN);
    a.cutAway(rep.list("session").map((s) => s.id), since, true);
    expect(taskElapsedMs(rep, r.id, clock.now())).toBe(20 * MIN);
    expect(isRunning(rep, r.id)).toBe(true);
    a.undo();
    expect(taskElapsedMs(rep, r.id, clock.now())).toBe(70 * MIN);
    a.cutAway(rep.list("session", (s) => s.end == null).map((s) => s.id), since, false);
    expect(isRunning(rep, r.id)).toBe(false);
  });

  it("정리하기: 한 일 · 내일로 넘길 일 → 넘기면 다음 날에 같은 묶음으로", async () => {
    const { rep, a, clock } = await setup(new Date(2026, 9, 15, 10, 0).getTime());
    a.add("KAMP > 모델링", "2026-10-15");
    a.add("KAMP > 발표", "2026-10-15");
    a.add("이메일", "2026-10-15");
    const [g, mail] = dayTree(rep, "2026-10-15");
    a.toggleTimer(g!.children[0]!.id);
    clock.tick(30 * MIN);
    a.toggleDone(g!.children[0]!.id);
    const d = reviewData(rep, "2026-10-15", clock.now());
    expect(d).toMatchObject({ done: 1, total: 3, ms: 30 * MIN });
    expect(d.worked).toEqual([{ label: "▸ KAMP", detail: "1/2 · 30분" }]);
    expect(d.undone.map((u) => u.label)).toEqual(["KAMP › 발표", "이메일"]);
    expect(a.carryTo(d.undone.map((u) => u.id), "2026-10-16")).toBe(2);
    expect(dayTree(rep, "2026-10-16").map((n) => [n.task.title, n.children.map((c) => c.title)])).toEqual([["KAMP", ["발표"]], ["이메일", []]]);
    void mail;
  });

  it("절전 감지", () => {
    expect(sleepGap(0, 60_000)).toBeNull();
    expect(sleepGap(0, 5 * MIN)).toBe(0);
  });
});
