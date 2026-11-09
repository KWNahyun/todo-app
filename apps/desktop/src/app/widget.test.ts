import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { widgetData } from "./widget.ts";

describe("홈 화면 위젯 내용", () => {
  it("날짜별로 마감 먼저 · 일정은 시각 순, 범위는 지난달 ~ 6달 뒤", async () => {
    const rep = await Replica.open(new MemoryFs(), { deviceId: "phone-1-phone" });
    rep.create("event", { day: "2026-11-12", time: "18:00", title: "저녁" });
    rep.create("event", { day: "2026-11-12", time: "13:30", title: "회의" });
    rep.create("event", { day: "2026-11-12", time: null, title: "MT" });
    rep.create("deadline", { date: "2026-11-12", title: "보고서" });
    rep.create("event", { day: "2026-09-30", time: null, title: "너무 지난 것" });
    rep.create("event", { day: "2027-05-31", time: null, title: "6달 뒤 끝" });
    rep.create("event", { day: "2027-06-01", time: null, title: "너무 먼 것" });
    const d = widgetData(rep, "2026-11-09", 1);
    expect(d.days["2026-11-12"]).toEqual(["◆ 보고서", "MT", "13:30 회의", "18:00 저녁"]);
    expect(d.days["2027-05-31"]).toEqual(["6달 뒤 끝"]);
    expect(d.days["2026-09-30"]).toBeUndefined();
    expect(d.days["2027-06-01"]).toBeUndefined();
  });
});
