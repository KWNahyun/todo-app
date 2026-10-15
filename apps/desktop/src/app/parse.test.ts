import { describe, expect, it } from "vitest";
import { parseEvent, parseInput, previewKind } from "./parse.ts";

const T = "2026-10-15";

describe("입력 한 줄 (v1 문법 + 새 문법)", () => {
  it("할 일 · 하위 할 일", () => {
    expect(parseInput("모델링", T, T)).toEqual({ kind: "task", title: "모델링" });
    expect(parseInput("KAMP > 발표 자료", T, T)).toEqual({ kind: "task", title: "발표 자료", parentTitle: "KAMP" });
    expect(parseInput("> 이상함", T, T)).toEqual({ kind: "task", title: "> 이상함" });
  });

  it("일정: 시각 표기 여러 가지 (v1 과 같음)", () => {
    expect(parseEvent("13:30 삐약이들 회의")).toEqual({ time: "13:30", title: "삐약이들 회의" });
    expect(parseEvent("오후 3시 반 회의")).toEqual({ time: "15:30", title: "회의" });
    expect(parseEvent("3시 회의")).toEqual({ time: "15:00", title: "회의" }); // 1~6시는 오후로
    expect(parseEvent("오전 12시 20분 알람")).toEqual({ time: "00:20", title: "알람" });
    expect(parseEvent("9시 수업")).toEqual({ time: "09:00", title: "수업" });
    expect(parseEvent("미정 MT")).toEqual({ time: null, title: "MT" });
    expect(parseEvent("3시간 공부")).toBeNull();
    expect(parseEvent("25:00 이상")).toBeNull();
    expect(parseInput("18:00 KAMP 회의", "2026-10-16", T)).toEqual({ kind: "event", day: "2026-10-16", time: "18:00", title: "KAMP 회의" });
  });

  it("날짜 + 시각이면 그날 일정, 날짜만이면 할 일 ('3.5 리포트')", () => {
    expect(parseInput("10/20 13:30 회의", T, T)).toEqual({ kind: "event", day: "2026-10-20", time: "13:30", title: "회의" });
    expect(parseInput("1월 3일 오후 2시 병원", T, T)).toEqual({ kind: "event", day: "2027-01-03", time: "14:00", title: "병원" }); // 두 달 넘게 지난 날짜 → 내년
    expect(parseInput("3.5 리포트", T, T)).toEqual({ kind: "task", title: "3.5 리포트" });
  });

  it("마감", () => {
    expect(parseInput("마감 10/20 KAMP 제출", T, T)).toEqual({ kind: "deadline", date: "2026-10-20", title: "KAMP 제출" });
    expect(parseInput("마감 KAMP", T, T)).toMatchObject({ kind: "error" });
    expect(parseInput("마감 2/30 없는 날", T, T)).toEqual({ kind: "error", message: "2월 30일은 없는 날짜예요." });
  });

  it("- 로 시작하면 타임라인 기록", () => {
    expect(parseInput("- 점심 맛있었다", T, T)).toEqual({ kind: "moment", text: "점심 맛있었다" });
    expect(parseInput("-빼기 없는 할 일", T, T)).toEqual({ kind: "task", title: "-빼기 없는 할 일" });
  });

  it("입력창 왼쪽 표시", () => {
    expect(previewKind("", T, T).label).toBe("할 일");
    expect(previewKind("13:30 회의", T, T).label).toBe("일정");
    expect(previewKind("마감 ", T, T).label).toBe("마감");
    expect(previewKind("마감 10/20 x", T, T).label).toBe("마감");
    expect(previewKind("A > B", T, T).label).toBe("하위 할 일");
    expect(previewKind("- 메모", T, T).label).toBe("기록");
  });
});
