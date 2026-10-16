import { describe, expect, it } from "vitest";
import { MemoryFs, Replica, isRunning, taskElapsedMs } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { featureOn, sharedSettings } from "./appearance.ts";
import { dayTree, progress, timeline } from "./selectors.ts";

const DAY = "2026-10-15";

async function setup() {
  let t = new Date(2026, 9, 15, 9, 0).getTime();
  const clock = { now: () => t, tick: (ms: number) => (t += ms) };
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main", wall: clock.now });
  const a = new Actions(rep, "pc-1", clock.now);
  return { rep, a, clock };
}

const titles = (rep: Replica) => dayTree(rep, DAY).map((n) => [n.task.title, ...n.children.map((c) => `  ${c.title}`)]).flat();

describe("동작 · 되돌리기", () => {
  it("입력 한 줄로 할 일 · 하위 · 일정 · 마감 · 기록", async () => {
    const { rep, a } = await setup();
    a.add("이메일 답장", DAY);
    a.add("KAMP > 모델링", DAY);
    a.add("KAMP > 발표 자료", DAY);
    a.add("13:30 삐약이들 회의", DAY);
    a.add("마감 10/17 KAMP 제출", DAY);
    a.add("- 점심 맛있었다", DAY);
    expect(titles(rep)).toEqual(["이메일 답장", "KAMP", "  모델링", "  발표 자료"]);
    expect(rep.list("event")[0]).toMatchObject({ time: "13:30", title: "삐약이들 회의", day: DAY });
    expect(rep.list("deadline")[0]).toMatchObject({ date: "2026-10-17" });
    expect(rep.list("moment")[0]!.text).toBe("점심 맛있었다");
    expect(a.add("마감 KAMP", DAY)).toMatchObject({ ok: false });
  });

  it("완료하면 타이머가 멈추고, 되돌리면 다시 재는 중", async () => {
    const { rep, a, clock } = await setup();
    const r = a.add("모델링", DAY);
    const id = r.ok ? r.id : "";
    a.toggleTimer(id);
    clock.tick(25 * 60_000);
    a.toggleDone(id);
    expect(rep.get<"task">(id)!.done).toBe(true);
    expect(isRunning(rep, id)).toBe(false);
    expect(taskElapsedMs(rep, id, clock.now())).toBe(25 * 60_000);
    a.undo();
    expect(rep.get<"task">(id)!.done).toBe(false);
    expect(rep.get<"task">(id)!.doneAt).toBeNull();
    expect(isRunning(rep, id)).toBe(true);
  });

  it("하나만 켜기 · 세션의 기기는 PC ID", async () => {
    const { rep, a } = await setup();
    const x = a.add("a", DAY);
    const y = a.add("b", DAY);
    if (!x.ok || !y.ok) throw new Error();
    a.toggleTimer(x.id);
    a.toggleTimer(y.id);
    expect(isRunning(rep, x.id)).toBe(false);
    expect(isRunning(rep, y.id)).toBe(true);
    expect(rep.list("session").every((s) => s.deviceId === "pc-1")).toBe(true);
    a.undo(); // b 시작 되돌림 → a 가 다시 재는 중
    expect(isRunning(rep, x.id)).toBe(true);
    expect(isRunning(rep, y.id)).toBe(false);
  });

  it("묶음 지우기는 하위 · 세션까지, 되돌리면 모두 되살아남", async () => {
    const { rep, a } = await setup();
    a.add("KAMP > 모델링", DAY);
    a.add("KAMP > 발표", DAY);
    const group = dayTree(rep, DAY)[0]!.task;
    a.toggleTimer(dayTree(rep, DAY)[0]!.children[0]!.id);
    a.removeTask(group.id);
    expect(rep.list("task")).toHaveLength(0);
    expect(rep.list("session")).toHaveLength(0);
    a.undo();
    expect(titles(rep)).toEqual(["KAMP", "  모델링", "  발표"]);
    expect(rep.list("session")).toHaveLength(1);
  });

  it("추가를 되돌리면 지워짐", async () => {
    const { rep, a } = await setup();
    a.add("KAMP > 모델링", DAY);
    a.undo();
    expect(rep.list("task")).toHaveLength(0);
  });

  it("끌어서 옮기기 (같은 묶음 안) · 되돌리기", async () => {
    const { rep, a } = await setup();
    for (const t of ["a", "b", "c", "d"]) a.add(t, DAY);
    const id = (t: string) => rep.list("task", (x) => x.title === t)[0]!.id;
    a.move(id("d"), 0);
    expect(titles(rep)).toEqual(["d", "a", "b", "c"]);
    a.move(id("a"), 3);
    expect(titles(rep)).toEqual(["d", "b", "c", "a"]);
    a.undo();
    expect(titles(rep)).toEqual(["d", "a", "b", "c"]);
  });

  it("두 기기가 같은 순서 값을 만들었어도 옮기기가 됨 (다시 매김)", async () => {
    const { rep, a } = await setup();
    for (const t of ["a", "b", "c"]) rep.create("task", { day: DAY, title: t, order: "a0" });
    const ids = dayTree(rep, DAY).map((n) => n.task.id);
    a.move(ids[2]!, 1);
    const after = dayTree(rep, DAY).map((n) => n.task.id);
    expect(after).toEqual([ids[0], ids[2], ids[1]]);
    expect(new Set(after.map((i) => rep.get<"task">(i)!.order)).size).toBe(3);
  });

  it("고친 칸 되돌리기 (새로 생긴 칸은 비움)", async () => {
    const { rep, a } = await setup();
    const r = a.add("모델링", DAY);
    if (!r.ok) throw new Error();
    a.update(r.id, { note: "피처 3개" });
    a.update(r.id, { title: "모델링 v2" });
    a.undo();
    expect(rep.get<"task">(r.id)).toMatchObject({ title: "모델링", note: "피처 3개" });
    a.undo();
    expect(rep.get<"task">(r.id)!.note).toBeNull();
  });

  it("만다라트 실천 칸 → 할 일, 완료하면 칸도 완료 · 되돌리면 같이", async () => {
    const { rep, a } = await setup();
    a.setMandalaCell("center", "건강");
    a.setMandalaCell("subs.2", "운동");
    a.setMandalaCell("actions.2.5", "30분 걷기");
    const id = a.mandalaToTask(2, 5, "운동", "30분 걷기", DAY)!;
    expect(a.mandalaToTask(2, 5, "운동", "30분 걷기", DAY)).toBeNull(); // 이미 있음
    expect(titles(rep)).toEqual(["운동", "  30분 걷기"]);
    a.toggleDone(id);
    const m = () => rep.get<"mandala">(a.mandalaId())!;
    expect(m().done?.["2"]?.["5"]).toBe(true);
    a.undo();
    expect(m().done?.["2"]?.["5"]).toBeFalsy(); // 처음엔 없던 칸이라 비움(null) — mandalaGrid 에선 false
  });

  it("같이 쓰는 설정: 기능 끄기 · 테마, 칸 단위로 합쳐짐 · 되돌리기", async () => {
    const { rep, a } = await setup();
    expect(featureOn(rep, "mood")).toBe(true); // 없으면 켜짐
    a.setShared({ features: { mood: false } });
    a.setShared({ theme: "wood" });
    a.setShared({ features: { date: false } });
    expect(featureOn(rep, "mood")).toBe(false);
    expect(featureOn(rep, "date")).toBe(false);
    expect(sharedSettings(rep).theme).toBe("wood");
    a.undo();
    expect(featureOn(rep, "date")).toBe(true);
    expect(featureOn(rep, "mood")).toBe(false);
  });

  it("진행률 · 타임라인", async () => {
    const { rep, a, clock } = await setup();
    a.add("KAMP > 모델링", DAY);
    a.add("KAMP > 발표", DAY);
    a.add("이메일", DAY);
    a.add("13:30 회의", DAY);
    const m = dayTree(rep, DAY)[0]!.children[0]!;
    a.toggleTimer(m.id);
    clock.tick(85 * 60_000);
    a.toggleDone(m.id);
    a.add("- 점심 맛있었다", DAY);
    expect(progress(dayTree(rep, DAY))).toEqual({ done: 1, total: 3 });
    expect(timeline(rep, DAY, clock.now()).map((i) => [i.auto, i.text])).toEqual([
      [true, "✓ 모델링 완료 · 1시간 25분"],
      [false, "점심 맛있었다"],
      [true, "회의"],
    ]);
  });
});
