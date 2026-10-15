/**
 * 변경 기록(op log). 한 줄 = JSON 하나 (NDJSON). 기기는 자기 파일에만 덧붙임.
 *
 *   {"op":"set","id":"0192…","type":"task","f":{"title":"KAMP 제출","done":true},"t":"1729000000123:0004:pc-1"}
 *   {"op":"del","id":"0192…","t":"1729000000456:0000:phone-1"}
 *
 * set 의 "b"(선택) = 칸별로 "이 값을 고칠 때 보고 있던 값들의 시각". 일기처럼 덮이면 안 되는 칸에서
 * 동시에 고친 내용을 찾아내는 데 씀 (state.ts 의 KEEP_HEADS).
 */
import { isHlc, parseHlc, type Hlc } from "./hlc.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type Fields = Record<string, Json>;

export interface SetOp {
  op: "set";
  id: string;
  type: string;
  f: Fields;
  t: Hlc;
  b?: Record<string, Hlc[]>;
}

export interface DelOp {
  op: "del";
  id: string;
  t: Hlc;
}

export type Op = SetOp | DelOp;

/** 칸 이름: 영문으로 시작, 점(.)으로 하위 칸 (예: "f.rating", "actions.3.5"). id · type 은 예약. */
const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const RESERVED = new Set(["id", "type", "createdAt", "updatedAt"]);
const TYPE_RE = /^[a-z][A-Za-z0-9]*$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isFieldName(k: string): boolean {
  return FIELD_RE.test(k) && !RESERVED.has(k) && !k.split(".").includes("__proto__");
}

export function isTypeName(t: string): boolean {
  return TYPE_RE.test(t);
}

export function isId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** 다른 기기 파일에서 읽은 줄이 올바른 변경인지. 이상한 줄은 버림 (앱이 멈추지 않게). */
export function validateOp(x: unknown): x is Op {
  if (!isObj(x) || !isId(x.id) || !isHlc(x.t)) return false;
  if (x.op === "del") return true;
  if (x.op !== "set" || typeof x.type !== "string" || !isTypeName(x.type) || !isObj(x.f)) return false;
  if (!Object.keys(x.f).every(isFieldName)) return false;
  if (x.b !== undefined) {
    if (!isObj(x.b)) return false;
    for (const [k, v] of Object.entries(x.b)) {
      if (!(k in x.f) || !Array.isArray(v) || !v.every(isHlc)) return false;
    }
  }
  return true;
}

export function encodeOps(ops: Op[]): string {
  return ops.map((o) => JSON.stringify(o) + "\n").join("");
}

export interface ParsedLog {
  ops: Op[];
  /** 끝까지 온전한(줄바꿈으로 끝난) 줄 수 = 다음에 이어 읽을 위치 */
  lines: number;
  /** 읽었지만 깨진 줄 수 */
  bad: number;
}

/**
 * 기록 파일 내용에서 from 번째 줄부터 읽음. 마지막 줄이 줄바꿈 없이 끝나면 (드라이브가 아직 받는 중)
 * 그 줄은 다음 번에 다시 읽음.
 */
export function parseLog(text: string, from = 0): ParsedLog {
  const parts = text.split("\n");
  const complete = parts.length - 1;
  const ops: Op[] = [];
  let bad = 0;
  for (let i = from; i < complete; i++) {
    const line = parts[i]!.trim();
    if (!line) continue;
    try {
      const x: unknown = JSON.parse(line);
      if (validateOp(x)) ops.push(x);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { ops, lines: Math.max(complete, from), bad };
}

/** 변경이 들어갈 파일: log/<기기>/YYYY-MM.ndjson (달은 UTC 기준 — 어느 기기든 같은 파일 이름). */
export function logPath(device: string, t: Hlc): string {
  const d = new Date(parseHlc(t).ms);
  return `log/${device}/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}.ndjson`;
}

export function deviceOfPath(path: string): string | null {
  const m = /^log\/([^/]+)\/\d{4}-\d{2}\.ndjson$/.exec(path);
  return m ? m[1]! : null;
}
