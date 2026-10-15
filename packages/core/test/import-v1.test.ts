import { describe, expect, it } from "vitest";
import { dayEnd, importV1, type V1Data } from "../src/import-v1.ts";
import { Replica } from "../src/replica.ts";
import { mandalaGrid } from "../src/schema.ts";
import { dayTotalsMs, sessionsOf, taskElapsedMs } from "../src/sessions.ts";
import { sortByOrder } from "../src/order.ts";
import { MemoryFs } from "../src/vault.ts";

const H = (s: string) => s.padEnd(32, "0");
const NOW = new Date(2026, 9, 15, 14, 0).getTime();

/** v1 파일 모양 그대로 (dailytodo/config.py 의 주석 · 실제 파일에서 확인한 키) */
const V1: V1Data = {
  tasks: {
    "2026-10-14": [
      { id: H("a1"), title: "이메일 답장", done: true, elapsed: 600.4, started_at: null, note: "", estimate: null, parent: null, collapsed: false },
    ],
    "2026-10-15": [
      { id: H("g1"), title: "KAMP 경진대회", done: false, elapsed: 0, started_at: null, note: "D-2", estimate: null, parent: null, collapsed: true },
      { id: H("c1"), title: "모델링", done: false, elapsed: 1500, started_at: NOW / 1000 - 600, note: "", estimate: 90, parent: H("g1"), pomos: 2 },
      { id: H("c2"), title: "데이터 EDA", done: true, elapsed: 3600, started_at: null, note: "", estimate: null, parent: H("g1") },
      { id: H("m1"), title: "운동 > 30분 걷기", done: false, elapsed: 0, started_at: null, note: "", estimate: null, parent: null, mandala: [2, 5] },
    ],
  },
  events: { "2026-10-15": [{ id: H("e1"), time: "13:30", title: "삐약이들 회의" }], "2026-10-21": [{ id: H("e2"), time: "", title: "시간 미정 약속" }] },
  deadlines: [{ id: H("d1"), title: "KAMP 최종 제출", date: "2026-10-17", group: "KAMP 경진대회" }],
  goals: [{ id: H("o1"), title: "영어", target_hours: 100, titles: ["영어 단어"], created: "2026-09-28" }],
  habits: { habits: [{ id: H("h1"), name: "운동" }, { id: H("h2"), name: "물 2L" }], log: { "2026-10-14": [H("h1"), H("h2")], "2026-10-15": [H("h1"), H("zz")] } },
  moods: { "2026-10-14": 4, "2026-10-15": 5 },
  journal: { "2026-10-14": "비가 와서 집에서 코테", "2026-10-13": "  " },
  mandalart: {
    center: "건강",
    subs: ["", "", "운동", "", "", "", "", ""],
    actions: Array.from({ length: 8 }, (_, s) => Array.from({ length: 8 }, (_, a) => (s === 2 && a === 5 ? "30분 걷기" : ""))),
    done: Array.from({ length: 8 }, () => Array(8).fill(false)),
  },
  collections: {
    date: [{ id: H("r1"), title: "100일", tags: ["기념일"], note: "좋았다", created: "2026-10-15", date: "2026-10-15", where: "성수", rating: 5, cost: "52000", file: "C:\\사진\\a.jpg" }],
    reviews: [{ id: H("r2"), title: "책 한 권", tags: [], note: "", created: "2026-10-01", stage: 2, done_on: "2026-10-15", kind: "책", rating: 4, oneline: "좋음" }],
    bucket: [{ id: H("r3"), title: "오로라 보기", tags: ["여행"], note: "", created: "2026-10-01", done: false, done_on: null }],
  },
};

async function imported(data = V1) {
  const fs = new MemoryFs();
  const summary = await importV1(fs, data, { now: NOW, deviceId: "import-pc", wall: () => NOW });
  const rep = await Replica.open(fs, { deviceId: "pc", wall: () => NOW });
  await rep.pull();
  return { fs, summary, rep };
}

