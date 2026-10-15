import { describe, expect, it } from "vitest";
import { compareOrder, keyBetween, keysBetween, sortByOrder } from "../src/order.ts";
import { rng } from "./helpers.ts";

describe("분수 인덱스 순서", () => {
  it("기본 값", () => {
    expect(keyBetween(null, null)).toBe("a0");
    expect(keyBetween("a0", null)).toBe("a1");
    expect(keyBetween(null, "a0")).toBe("Zz");
    expect(keyBetween("a0", "a1")).toBe("a0V");
    expect(keyBetween("a0", "a0V")).toBe("a0G");
  });

  it("아무 데나 2000번 끼워도 늘 정렬 · 중복 없음", () => {
    const r = rng(7);
    const keys: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const at = r.int(keys.length + 1);
      const k = keyBetween(keys[at - 1] ?? null, keys[at] ?? null);
      keys.splice(at, 0, k);
    }
    const sorted = [...keys].sort(compareOrder);
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("맨 앞 · 맨 뒤에 계속 붙여도 됨", () => {
    let first = keyBetween(null, null);
    let last = first;
    for (let i = 0; i < 500; i++) {
      const f = keyBetween(null, first);
      const l = keyBetween(last, null);
      expect(f < first && l > last).toBe(true);
      first = f;
      last = l;
    }
  });

  it("n 개 한꺼번에", () => {
    for (const [a, b] of [[null, null], ["a0", null], [null, "a0"], ["a0", "a5"]] as const) {
      const ks = keysBetween(a, b, 37);
      expect(ks).toHaveLength(37);
      expect([...ks].sort(compareOrder)).toEqual(ks);
      if (a) expect(ks[0]! > a).toBe(true);
      if (b) expect(ks[36]! < b).toBe(true);
    }
  });

  it("두 기기가 같은 값을 만들면 ID 로 순서", () => {
    const xs = [
      { id: "b", order: "a0V" },
      { id: "a", order: "a0V" },
      { id: "c", order: "a0" },
    ];
    expect(sortByOrder(xs).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });

  it("잘못된 값은 거부", () => {
    expect(() => keyBetween("a1", "a0")).toThrow();
    expect(() => keyBetween("a00", null)).toThrow(); // 끝자리 0
  });
});
