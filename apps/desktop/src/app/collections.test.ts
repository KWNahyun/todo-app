import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { BUILTIN, allSchemas, customSchema, isDone, items, splitTags, subtitle, tagsOf } from "./collections.ts";

const S = (k: string) => BUILTIN.find((s) => s.key === k)!;

async function setup() {
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main" });
  return { rep, a: new Actions(rep, "pc-1") };
}

describe("기록장 모음", () => {
  it("태그 나누기 (v1 split_tags)", () => {
    expect(splitTags("#여행 오로라 보기 #겨울")).toEqual({ title: "오로라 보기", tags: ["여행", "겨울"] });
  });

  it("완료 방식: 남은 것 먼저 · 걸러 보기 · 검색", async () => {
    const { rep, a } = await setup();
    const s = S("bucket");
    const x = a.addRecord("bucket", { title: "오로라 보기", tags: ["여행"] });
    a.addRecord("bucket", { title: "마라톤", tags: ["운동"] });
    a.setRecordDone(x, true, "2026-10-16");
    expect(items(rep, s).map((r) => r.title)).toEqual(["마라톤", "오로라 보기"]);
    expect(items(rep, s, { status: "done" }).map((r) => [r.title, r.doneOn])).toEqual([["오로라 보기", "2026-10-16"]]);
    expect(items(rep, s, { tag: "운동" })).toHaveLength(1);
    expect(items(rep, s, { q: "오로라" })).toHaveLength(1);
    expect(tagsOf(rep, s).sort()).toEqual(["여행", "운동"]);
  });

  it("단계 방식: 마지막 단계가 되면 그날 기록, 종류로 걸러 보기", async () => {
    const { rep, a } = await setup();
    const s = S("reviews");
    const id = a.addRecord("reviews", { title: "책 한 권", stage: 0, f: { kind: "책", rating: 4 } });
    a.addRecord("reviews", { title: "영화 하나", stage: 0, f: { kind: "영화" } });
    a.setRecordStage(s, id, 2, "2026-10-16");
    const r = rep.get<"record">(id)!;
    expect(isDone(s, r)).toBe(true);
    expect(r.doneOn).toBe("2026-10-16");
    expect(items(rep, s, { choice: "영화" }).map((x) => x.title)).toEqual(["영화 하나"]);
    expect(subtitle(s, r)).toBe("책 · ★★★★");
    a.setRecordStage(s, id, 1, "2026-10-17");
    expect(rep.get<"record">(id)!.doneOn).toBeNull();
  });

  it("오늘 할 일로 보내기 · 큰 목표로", async () => {
    const { rep, a } = await setup();
    const id = a.addRecord("bucket", { title: "오로라 보기" });
    expect(a.recordToToday(id, "버킷리스트", "2026-10-16")).toBe(true);
    expect(a.recordToToday(id, "버킷리스트", "2026-10-16")).toBe(false);
    expect(rep.list("task").map((t) => t.title).sort()).toEqual(["버킷리스트", "오로라 보기"]);
    expect(a.toGoal("오로라 보기")).toBe(true);
    expect(a.toGoal("오로라 보기")).toBe(false);
  });

  it("사용자 정의 모음", async () => {
    const { rep, a } = await setup();
    const col = a.create("collection", { label: "와인 노트", mode: "log", fields: [{ key: "c0", label: "산지", kind: "text" }, { key: "c1", label: "종류", kind: "choice", options: ["레드", "화이트"] }] }, "모음 만듦");
    expect(allSchemas(rep).map((s) => s.label)).toContain("와인 노트");
    const s = customSchema(rep.get<"collection">(col)!);
    expect(s).toMatchObject({ key: col, mode: "log", filterField: "c1", subtitle: ["c0", "c1"] });
    a.addRecord(col, { title: "2019 리슬링", day: "2026-10-16", f: { c0: "모젤", c1: "화이트" } });
    expect(items(rep, s, { choice: "화이트" })).toHaveLength(1);
  });
});