describe("v1 가져오기", () => {
  it("항목 수", async () => {
    const { summary, rep } = await imported();
    expect(summary.counts).toEqual({
      task: 5, session: 4, event: 2, deadline: 1, goal: 1, habit: 2, habitCheck: 3, mood: 2, journal: 1, mandala: 1, record: 3,
    });
    expect(rep.list("task")).toHaveLength(5);
    expect(summary.running).toBe(1);
  });

  it("잰 시간이 v1 과 같음 (날짜별 · 진행 중 포함)", async () => {
    const { summary, rep } = await imported();
    const mine = dayTotalsMs(rep, NOW);
    expect(Object.keys(mine).sort()).toEqual(Object.keys(summary.secondsByDay).sort());
    for (const [day, secs] of Object.entries(summary.secondsByDay)) expect(Math.abs(mine[day]! / 1000 - secs)).toBeLessThan(0.01);
    expect(summary.secondsByDay["2026-10-15"]).toBe(1500 + 600 + 3600);
  });

  it("세션: 누적은 그날 끝에 끝나는 구간, 진행 중은 열린 구간", async () => {
    const { rep } = await imported();
    const t = rep.list("task", (x) => x.title === "모델링")[0]!;
    const ss = sessionsOf(rep, t.id);
    expect(ss).toHaveLength(2);
    const imp = ss.find((s) => s.kind === "imported")!;
    expect(imp.end).toBe(dayEnd("2026-10-15"));
    expect(imp.end! - imp.start).toBe(1500_000);
    const run = ss.find((s) => s.end == null)!;
    expect(run.start).toBe(NOW - 600_000);
    expect(taskElapsedMs(rep, t.id, NOW)).toBe(2100_000);
  });

  it("묶음 · 순서 · 만다라트 연결 · 메모 · 예상 시간", async () => {
    const { rep } = await imported();
    const day = sortByOrder(rep.list("task", (t) => t.day === "2026-10-15"));
    expect(day.map((t) => t.title)).toEqual(["KAMP 경진대회", "모델링", "데이터 EDA", "운동 > 30분 걷기"]);
    const [g, c1, c2, m] = day;
    expect(c1!.parentId).toBe(g!.id);
    expect(c2!.parentId).toBe(g!.id);
    expect(g).toMatchObject({ collapsed: true, note: "D-2", parentId: null });
    expect(c1).toMatchObject({ estimateMin: 90, pomos: 2 });
    expect(m!.ref).toBe("mandala/2/5");
    expect(taskElapsedMs(rep, g!.id, NOW, { children: true })).toBe(5700_000);
  });

  it("일정 · 마감 · 목표 · 습관 · 기분 · 일기 · 만다라트", async () => {
    const { rep } = await imported();
    expect(rep.list("event").map((e) => [e.day, e.time, e.title]).sort()).toEqual([
      ["2026-10-15", "13:30", "삐약이들 회의"],
      ["2026-10-21", null, "시간 미정 약속"],
    ]);
    expect(rep.list("deadline")[0]).toMatchObject({ date: "2026-10-17", title: "KAMP 최종 제출", groupTitle: "KAMP 경진대회" });
    expect(rep.list("goal")[0]).toMatchObject({ title: "영어", targetHours: 100, linkedTitles: ["영어 단어"], createdDay: "2026-09-28" });
    const habits = sortByOrder(rep.list("habit"));
    expect(habits.map((h) => h.name)).toEqual(["운동", "물 2L"]);
    const checks = rep.list("habitCheck");
    expect(checks.filter((c) => c.habitId === habits[0]!.id).map((c) => c.day).sort()).toEqual(["2026-10-14", "2026-10-15"]);
    expect(rep.list("mood").map((m) => m.level).sort()).toEqual([4, 5]);
    expect(rep.list("journal").map((j) => j.text)).toEqual(["비가 와서 집에서 코테"]); // 빈 일기는 건너뜀
    const grid = mandalaGrid(rep.list("mandala")[0]!);
    expect(grid.center).toBe("건강");
    expect(grid.subs[2]).toBe("운동");
    expect(grid.actions[2]![5]).toBe("30분 걷기");
    expect(grid.done[0]![0]).toBe(false);
  });

  it("기록장 모음은 모두 record 로 (모음별 칸은 f 아래)", async () => {
    const { rep } = await imported();
    const date = rep.list("record", (r) => r.collection === "date")[0]!;
    expect(date).toMatchObject({ title: "100일", tags: ["기념일"], note: "좋았다", day: "2026-10-15", createdDay: "2026-10-15" });
    expect(date.f).toEqual({ where: "성수", rating: 5, cost: "52000", file: "C:\\사진\\a.jpg" });
    const review = rep.list("record", (r) => r.collection === "reviews")[0]!;
    expect(review).toMatchObject({ stage: 2, doneOn: "2026-10-15", f: { kind: "책", rating: 4, oneline: "좋음" } });
    expect(rep.list("record", (r) => r.collection === "bucket")[0]).toMatchObject({ done: false, doneOn: null });
  });

  it("다시 가져와도 중복 없이 최신 v1 값으로 맞춰짐", async () => {
    const { fs, rep } = await imported();
    const n = rep.dump().length;
    const changed: V1Data = structuredClone(V1);
    changed.tasks!["2026-10-15"]![2]!.title = "데이터 EDA (고침)";
    // 시계가 오히려 뒤로 가 있어도 다시 가져오기가 이김
    await importV1(fs, changed, { now: NOW, deviceId: "import-pc", wall: () => NOW - 60_000 });
    await rep.pull();
    expect(rep.dump().length).toBe(n);
    expect(rep.list("task", (t) => t.title === "데이터 EDA (고침)")).toHaveLength(1);
  });

  it("빈 v1 · 일부 파일만 있는 v1", async () => {
    const { summary, rep } = await imported({ moods: { "2026-10-15": 3 } });
    expect(summary.counts).toEqual({ mood: 1 });
    expect(summary.totalSeconds).toBe(0);
    expect(rep.list("mood")).toHaveLength(1);
  });
});
