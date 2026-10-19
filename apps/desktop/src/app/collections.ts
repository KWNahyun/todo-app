/**
 * 기록장 모음 (v1 lists.py SCHEMAS) + 사용자 정의 모음.
 * 진행 방식: done(완료 체크 + 이룬 날) · stages(단계, 마지막 단계가 된 날) · log(날짜별 기록)
 * 모음별 칸은 record.f.<key> 에. v1 의 'file'(사진 경로)은 photos 칸 옆에 가져오기 버튼으로.
 */
import type { CollectionDef, RecordItem, Replica } from "@dailytodo/core";
import type { FeatureId } from "./appearance.ts";

export type FieldKind = "text" | "choice" | "rating" | "number" | "date" | "photos" | "steps";
/** 과정 기록 한 줄 (steps 칸) — 날짜와 한 일 */
export interface Step {
  id: string;
  day: string;
  text: string;
}
export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
}

export interface Schema {
  key: string;
  label: string;
  mode: "done" | "stages" | "log";
  stages?: string[];
  fields: Field[];
  subtitle?: string[];
  doneWord?: string;
  tabs?: [string, string]; // done 모드: [남은 것, 이룬 것]
  addHint?: string;
  noteLabel: string;
  empty: string;
  celebrate?: string;
  taskGroup?: string;
  toGoal?: boolean;
  mapField?: string;
  filterField?: string;
  feature?: FeatureId;
  custom?: boolean;
}

export const BUILTIN: Schema[] = [
  {
    key: "bucket", label: "버킷리스트", mode: "done", doneWord: "이룸", tabs: ["남은 것", "이룬 것"], fields: [],
    addHint: "이루고 싶은 것 (#여행 오로라 보기 처럼 #로 분류)", noteLabel: "이루고 싶은 이유 · 이룬 소감",
    empty: "언젠가 해 보고 싶은 것을 하나씩 적어 보세요. 작은 것도 좋아요.",
    celebrate: "'{title}'을(를) 이뤘어요! 축하해요", taskGroup: "버킷리스트", toGoal: true, feature: "bucket",
  },
  {
    key: "places", label: "가고 싶은 곳", mode: "done", doneWord: "다녀옴", tabs: ["가 볼 곳", "다녀온 곳"],
    fields: [{ key: "where", label: "지역 · 주소", kind: "text" }, { key: "rating", label: "다녀와 보니 (별점)", kind: "rating" }, { key: "photos", label: "사진", kind: "photos" }],
    subtitle: ["where"], mapField: "where", addHint: "가고 싶은 곳 (#카페 #제주 처럼 #로 분류)", noteLabel: "가고 싶은 이유 · 다녀온 후기",
    empty: "가 보고 싶은 곳을 모아 두세요. 카페, 여행지, 전시, 맛집 무엇이든.", celebrate: "'{title}'에 다녀왔어요!", taskGroup: "가고 싶은 곳", feature: "places",
  },
  {
    key: "reviews", label: "콘텐츠 리뷰", mode: "stages", stages: ["보고 싶음", "보는 중", "다 봄"],
    fields: [{ key: "kind", label: "종류", kind: "choice", options: ["책", "영화", "드라마", "기타"] }, { key: "rating", label: "별점", kind: "rating" }, { key: "oneline", label: "한줄평", kind: "text" }],
    subtitle: ["kind", "rating", "oneline"], filterField: "kind", addHint: "책 · 영화 · 드라마 제목 (#추천 처럼 #로 분류)", noteLabel: "감상 · 인상 깊은 장면이나 구절",
    empty: "보고 싶은 것, 본 것을 남겨 보세요. 한줄평과 별점만 적어도 좋아요.", taskGroup: "콘텐츠", feature: "reviews",
  },
  {
    key: "hobby", label: "취미 기록", mode: "log", fields: [{ key: "steps", label: "과정", kind: "steps" }, { key: "photos", label: "사진", kind: "photos" }],
    addHint: "오늘의 취미 기록 제목 (#그림 #기타 처럼 #로 분류)", noteLabel: "무엇을 했는지 · 느낀 점",
    empty: "취미 활동을 날짜별로 남겨 보세요. 그림, 악기, 운동, 요리 무엇이든.", feature: "hobby",
  },
];

