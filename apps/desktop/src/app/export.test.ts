import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { BUILTIN } from "./collections.ts";
import { allJson, collectionCsv, collectionMarkdown, diaryMarkdown } from "./export.ts";

async function setup() {
  const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main" });
  return { rep, a: new Actions(rep, "pc-1") };
}

describe("내보내기", () => {
  it("다이어리 Markdown: 글 · 기분 · 타임라인, 기간 안만", async () => {
    const { rep, a } = await setup();
    a.saveJournal(undefined, "2026-10-15", "산책했다.");
    a.setMood("2026-10-15", 4);
    a.addMoment(new Date(2026, 9, 15, 12, 40).getTime(), "점심 순두부");
    a.saveJournal(undefined, "2026-09-01", "지난달");
    const md = diaryMarkdown(rep, "2026-10-01", "2026-10-31", "2026년 10월 다이어리");
    expect(md).toBe(["# 2026년 10월 다이어리", "", "2026-10-01 ~ 2026-10-31 · 1일", "", "## 10월 15일 목요일 · 기분: 좋음", "", "산책했다.", "", "- 12:40 점심 순두부", ""].join("\n"));
  });

  it("모음 CSV: BOM · 따옴표 · 줄바꿈 · 별점", async () => {
    const { rep, a } = await setup();
    const s = BUILTIN.find((x) => x.key === "reviews")!;
    const id = a.addRecord("reviews", { title: '책 "하나", 둘', stage: 0, tags: ["추천"], note: "첫 줄\n둘째 줄", createdDay: "2026-10-01", f: { kind: "책", rating: 4, oneline: "좋음" } });
    a.setRecordStage(s, id, 2, "2026-10-16");
    const csv = collectionCsv(rep, s);
    expect(csv.startsWith("﻿제목,상태,끝낸 날,종류,별점,한줄평,태그,")).toBe(true);
    expect(csv).toContain('"책 ""하나"", 둘",다 봄,2026-10-16,책,★★★★,좋음,#추천,"첫 줄\n둘째 줄",2026-10-01');
  });

  it("모음 Markdown · 모든 기록 JSON", async () => {
    const { rep, a } = await setup();
    const s = BUILTIN.find((x) => x.key === "bucket")!;
    const id = a.addRecord("bucket", { title: "오로라 보기", done: false });
    a.setRecordDone(id, true, "2026-10-16");
    expect(collectionMarkdown(rep, s)).toContain("## [x] 오로라 보기\n\n- 상태: 이룸\n- 끝낸 날: 2026-10-16");
    const all = JSON.parse(allJson(rep, 0));
    expect(all.record).toHaveLength(1);
    expect(all.exportedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
