/**
 * 같이 쓰는 설정 (모양 · 기능 켜고 끄기) — 동기화되는 setting 항목 하나 ("settings").
 * 설계 6.2 테마 다섯 가지 + 글꼴 · 글자 크기 · 간격.
 */
import type { Replica, Setting } from "@dailytodo/core";

export const SETTINGS_ID = "settings";

export const THEMES = [
  { id: "minimal", label: "미니멀", swatch: "#ffffff" },
  { id: "wood", label: "숲 우드", swatch: "#f3e9d6" },
  { id: "dark", label: "다크 숲", swatch: "#15231b" },
  { id: "pastel", label: "파스텔", swatch: "#fbeff2" },
  { id: "contrast", label: "고대비", swatch: "#000000" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export const FONTS = [
  { id: "sans", label: "고딕 (Pretendard)" },
  { id: "serif", label: "명조 (고운바탕)" },
  { id: "hand", label: "손글씨 (개구)" },
] as const;

export const SIZES = [
  { id: 13, label: "작게" },
  { id: 14, label: "보통" },
  { id: 15.5, label: "크게" },
  { id: 17, label: "아주 크게" },
] as const;

export const DENSITIES = [
  { id: "compact", label: "촘촘" },
  { id: "normal", label: "보통" },
  { id: "roomy", label: "여유" },
] as const;

/** 기능 켜고 끄기 (v1 FEATURES 중 v2 에 있는 것). 꺼 둔 기능은 메뉴 · 화면에서 사라짐 (설계 원칙 3) */
export const FEATURES = [
  { id: "events", label: "일정 · 일정표", hint: "'13:30 회의' 입력, 오늘 일정, 일정 알림" },
  { id: "deadlines", label: "마감 (디데이)", hint: "디데이 칩, 묶음 옆 D-배지" },
  { id: "habits", label: "습관 트래커", hint: "위젯 습관 칩, 연속 일수" },
  { id: "mood", label: "기분 기록", hint: "표정 다섯 단계" },
  { id: "review", label: "오늘 정리하기", hint: "저녁 회고와 정리 알림" },
  { id: "stats", label: "통계", hint: "날짜별 시간 그래프" },
  { id: "goals", label: "큰 목표", hint: "누적 시간 목표" },
  { id: "mandala", label: "만다라트", hint: "9×9 목표 계획표" },
  { id: "date", label: "데이트 일기", hint: "기록장의 데이트 일기" },
] as const;
export type FeatureId = (typeof FEATURES)[number]["id"];

export function sharedSettings(rep: Replica): Partial<Setting> {
  return rep.get<"setting">(SETTINGS_ID) ?? {};
}

export function featureOn(rep: Replica, f: FeatureId): boolean {
  return sharedSettings(rep).features?.[f] !== false;
}

/** 화면에 적용: 테마 · 글꼴 · 크기 · 간격 → <html> 속성 */
export function applyAppearance(s: { theme?: string; font?: string; fontSize?: number; density?: string }): void {
  const el = document.documentElement;
  el.dataset.theme = s.theme ?? "minimal";
  el.dataset.font = s.font ?? "sans";
  el.dataset.density = s.density ?? "normal";
  // 화면 전체를 같은 비율로 (px 로 맞춘 간격까지 함께 커지게)
  (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String((s.fontSize ?? 14) / 14);
}
