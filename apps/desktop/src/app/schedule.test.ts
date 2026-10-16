import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { Actions } from "./actions.ts";
import { itemsByDay, monthGrid, rangeDays, shiftAnchor, weekStart } from "./schedule.ts";

describe("일정표 범위 (일요일 시작)", () => {
  it("주 · 2주", () => {
    expect(weekStart("2026-10-16")).toBe("2026-10-11"); // 금 → 그 주 일요일
    expect(weekStart("2026-10-11")).toBe("2026-10-11");
    expect(rangeDays("week", "2026-10-16")).toEqual(["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]);
    expect(rangeDays("2weeks", "2026-10-16")).toHaveLength(14);
    expect(shiftAnchor("2weeks", "2026-10-16", 1)).toBe("2026-10-30");
  });

  it("달: 1일이 든 주부터 말일이 든 주까지", () => {
    const g = monthGrid("2026-10-16"); // 10/1 목요일, 10/31 토요일
    expect(g[0]).toBe("2026-09-27");
    expect(g[g.length - 1]).toBe("2026-10-31");
    expect(g).toHaveLength(35);
    expect(monthGrid("2026-02-10")).toHaveLength(28); // 2026-02-01 일요일 ~ 02-28 토요일
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
  });

  it("날짜별 일정 · 마감, 끌어 놓아 날짜 옮기기 · 되돌리기", async () => {
    const rep = await Replica.open(new MemoryFs(), { deviceId: "pc-1-main" });
    const a = new Actions(rep, "pc-1");
    const ev = a.addDated({ kind: "event", day: "2026-10-16", time: "13:30", title: "회의" });
    const dl = a.addDated({ kind: "deadline", date: "2026-10-17", title: "제출" });
    const days = rangeDays("week", "2026-10-16");
    let m = itemsByDay(rep, days);
    expect(m.get("2026-10-16")!.events.map((e) => e.title)).toEqual(["회의"]);
    expect(m.get("2026-10-17")!.deadlines.map((d) => d.title)).toEqual(["제출"]);
    a.moveToDay(ev, "2026-10-14");
    a.moveToDay(dl, "2026-10-14");
    m = itemsByDay(rep, days);
    expect(m.get("2026-10-14")!.events).toHaveLength(1);
    expect(m.get("2026-10-14")!.deadlines).toHaveLength(1);
    a.undo();
    expect(rep.get<"deadline">(dl)!.date).toBe("2026-10-17");
  });
});
