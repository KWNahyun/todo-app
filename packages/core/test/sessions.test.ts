import { describe, expect, it } from "vitest";
import { Replica } from "../src/replica.ts";
import {
  dayTotalsMs, isRunning, runningOnManyDevices, sessionsOf, startTimer, stopSession, stopTask, taskElapsedMs,
} from "../src/sessions.ts";
import { MemoryFs } from "../src/vault.ts";
import { manualClock } from "./helpers.ts";

const MIN = 60_000;

describe("타이머 = 세션", () => {
  it("켜고 끄면 구간이 쌓이고 합계가 잰 시간", async () => {
    const clk = manualClock();
    const rep = await Replica.open(new MemoryFs(), { deviceId: "pc", wall: clk.now });
    const t = rep.create("task", { day: "2026-10-15", title: "모델링" });
    startTimer(rep, t, clk.now());
    clk.tick(25 * MIN);
    expect(taskElapsedMs(rep, t, clk.now())).toBe(25 * MIN); // 재는 중이면 지금까지
    stopTask(rep, t, clk.now());
    clk.tick(60 * MIN);
    const s2 = startTimer(rep, t, clk.now());
    expect(startTimer(rep, t, clk.now())).toBe(s2); // 이미 재는 중이면 그대로
    clk.tick(10 * MIN);
    stopSession(rep, s2, clk.now());
    expect(sessionsOf(rep, t)).toHaveLength(2);
    expect(taskElapsedMs(rep, t, clk.now())).toBe(35 * MIN);
    expect(isRunning(rep, t)).toBe(false);
  });

  it("하나만 켜기: 다른 할 일을 켜면 앞의 것은 멈춤", async () => {
    const clk = manualClock();
    const rep = await Replica.open(new MemoryFs(), { deviceId: "pc", wall: clk.now });
    const a = rep.create("task", { day: "2026-10-15", title: "a" });
    const b = rep.create("task", { day: "2026-10-15", title: "b" });
    startTimer(rep, a, clk.now());
    clk.tick(MIN);
    startTimer(rep, b, clk.now());
    expect(isRunning(rep, a)).toBe(false);
    expect(isRunning(rep, b)).toBe(true);
    startTimer(rep, a, clk.now(), { single: false });
    expect(isRunning(rep, b)).toBe(true);
  });

  it("묶음 합계 · 날짜별 합계", async () => {
    const clk = manualClock();
    const rep = await Replica.open(new MemoryFs(), { deviceId: "pc", wall: clk.now });
    const g = rep.create("task", { day: "2026-10-15", title: "KAMP" });
    const c1 = rep.create("task", { day: "2026-10-15", title: "모델링", parentId: g });
    const c2 = rep.create("task", { day: "2026-10-15", title: "발표", parentId: g });
    const other = rep.create("task", { day: "2026-10-14", title: "어제 일" });
    const base = clk.now();
    rep.create("session", { taskId: c1, start: base, end: base + 30 * MIN, deviceId: "pc", kind: "normal" });
    rep.create("session", { taskId: c2, start: base, end: base + 15 * MIN, deviceId: "pc", kind: "normal" });
    rep.create("session", { taskId: g, start: base, end: base + 5 * MIN, deviceId: "pc", kind: "normal" });
    rep.create("session", { taskId: other, start: base, end: base + MIN, deviceId: "pc", kind: "imported" });
    expect(taskElapsedMs(rep, g, base, { children: true })).toBe(50 * MIN);
    expect(dayTotalsMs(rep, base)).toEqual({ "2026-10-15": 50 * MIN, "2026-10-14": MIN });
  });

  it("창마다 복제본이 따로여도 같은 PC ID 로 재면 한 기기로 침", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const widget = await Replica.open(fs, { deviceId: "pc-1-widget", wall: clk.now });
    const main = await Replica.open(fs, { deviceId: "pc-1-main", wall: clk.now });
    const t = widget.create("task", { day: "2026-10-15", title: "모델링" });
    const s = startTimer(widget, t, clk.now(), { deviceId: "pc-1" });
    await widget.sync();
    await main.sync();
    expect(startTimer(main, t, clk.now(), { deviceId: "pc-1" })).toBe(s);
    expect(runningOnManyDevices(main)).toEqual([]);
  });

  it("두 기기에서 같은 할 일을 재면 둘 다 기록되고 안내할 수 있음", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.now });
    const t = pc.create("task", { day: "2026-10-15", title: "모델링" });
    await pc.sync();
    await phone.sync();
    startTimer(pc, t, clk.now());
    startTimer(phone, t, clk.now());
    await pc.sync();
    await phone.sync();
    await pc.sync();
    expect(runningOnManyDevices(pc)).toEqual([{ taskId: t, devices: ["pc", "phone"] }]);
    clk.tick(10 * MIN);
    stopTask(pc, t, clk.now()); // 한쪽에서 끄면 둘 다 닫힘
    await pc.sync();
    await phone.sync();
    expect(isRunning(phone, t)).toBe(false);
    expect(taskElapsedMs(phone, t, clk.now())).toBe(20 * MIN); // 두 구간 합 (겹친 시간도 기록은 남음)
  });
});
