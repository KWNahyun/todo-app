/**
 * 앱이 운영체제에 바라는 것. Tauri(진짜 앱)와 브라우저(화면 미리보기 · 개발용) 두 구현.
 * 동기화 로직은 @dailytodo/core 에 있고, 여기는 파일 · 창 · 창 사이 알림만.
 */
import type { V1Data, VaultFs } from "@dailytodo/core";

export type WindowKind = "main" | "widget";
/** 이 PC 에 마지막으로 쓴 테마 (같이 쓰는 설정이 우선 — app/appearance.ts) */
export type ThemeName = string;
/** 위젯 창: 보통 · 항상 위 · 바탕화면 고정 */
export type PinMode = "normal" | "top" | "desktop";
export type Screen = "today" | "schedule" | "records" | "stats" | "goals" | "settings";

/** 이 PC 의 설정 (창 둘이 같이 씀, 동기화 안 함) */
export interface Config {
  /** 이 PC 의 ID. 창마다 복제본 ID = `${deviceBase}-${창}` */
  deviceBase: string;
  deviceName: string;
  /** 보관함(클라우드 폴더) 절대 경로 */
  vaultRoot?: string;
  theme?: ThemeName;
  pin?: PinMode;
  /** 일정 알림 기본값 (분 전, 0 이면 끔) */
  remindMin?: number;
  /** 뽀모도로 (분) */
  pomo?: { on: boolean; focus?: number; brk?: number; long?: number; every?: number };
  /** 이만큼(분) 입력이 없으면 자리 비움으로 보고 돌아왔을 때 물어봄 (0 이면 끔, 기본 10) */
  idleMin?: number;
  /** 타이머가 이만큼(시간) 켜져 있으면 알림 (0 이면 끔, 기본 2) */
  longHours?: number;
  /** 이 시각 넘으면 '오늘 정리하기' 알림 (빈 값이면 끔, 기본 22:00) */
  reviewTime?: string;
  /** 위젯 바탕 불투명도 % (40~100, 기본 100) — 글자 · 할 일 칸은 그대로 또렷하게 */
  widgetAlpha?: number;
  /** 전역 단축키 (Tauri 가속기 문자열, 빈 값이면 끔) — 기본은 v1 과 같음 */
  hotkeys?: Partial<Record<HotkeyAction, string>>;
}

export type HotkeyAction = "show" | "timer" | "review";
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = { show: "Ctrl+Alt+T", timer: "Ctrl+Alt+S", review: "Ctrl+Alt+R" };
export const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  show: "위젯 불러오기 + 바로 입력",
  timer: "마지막 타이머 시작 / 정지",
  review: "오늘 정리하기",
};

export interface Platform {
  kind: "tauri" | "web";
  window: WindowKind;
  readConfig(): Promise<Config>;
  writeConfig(c: Config): Promise<void>;
  /** 이 창의 복제본 상태 (core 의 LocalState JSON) */
  readLocal(): Promise<string | null>;
  writeLocal(text: string): Promise<void>;
  defaultVaultRoot(): Promise<string>;
  vaultFs(root: string): VaultFs;
  readV1(): Promise<{ dir: string; data: V1Data } | null>;
  /** 다른 창이 보관함에 썼다 / 설정을 바꿨다 / 화면을 열어 달라 */
  on(event: PeerEvent, cb: (payload?: string) => void): () => void;
  emit(event: PeerEvent, payload?: string): void;
  /** 메인 창을 열고 그 화면으로 (select: 상세 패널에 열 항목) */
  showMain(screen?: Screen, select?: string): Promise<void>;
  setPin(mode: PinMode): Promise<void>;
  /** PC 의 그림 파일 읽기 (v1 기록장 사진 가져오기용, 웹에선 안 됨) */
  readImageFile(path: string): Promise<Uint8Array>;
  /** 마지막 입력 뒤 지난 초 (자리 비움, 웹에선 0) */
  idleSeconds(): Promise<number>;
  /** 전역 단축키를 이것들로 (이전 것은 모두 풂) → 등록 못 한 조합 (다른 프로그램이 쓰는 중 등) */
  setHotkeys(keys: Partial<Record<HotkeyAction, string>>, onPress: (a: HotkeyAction) => void): Promise<string[]>;
  /** 파일로 내보내기: 저장 창 → 고른 곳에 저장 → 저장한 경로 (취소하면 null) */
  saveExport(name: string, ext: "md" | "csv" | "json" | "png", bytes: Uint8Array): Promise<string | null>;
  /** 기본 브라우저로 주소 열기 (지도 등, https 만) */
  openUrl(url: string): Promise<void>;
  /** 위젯 창을 앞으로 */
  showWidget(): Promise<void>;
  /** OS 알림 (권한이 없으면 조용히 넘어감) */
  notify(title: string, body: string): Promise<void>;
  minimize(): Promise<void>;
  close(): Promise<void>;
}

export type PeerEvent = "vault-changed" | "config-changed" | "open-screen" | "open-review";
