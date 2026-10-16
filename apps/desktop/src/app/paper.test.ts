import { describe, expect, it } from "vitest";
import type { PageItem } from "@dailytodo/core";
import { decodePts, encodePts, hitTest, itemBox, strokeFields, strokePath, thin, toLocal, type Pt } from "./paper.ts";

const item = (x: Partial<PageItem>): PageItem => ({ id: "i", type: "pageItem", day: "2026-10-16", kind: "sticker", x: 0, y: 0, createdAt: "", updatedAt: "", ...x });

describe("종이 다이어리 계산", () => {
  it("점 저장 · 솎아내기", () => {
    const pts: Pt[] = [[1.25, 2.5, 0.5], [10, 20, 1]];
    expect(encodePts(pts)).toBe("13,25,50;100,200,100");
    expect(decodePts("13,25,50;100,200,100")).toEqual([[1.3, 2.5, 0.5], [10, 20, 1]]);
    expect(thin([[0, 0, 1], [0.1, 0, 1], [0.2, 0, 1], [5, 0, 1]])).toHaveLength(2);
  });

  it("획: 필압으로 굵기가 변하는 다각형, 점 하나면 동그라미", () => {
    const d = strokePath([[0, 0, 0.2], [10, 0, 1], [20, 0, 0.2]], 4);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(strokePath([[5, 5, 0.5]], 4)).toContain("a");
  });

  it("그린 점 → 자기 좌표 항목, 위치 · 맞히기", () => {
    const f = strokeFields([[100, 100, 0.5], [150, 120, 0.5]], "#000", 4, false);
    const it = item({ ...f });
    expect(it.x).toBeCloseTo(97.6);
    expect(hitTest(it, 125, 110)).toBe(true); // 선 위
    expect(hitTest(it, 125, 160)).toBe(false); // 멀리
  });

  it("스티커 상자 · 배율 · 회전", () => {
    const st = item({ x: 100, y: 100, w: 80, h: 80, s: 1.5 });
    expect(itemBox(st)).toEqual({ x: 100, y: 100, w: 120, h: 120 });
    expect(hitTest(st, 210, 210)).toBe(true);
    expect(hitTest(st, 230, 230)).toBe(false);
    const rot = item({ x: 0, y: 0, w: 100, h: 20, r: 90 });
    // 90도 돌리면 세로로 긴 막대 → 가운데(50,10) 위아래로
    expect(hitTest(rot, 50, 50)).toBe(true);
    expect(hitTest(rot, 95, 10)).toBe(false);
    const [lx, ly] = toLocal(rot, 50, 10);
    expect([Math.round(lx), Math.round(ly)]).toEqual([50, 10]);
  });
});
