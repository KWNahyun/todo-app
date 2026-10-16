import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { computeStats, goalMs, periodDays, periodLabel, shiftEnd } from "./stats.ts";

const H = 3_600_000;

async function setup() {
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main" });
  const task = (day: string, title: string, ms: number, extra: Record<string, unknown> = {}) => {
    const id = rep.create("task", { day, title, ...extra });
    if (ms) rep.create("session", { taskId: id, start: 0, end: ms, deviceId: "pc", kind: "normal" });
    return id;
  };
  return { rep, task };
}

describe("통계", () => {
  it("기간", () => {
    expect(periodDays("week", "2026-10-16")).toEqual(["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(periodDays("month", "2026-10-16")).toHaveLength(31);
    const y = periodDays("year", "2026-10-16");
    expect([y[0], y[y.length - 1]]).toEqual(["2025-11-01", "2026-10-31"]);
    expect(shiftEnd("month", "2026-10-16", -1)).toBe("2026-09-30");
    expect(shiftEnd("week", "2026-10-16", 1)).toBe("2026-10-23");
    expect(periodLabel("week", "2026-10-16")).toBe("10.10 – 10.16");
    expect(periodLabel("year", "2026-10-16")).toBe("2025.11 – 2026.10");
  });

  it("시간 기준: 날짜별 · 묶음으로 합친 순위 · 타일", async () => {
    const { rep, task } = await setup();
    const g = task("2026-10-15", "KAMP", 0);
    task("2026-10-15", "모델링", 2 * H, { parentId: g, done: true });
    task("2026-10-15", "발표", H, { parentId: g });
    task("2026-10-14", "영어 단어", 0.5 * H, { done: true });
    rep.create("mood", { day: "2026-10-15", level: 4 });
    const s = computeStats(rep, "week", "2026-10-16", "time", 0);
    expect(s.buckets.find((b) => b.key === "2026-10-15")).toMatchObject({ value: 3 * H, mood: 4, label: "목" });
    expect(s.top).toEqual([{ name: "KAMP", value: 3 * H }, { name: "영어 단어", value: 0.5 * H }]);
    expect(s.tiles.map((t) => t.value)).toEqual(["3시간 30분", "1시간 45분", "2 / 3"]); // 묶음(상위)은 개수에서 뺌
  });

  it("완료 기준 · 연 단위는 달별", async () => {
    const { rep, task } = await setup();
    task("2026-10-15", "a", 0, { done: true });
    task("2026-10-15", "b", 0);
    task("2026-09-03", "c", 0, { done: true });
    const s = computeStats(rep, "year", "2026-10-16", "done", 0);
    expect(s.buckets).toHaveLength(12);
    expect(s.buckets.slice(-2).map((b) => [b.label, b.value])).toEqual([["9월", 1], ["10월", 1]]);
    expect(s.tiles.map((t) => t.value)).toEqual(["2개", "1개", "66%"]);
  });

  it("습관 격자 · 큰 목표(기간 · 누적) · 예상 시간", async () => {
    const { rep, task } = await setup();
    const h = rep.create("habit", { name: "운동" });
    rep.create("habitCheck", { habitId: h, day: "2026-10-15" });
    rep.create("habitCheck", { habitId: h, day: "2026-09-01" });
    const goal = rep.create("goal", { title: "영어", linkedTitles: ["영어 단어"], targetHours: 100 });
    task("2026-10-14", "영어 단어", H, { done: true, estimateMin: 90 });
    task("2026-09-01", "영어", 2 * H, { done: true, estimateMin: 60 });
    const s = computeStats(rep, "week", "2026-10-16", "time", 0);
    expect(s.habits).toEqual([{ id: h, name: "운동", cells: [false, false, false, false, false, true, false], count: 1 }]);
    expect(s.goals).toEqual([{ id: goal, title: "영어", period: H, total: 3 * H, targetMs: 100 * H }]);
    expect(s.estimate).toEqual({ count: 1, within: 1 });
    expect(goalMs(rep, rep.get<"goal">(goal)!, null, 0)).toBe(3 * H);
  });
});
