/**
 * 항목 종류별 칸 (docs/v2/01-데이터-동기화-설계.md 5장).
 * 저장 · 합치기는 종류를 몰라도 되고(칸 단위), 여기 타입은 앱 코드가 읽을 때 쓰는 모양.
 * 점(.)이 든 칸 이름은 읽을 때 하위 객체로 펼쳐짐: "f.rating" → { f: { rating } }.
 */

import type { Photo } from "./blobs.ts";

export type Day = string; // "YYYY-MM-DD" (그 기기 현지 날짜)

export interface Base {
  id: string;
  type: string;
  /** 처음 만든 시각 (HLC) */
  createdAt: string;
  /** 마지막으로 바뀐 시각 (HLC) */
  updatedAt: string;
}

export interface Task extends Base {
  type: "task";
  day: Day;
  title: string;
  done?: boolean;
  doneAt?: number | null;
  parentId?: string | null;
  order?: string;
  note?: string;
  estimateMin?: number | null;
  collapsed?: boolean;
  /** 다른 곳과의 연결. 만다라트 실천 칸 = "mandala/<세부>/<실천>" */
  ref?: string | null;
  /** v1 에서 가져온 뽀모도로 횟수 */
  pomos?: number;
}

export type SessionKind = "normal" | "pomodoro" | "imported";

export interface Session extends Base {
  type: "session";
  taskId: string;
  /** 시작 · 끝 (epoch ms). 끝이 없으면 재는 중 */
  start: number;
  end?: number | null;
  deviceId: string;
  kind: SessionKind;
}

export interface Event extends Base {
  type: "event";
  day: Day;
  /** "HH:MM", 없으면 시간 미정 */
  time?: string | null;
  title: string;
  remindMin?: number | null;
}

export interface Deadline extends Base {
  type: "deadline";
  date: Day;
  title: string;
  groupTitle?: string | null;
}

export interface Goal extends Base {
  type: "goal";
  title: string;
  targetHours?: number | null;
  linkedTitles?: string[];
  createdDay?: Day;
}

export interface Habit extends Base {
  type: "habit";
  name: string;
  order?: string;
}

/** 습관 체크 하나 = 항목 하나 (지우면 체크 해제) */
export interface HabitCheck extends Base {
  type: "habitCheck";
  habitId: string;
  day: Day;
}

export interface Mood extends Base {
  type: "mood";
  day: Day;
  level: number; // 1~5
}

export interface Journal extends Base {
  type: "journal";
  day: Day;
  text: string;
}

/** 타임라인 일기 한 줄 (v2 새로) */
export interface Moment extends Base {
  type: "moment";
  at: number;
  text: string;
  tags?: string[];
  /** 붙인 사진 (blobs.ts 의 Photo) */
  photos?: Photo[];
  mood?: number | null;
}

/** 기록장 모음 항목. collection = date · bucket · places · reviews · hobby · 사용자 정의 */
export interface RecordItem extends Base {
  type: "record";
  collection: string;
  title: string;
  tags?: string[];
  note?: string;
  createdDay?: Day;
  /** 진행 방식별 칸 */
  done?: boolean;
  doneOn?: Day | null;
  stage?: number;
  day?: Day;
  /** 모음마다 다른 칸 (where · rating · cost · kind · oneline · photos · v1 의 file …) */
  f?: { photos?: Photo[]; [k: string]: unknown };
}

export interface Mandala extends Base {
  type: "mandala";
  center?: string;
  /** 칸 단위로 저장되므로 읽으면 {"0": …, "1": …} 모양 → mandalaGrid() 로 배열로 */
  subs?: Record<string, string>;
  actions?: Record<string, Record<string, string>>;
  done?: Record<string, Record<string, boolean>>;
}

/**
 * 모든 기기가 같이 쓰는 설정 (설계 5.2): 테마 · 글꼴 · 켜 둔 기능 등. 하나만 씀 (id "settings").
 * 창 위치 · 단축키 · 보관함 경로처럼 기기마다 다른 것은 기기 안 설정에.
 */
export interface Setting extends Base {
  type: "setting";
  theme?: string;
  font?: string;
  fontSize?: number;
  density?: string;
  /** 기능 켜고 끄기: 없으면 켜짐 */
  features?: Record<string, boolean>;
}

/** 사용자 정의 기록장 모음 (설계 14장 질문의 답: 칸 종류 = 짧은 글 · 선택지 · 별점 · 숫자 · 날짜 · 사진) */
export interface CollectionDef extends Base {
  type: "collection";
  label: string;
  /** done: 완료 체크 · stages: 단계 · log: 날짜별 기록 */
  mode: "done" | "stages" | "log";
  stages?: string[];
  fields?: { key: string; label: string; kind: "text" | "choice" | "rating" | "number" | "date" | "photos"; options?: string[] }[];
  order?: string;
}

/** 종이 다이어리 한 장 (그날, id "page-YYYY-MM-DD") */
export interface Page extends Base {
  type: "page";
  day: Day;
  paper?: "plain" | "lined" | "grid" | "dot";
}

/**
 * 종이 다이어리 위의 것 하나 — 하나 = 항목 하나라 두 기기에서 같은 장을 꾸며도 합쳐짐.
 * 좌표는 종이 기준(가로 600). x · y 로 옮기고 s(배율) · r(도) 로 키우고 돌림.
 */
export interface PageItem extends Base {
  type: "pageItem";
  day: Day;
  kind: "stroke" | "sticker" | "photo" | "text";
  x: number;
  y: number;
  s?: number;
  r?: number;
  z?: number;
  /** stroke: "x,y,p;x,y,p…" (0.1 단위 정수, p 0~100 필압) */
  pts?: string;
  color?: string;
  width?: number;
  /** stroke: 형광펜 (반투명) */
  marker?: boolean;
  /** sticker 이름 */
  sticker?: string;
  photo?: Photo;
  /** 기본 크기 (배율 1 일 때) */
  w?: number;
  h?: number;
  text?: string;
  font?: "hand" | "serif" | "sans";
  size?: number;
}

export type Entity =
  | Task | Session | Event | Deadline | Goal | Habit | HabitCheck | Mood | Journal | Moment | RecordItem | Mandala | Setting
  | CollectionDef | Page | PageItem;

export type TypeName = Entity["type"];
export type EntityOf<T extends TypeName> = Extract<Entity, { type: T }>;
/** 만들거나 고칠 때 넘기는 칸 (id · 시각은 라이브러리가 붙임) */
export type FieldsOf<T extends TypeName> = Partial<Omit<EntityOf<T>, keyof Base>>;

/** 만다라트 칸 단위 저장 → 화면용 배열 */
export function mandalaGrid(m: Mandala): { center: string; subs: string[]; actions: string[][]; done: boolean[][] } {
  const r = [...Array(8).keys()];
  return {
    center: m.center ?? "",
    subs: r.map((s) => m.subs?.[s] ?? ""),
    actions: r.map((s) => r.map((a) => m.actions?.[s]?.[a] ?? "")),
    done: r.map((s) => r.map((a) => m.done?.[s]?.[a] ?? false)),
  };
}
