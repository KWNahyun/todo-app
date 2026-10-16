import { describe, expect, it } from "vitest";
import type { Event } from "@dailytodo/core";
import { at } from "./dates.ts";
import { dueReminders, reminderKey } from "./reminders.ts";

const ev = (id: string, time: string | null, remindMin?: number | null): Event => ({
  id, type: "event", day: "2026-10-16", time, title: id, remindMin, createdAt: "", updatedAt: "",
});
const T = (hm: string) => at("2026-10-16", hm);

describe("일정 알림", () => {
  const list = [ev("회의", "13:30"), ev("미정", null), ev("5분전", "14:00", 5), ev("끔", "13:35", 0)];

  it("기본 10분 전부터 시작 전까지", () => {
    expect(dueReminders(list, T("13:19"), new Set(), 10)).toEqual([]);
    expect(dueReminders(list, T("13:20"), new Set(), 10).map((e) => e.id)).toEqual(["회의"]);
    expect(dueReminders(list, T("13:29"), new Set(), 10).map((e) => e.id)).toEqual(["회의"]);
    expect(dueReminders(list, T("13:30"), new Set(), 10)).toEqual([]);
  });

  it("일정마다 다른 시간 · 0 이면 끔 · 한 번만", () => {
    expect(dueReminders(list, T("13:54"), new Set(), 10)).toEqual([]);
    const due = dueReminders(list, T("13:55"), new Set(), 10);
    expect(due.map((e) => e.id)).toEqual(["5분전"]);
    expect(dueReminders(list, T("13:56"), new Set(due.map(reminderKey)), 10)).toEqual([]);
  });
});
