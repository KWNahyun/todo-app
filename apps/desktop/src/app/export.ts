/**
 * 기록 내보내기 (로드맵 "기록 내보내기"): 다이어리 · 타임라인 Markdown, 기록장 모음 CSV · Markdown, 모든 기록 JSON.
 * 사진은 파일 대신 "사진 n장"으로만 (보관함 blobs/ 에 그대로 있음).
 */
import type { Replica } from "@dailytodo/core";
import { dayOf, hhmm, longDay } from "./dates.ts";
import { MOODS, journalOf, momentsOf, moodOf } from "./records.ts";
import { items, isDone, type Schema } from "./collections.ts";

/** 다이어리: 글 · 기분 · 타임라인 (from ~ to, 쓴 날만) — v1 DiaryView.export 와 같은 모양 + 타임라인 */
export function diaryMarkdown(rep: Replica, from: string, to: string, title = "다이어리"): string {
  const days = new Set<string>();
  for (const j of rep.list("journal", (x) => x.day >= from && x.day <= to && !!x.text.trim())) days.add(j.day);
  for (const m of rep.list("mood", (x) => x.day >= from && x.day <= to)) days.add(m.day);
  for (const m of rep.list("moment")) {
    const d = dayOf(new Date(m.at));
    if (d >= from && d <= to) days.add(d);
  }
  const lines = [`# ${title}`, "", `${from} ~ ${to} · ${days.size}일`, ""];
  for (const day of [...days].sort()) {
    const mood = moodOf(rep, day)?.level;
    lines.push(`## ${longDay(day)}${mood ? ` · 기분: ${MOODS[mood - 1]!.label}` : ""}`, "");
    const text = journalOf(rep, day)?.text.trim();
    if (text) lines.push(text, "");
    const ms = momentsOf(rep, day);
    if (ms.length) {
      for (const m of ms) lines.push(`- ${hhmm(m.at)} ${m.text}${m.photos?.length ? ` (사진 ${m.photos.length}장)` : ""}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function rowValues(s: Schema, r: ReturnType<typeof items>[number]): Record<string, unknown> {
  const status =
    s.mode === "done" ? (r.done ? s.doneWord : "") : s.mode === "stages" ? s.stages![r.stage ?? 0] : "";
  const out: Record<string, unknown> = {
    제목: r.title,
    ...(s.mode === "log" ? { 날짜: r.day ?? "" } : { 상태: status, "끝낸 날": isDone(s, r) ? r.doneOn ?? "" : "" }),
  };
  for (const f of s.fields) {
    const v = r.f?.[f.key];
    out[f.label] = f.kind === "photos" ? (Array.isArray(v) && v.length ? `사진 ${v.length}장` : "") : f.kind === "rating" && v ? "★".repeat(Number(v)) : v ?? "";
  }
  out["태그"] = (r.tags ?? []).map((t) => `#${t}`).join(" ");
  out[s.noteLabel] = r.note ?? "";
  out["만든 날"] = r.createdDay ?? "";
  return out;
}

/** 모음 → CSV (엑셀에서 한글이 안 깨지게 앞에 BOM) */
export function collectionCsv(rep: Replica, s: Schema): string {
  const rows = items(rep, s).map((r) => rowValues(s, r));
  const head = rows[0] ? Object.keys(rows[0]) : ["제목"];
  return "﻿" + [head.map(csvCell).join(","), ...rows.map((r) => head.map((h) => csvCell(r[h])).join(","))].join("\r\n") + "\r\n";
}

export function collectionMarkdown(rep: Replica, s: Schema): string {
  const list = items(rep, s);
  const lines = [`# ${s.label}`, "", `${list.length}개`, ""];
  for (const r of list) {
    const v = rowValues(s, r);
    const check = s.mode === "done" ? (r.done ? "[x] " : "[ ] ") : "";
    lines.push(`## ${check}${r.title}`, "");
    for (const [k, x] of Object.entries(v)) {
      if (k === "제목" || k === s.noteLabel || x === "" || x == null) continue;
      lines.push(`- ${k}: ${String(x)}`);
    }
    if (r.note?.trim()) lines.push("", r.note.trim());
    lines.push("");
  }
  return lines.join("\n");
}

/** 모든 기록 (지금 보이는 값) — 다른 앱으로 옮기거나 따로 보관할 때 */
export function allJson(rep: Replica, now = Date.now()): string {
  const types = ["task", "session", "event", "deadline", "goal", "habit", "habitCheck", "mood", "journal", "moment", "record", "collection", "mandala", "setting"] as const;
  const data: Record<string, unknown> = { app: "Daily Todo v2", exportedAt: new Date(now).toISOString() };
  for (const t of types) data[t] = rep.list(t);
  return JSON.stringify(data, null, 2);
}

export const utf8 = (s: string) => new TextEncoder().encode(s);