export function customSchema(c: CollectionDef): Schema {
  return {
    key: c.id, label: c.label, mode: c.mode, stages: c.mode === "stages" ? (c.stages?.length ? c.stages : ["시작 전", "하는 중", "끝"]) : undefined,
    fields: c.fields ?? [], doneWord: "완료", tabs: ["남은 것", "끝낸 것"], subtitle: (c.fields ?? []).filter((f) => f.kind !== "photos" && f.kind !== "steps").slice(0, 2).map((f) => f.key),
    filterField: (c.fields ?? []).find((f) => f.kind === "choice")?.key, addHint: "제목 (#태그 로 분류)", noteLabel: "메모",
    empty: "첫 항목을 적어 보세요.", custom: true,
  };
}

export function allSchemas(rep: Replica): Schema[] {
  const customs = rep.list("collection").sort((a, b) => ((a.order ?? a.createdAt) < (b.order ?? b.createdAt) ? -1 : 1));
  return [...BUILTIN, ...customs.map(customSchema)];
}

export function lastStage(s: Schema): number {
  return (s.stages?.length ?? 1) - 1;
}

export function isDone(s: Schema, r: RecordItem): boolean {
  if (s.mode === "done") return !!r.done;
  if (s.mode === "stages") return (r.stage ?? 0) >= lastStage(s);
  return false;
}

export interface ListFilter {
  status?: "all" | "todo" | "done" | number; // number = 단계
  tag?: string | null;
  choice?: string | null;
  q?: string;
}

export function items(rep: Replica, s: Schema, f: ListFilter = {}): RecordItem[] {
  const q = (f.q ?? "").trim().toLowerCase();
  return rep
    .list("record", (r) => r.collection === s.key)
    .filter((r) => {
      if (f.status === "todo" && isDone(s, r)) return false;
      if (f.status === "done" && !isDone(s, r)) return false;
      if (typeof f.status === "number" && (r.stage ?? 0) !== f.status) return false;
      if (f.tag && !(r.tags ?? []).includes(f.tag)) return false;
      if (f.choice && s.filterField && String(r.f?.[s.filterField] ?? "") !== f.choice) return false;
      if (q) {
        const text = [r.title, r.note ?? "", ...(r.tags ?? []), ...s.fields.map((x) => String(r.f?.[x.key] ?? ""))].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (s.mode === "log") return (a.day ?? "") < (b.day ?? "") ? 1 : (a.day ?? "") > (b.day ?? "") ? -1 : a.createdAt < b.createdAt ? 1 : -1;
      // 남은 것 먼저, 그다음 최근에 만든 것
      const d = Number(isDone(s, a)) - Number(isDone(s, b));
      return d || (a.createdAt < b.createdAt ? 1 : -1);
    });
}

export function tagsOf(rep: Replica, s: Schema): string[] {
  const n = new Map<string, number>();
  for (const r of rep.list("record", (x) => x.collection === s.key)) for (const t of r.tags ?? []) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** '#여행 오로라 보기 #겨울' → 제목 '오로라 보기', 태그 ['여행', '겨울'] (v1 split_tags) */
export function splitTags(text: string): { title: string; tags: string[] } {
  const tags = [...new Set([...text.matchAll(/#(\S+)/g)].map((m) => m[1]!))];
  return { title: text.replace(/\s*#\S+/g, "").trim(), tags };
}

export function subtitle(s: Schema, r: RecordItem): string {
  return (s.subtitle ?? [])
    .map((k) => {
      const f = s.fields.find((x) => x.key === k);
      const v = r.f?.[k];
      if (v == null || v === "") return "";
      return f?.kind === "rating" ? "★".repeat(Number(v)) : String(v);
    })
    .filter(Boolean)
    .join(" · ");
}

/** 칸 키: 이름에서 (사용자 정의) — 영문 · 숫자만 쓸 수 있어서 순번으로 */
export function fieldKey(i: number): string {
  return `c${i}`;
}
