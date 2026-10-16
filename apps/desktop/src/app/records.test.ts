import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { dateRecords, daySummary, diaryDays, journalOf, moodOf, parseTags, promptOf, PROMPTS } from "./records.ts";

async function setup() {
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main" });
  return { rep, a: new Actions(rep, "pc-1") };
}

describe("기록장", () => {
  it("일기 · 기분: 하루에 하나, 같은 기분을 다시 누르면 지움", async () => {
    const { rep, a } = await setup();
    const id = a.saveJournal(undefined, "2026-10-15", "오늘은 일찍");
    expect(a.saveJournal(journalOf(rep, "2026-10-15")?.id, "2026-10-15", "오늘은 일찍 일어났다")).toBe(id);
    expect(rep.list("journal")).toHaveLength(1);
    a.setMood("2026-10-15", 4);
    a.setMood("2026-10-15", 5);
    expect(moodOf(rep, "2026-10-15")!.level).toBe(5);
    a.setMood("2026-10-15", 5);
    expect(moodOf(rep, "2026-10-15")).toBeUndefined();
    a.undo();
    expect(moodOf(rep, "2026-10-15")!.level).toBe(5);
  });

  it("목록 · 검색 · 요약", async () => {
    const { rep, a } = await setup();
    a.saveJournal(undefined, "2026-10-14", "비가 와서 코테\n둘째 줄");
    a.addMoment(new Date(2026, 9, 15, 12, 40).getTime(), "점심 순두부");
    a.setMood("2026-10-13", 3);
    a.saveJournal(undefined, "2026-09-30", "지난달 코테");
    expect(diaryDays(rep, "2026-10").map((r) => [r.day, r.preview, r.mood])).toEqual([
      ["2026-10-15", "점심 순두부", undefined],
      ["2026-10-14", "비가 와서 코테", undefined],
      ["2026-10-13", "", 3],
    ]);
    expect(diaryDays(rep, "2026-10", "코테").map((r) => r.day)).toEqual(["2026-10-14", "2026-09-30"]);
    a.add("모델링", "2026-10-15");
    a.add("13:30 회의", "2026-10-15");
    expect(daySummary(rep, "2026-10-15", Date.now())).toBe("할 일 0/1 완료 · 일정 1개");
    expect(daySummary(rep, "2026-10-01", Date.now())).toBe("이 날의 할 일 기록은 없어요");
  });

  it("데이트 일기 · 태그", async () => {
    const { rep, a } = await setup();
    a.addRecord("date", { title: "한강 피크닉", day: "2026-10-09", f: { where: "여의도" } });
    a.addRecord("date", { title: "100일", day: "2026-10-15", tags: ["기념일"], f: { where: "성수", rating: 5 } });
    a.addRecord("bucket", { title: "오로라" });
    expect(dateRecords(rep).map((r) => r.title)).toEqual(["100일", "한강 피크닉"]);
    expect(dateRecords(rep, "성수").map((r) => r.title)).toEqual(["100일"]);
    expect(dateRecords(rep, "기념일")).toHaveLength(1);
    expect(parseTags("#기념일 #맛집, 성수")).toEqual(["기념일", "맛집", "성수"]);
  });

  it("오늘의 질문은 날짜마다 정해짐", () => {
    expect(PROMPTS).toContain(promptOf("2026-10-15"));
    expect(promptOf("2026-10-15")).toBe(promptOf("2026-10-15"));
    expect(promptOf("2026-10-15")).not.toBe(promptOf("2026-10-16"));
  });
});
