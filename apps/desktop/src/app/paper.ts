/**
 * 종이 다이어리 (로드맵 "종이 다이어리 꾸미기"): 손글씨(필압) · 스티커 · 사진 · 글 — 화면과 무관한 계산.
 * 종이 좌표: 가로 PAPER_W, 세로 PAPER_H (A 판형 비율). 항목 좌표는 자기 왼쪽 위 기준 + x · y 이동 · s 배율 · r 회전.
 */
import type { PageItem } from "@dailytodo/core";

export const PAPER_W = 600;
export const PAPER_H = 848;

export type Pt = [number, number, number]; // x, y, 필압 0~1

/** "x,y,p;…" — 0.1 단위 정수 · 필압 0~100 (가볍게 저장) */
export function encodePts(pts: Pt[]): string {
  return pts.map(([x, y, p]) => `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(p * 100)}`).join(";");
}

export function decodePts(s: string | undefined): Pt[] {
  if (!s) return [];
  return s.split(";").map((t) => {
    const [x, y, p] = t.split(",").map(Number) as [number, number, number];
    return [x / 10, y / 10, (p ?? 50) / 100];
  });
}

/** 너무 촘촘한 점은 솎아냄 (거리 0.8 미만) */
export function thin(pts: Pt[], min = 0.8): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p);
  }
  if (pts.length && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]!);
  return out;
}

/** 획의 바깥선: 점마다 굵기(필압)만큼 양옆으로 → 채운 다각형 (펜처럼 굵기가 변하는 선) */
export function strokePath(pts: Pt[], width: number, pressure = true): string {
  if (!pts.length) return "";
  const r = (p: number) => (width / 2) * (pressure ? 0.35 + p * 1.3 : 1);
  if (pts.length === 1) {
    const [x, y, p] = pts[0]!;
    const k = r(p);
    return `M${x - k},${y} a${k},${k} 0 1,0 ${k * 2},0 a${k},${k} 0 1,0 ${-k * 2},0`;
  }
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const k = r(pts[i]![2]);
    const [x, y] = pts[i]!;
    left.push(`${(x - dy * k).toFixed(1)},${(y + dx * k).toFixed(1)}`);
    right.push(`${(x + dy * k).toFixed(1)},${(y - dx * k).toFixed(1)}`);
  }
  const end = pts[pts.length - 1]!;
  const ke = r(end[2]);
  const start = pts[0]!;
  const ks = r(start[2]);
  // 양 끝은 둥글게
  return `M${left[0]} L${left.slice(1).join(" L")} A${ke.toFixed(1)},${ke.toFixed(1)} 0 0,0 ${right[right.length - 1]} L${right.slice(0, -1).reverse().join(" L")} A${ks.toFixed(1)},${ks.toFixed(1)} 0 0,0 ${left[0]} Z`;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 배율 1 · 회전 0 일 때 항목의 크기 (자기 좌표) */
export function baseSize(it: PageItem): { w: number; h: number } {
  if (it.kind === "stroke") {
    const pts = decodePts(it.pts);
    const pad = (it.width ?? 3) * 1.2;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { w: Math.max(...xs, 0) + pad, h: Math.max(...ys, 0) + pad };
  }
  return { w: it.w ?? 100, h: it.h ?? 100 };
}

/** 회전 전 배치 상자 (종이 좌표) */
export function itemBox(it: PageItem): Box {
  const { w, h } = baseSize(it);
  const s = it.s ?? 1;
  return { x: it.x, y: it.y, w: w * s, h: h * s };
}

/** SVG transform: 이동 → 가운데 기준 회전 → 배율 */
export function transformOf(it: PageItem): string {
  const b = itemBox(it);
  const r = it.r ?? 0;
  return `translate(${it.x} ${it.y})${r ? ` rotate(${r} ${b.w / 2} ${b.h / 2})` : ""} scale(${it.s ?? 1})`;
}

/** 종이 좌표 점 → 항목 자기 좌표 (회전 · 배율 되돌림) */
export function toLocal(it: PageItem, px: number, py: number): [number, number] {
  const b = itemBox(it);
  const cx = it.x + b.w / 2;
  const cy = it.y + b.h / 2;
  const a = (-(it.r ?? 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a) + b.w / 2;
  const ry = dx * Math.sin(a) + dy * Math.cos(a) + b.h / 2;
  const s = it.s ?? 1;
  return [rx / s, ry / s];
}

/** 이 점(종이 좌표)이 항목 위인지 — 획은 선 근처(r)만, 나머지는 상자 안 */
export function hitTest(it: PageItem, px: number, py: number, r = 6): boolean {
  const [lx, ly] = toLocal(it, px, py);
  if (it.kind === "stroke") {
    const pts = decodePts(it.pts);
    const tol = r / (it.s ?? 1) + (it.width ?? 3) / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[Math.min(i + 1, pts.length - 1)]!;
      if (segDist(lx, ly, a[0], a[1], b[0], b[1]) <= tol) return true;
    }
    return false;
  }
  const { w, h } = baseSize(it);
  return lx >= 0 && ly >= 0 && lx <= w && ly <= h;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 그린 점들(종이 좌표) → 자기 좌표로 옮긴 획 항목 칸 (왼쪽 위 = 0,0) */
export function strokeFields(pts: Pt[], color: string, width: number, marker: boolean): Partial<PageItem> {
  const pad = width * 0.6;
  const minX = Math.min(...pts.map((p) => p[0])) - pad;
  const minY = Math.min(...pts.map((p) => p[1])) - pad;
  const local = thin(pts).map(([x, y, p]) => [x - minX, y - minY, p] as Pt);
  return { kind: "stroke", x: minX, y: minY, pts: encodePts(local), color, width, marker };
}

export const PEN_COLORS = ["#1d1d1b", "#2f6a4c", "#c2412d", "#2a5db0", "#b5547a", "#e9a23b"];
export const MARKER_COLORS = ["#ffe066", "#a8e6a1", "#ffb3c7", "#a7d8ff"];
