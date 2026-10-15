import { describe, expect, it } from "vitest";
import { Clock, compareHlc, formatHlc, isHlc, parseHlc } from "../src/hlc.ts";

describe("HLC", () => {
  it("형식과 문자열 비교 = 시각 순서", () => {
    const t = formatHlc({ ms: 1729000000123, c: 4, node: "pc-1" });
    expect(t).toBe("1729000000123:0004:pc-1");
    expect(parseHlc(t)).toEqual({ ms: 1729000000123, c: 4, node: "pc-1" });
    expect(isHlc(t)).toBe(true);
    expect(isHlc("1729:1:pc")).toBe(false);
    expect(compareHlc("1729000000123:0004:pc-1", "1729000000123:0010:pc-1")).toBe(-1);
    expect(compareHlc("1729000000124:0000:a", "1729000000123:9999:z")).toBe(1);
    expect(compareHlc("1729000000123:0004:a", "1729000000123:0004:b")).toBe(-1); // 같으면 기기ID
  });

  it("같은 ms 안에서도, 시계가 뒤로 가도 늘 커짐", () => {
    let w = 1000_000;
    const c = new Clock("pc", { wall: () => w });
    const a = c.now();
    const b = c.now();
    w -= 5000; // 시계가 뒤로
    const d = c.now();
    expect(a < b && b < d).toBe(true);
    expect(parseHlc(d).ms).toBe(1000_000);
  });

  it("다른 기기 시각을 받으면 그 뒤의 시각을 만듦 (내 시계가 늦어도)", () => {
    const slow = new Clock("slow", { wall: () => 1000 });
    const remote = "0000000005000:0007:fast";
    slow.receive(remote);
    const t = slow.now();
    expect(t > remote).toBe(true);
  });

  it("너무 먼 미래 시각은 따라가지 않음", () => {
    const c = new Clock("pc", { wall: () => 1000, maxDriftMs: 60_000 });
    c.receive(formatHlc({ ms: 10_000_000, c: 0, node: "broken" }));
    expect(parseHlc(c.now()).ms).toBe(1000);
  });

  it("같은 ms 에 1만 번 넘게 써도 순서 유지", () => {
    const c = new Clock("pc", { wall: () => 5 });
    let prev = "";
    for (let i = 0; i < 20_005; i++) {
      const t = c.now();
      expect(t > prev).toBe(true);
      prev = t;
    }
  });

  it("다시 켤 때 last 로 이어감", () => {
    const c = new Clock("pc", { wall: () => 100 });
    c.now();
    const last = c.last()!;
    const c2 = new Clock("pc", { wall: () => 50, last });
    expect(c2.now() > last).toBe(true);
  });

  it("기기ID 검사", () => {
    expect(() => new Clock("pc:1")).toThrow();
    expect(() => new Clock("")).toThrow();
  });
});
