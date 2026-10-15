/**
 * 모든 기기의 변경을 합친 현재 상태.
 *
 * 합치는 규칙 (어떤 순서로 몇 번 받아도 결과가 같음 — 교환 · 멱등):
 * - 같은 항목의 같은 칸은 시각(HLC)이 큰 값이 이김. 칸마다 따로 → PC 의 제목 수정과 휴대폰의 완료 체크가 둘 다 남음.
 * - del 은, 그보다 늦은 set 이 없으면 지운 것. (지움 표시만 하고 실제로는 남겨 둠 → 옛 값이 되살아나지 않음)
 * - KEEP_HEADS 칸(일기 글 등)은 "아무도 이어서 고치지 않은 값"(heads)을 모두 기억 →
 *   두 기기에서 동시에 고쳐 한쪽이 묻히면, 묻힌 글을 conflicts() 로 보여 줌. 자동으로 버리지 않음.
 */
import { type Hlc, maxHlc, parseHlc } from "./hlc.ts";
import type { Json, Op } from "./ops.ts";

/** 덮이면 안 되는 칸: 길게 쓰는 글 */
export const KEEP_HEADS: Record<string, readonly string[]> = {
  journal: ["text"],
  moment: ["text"],
  record: ["note"],
};

interface Head {
  v: Json;
  t: Hlc;
}

interface FieldState {
  v: Json;
  t: Hlc;
  heads?: Head[];
  refs?: Set<Hlc>;
}

interface EntityState {
  id: string;
  type: string;
  typeT: Hlc;
  created: Hlc;
  maxSet: Hlc;
  del: Hlc | null;
  f: Map<string, FieldState>;
}

export interface Conflict {
  field: string;
  /** 묻힌 값 */
  value: Json;
  t: Hlc;
  device: string;
}

/** 저장 · 비교용 모양 (스냅샷) */
export interface EntityDump {
  id: string;
  type: string;
  typeT: Hlc;
  created: Hlc;
  maxSet: Hlc;
  del: Hlc | null;
  f: Record<string, { v: Json; t: Hlc; heads?: Head[]; refs?: Hlc[] }>;
}

const same = (a: Json, b: Json) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** "f.rating" 같은 점 칸을 하위 객체로 펼침 */
export function expand(flat: Record<string, Json>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) {
    const path = k.split(".");
    let o = out;
    for (const p of path.slice(0, -1)) {
      if (typeof o[p] !== "object" || o[p] === null) o[p] = {};
      o = o[p] as Record<string, unknown>;
    }
    o[path[path.length - 1]!] = v;
  }
  return out;
}

export class State {
  private ents = new Map<string, EntityState>();
  private byType = new Map<string, Set<string>>();

  /** 변경 하나를 반영. 이미 반영한 변경이면 아무 일도 없음. */
  apply(op: Op): void {
    let e = this.ents.get(op.id);
    if (op.op === "del") {
      if (!e) {
        // set 보다 del 이 먼저 도착할 수도 있음 — 종류 · 만든 시각은 나중 set 이 채움
        e = { id: op.id, type: "", typeT: "", created: "", maxSet: "", del: op.t, f: new Map() };
        this.ents.set(op.id, e);
      } else {
        e.del = e.del ? maxHlc(e.del, op.t) : op.t;
      }
      return;
    }
    if (!e) {
      e = { id: op.id, type: op.type, typeT: op.t, created: op.t, maxSet: op.t, del: null, f: new Map() };
      this.ents.set(op.id, e);
      this.index(e);
    } else {
      if (op.t > e.typeT) {
        if (e.type !== op.type) {
          this.unindex(e);
          e.type = op.type;
          this.index(e);
        }
        e.typeT = op.t;
      }
      if (!e.created || op.t < e.created) e.created = op.t;
      e.maxSet = maxHlc(e.maxSet, op.t);
    }
    const keep = KEEP_HEADS[op.type] ?? [];
    for (const [k, v] of Object.entries(op.f)) {
      let fs = e.f.get(k);
      if (!fs) {
        fs = { v, t: op.t };
        e.f.set(k, fs);
      } else if (op.t > fs.t) {
        fs.v = v;
        fs.t = op.t;
      }
      if (keep.includes(k)) this.trackHead(fs, v, op.t, op.b?.[k] ?? []);
    }
  }

  private trackHead(fs: FieldState, v: Json, t: Hlc, base: Hlc[]): void {
    const refs = (fs.refs ??= new Set());
    for (const b of base) refs.add(b);
    const heads = (fs.heads ?? []).filter((h) => !refs.has(h.t));
    if (!refs.has(t) && !heads.some((h) => h.t === t)) heads.push({ v, t });
    heads.sort((a, b) => (a.t < b.t ? -1 : 1));
    fs.heads = heads;
  }

  private index(e: EntityState): void {
    let s = this.byType.get(e.type);
    if (!s) this.byType.set(e.type, (s = new Set()));
    s.add(e.id);
  }

  private unindex(e: EntityState): void {
    this.byType.get(e.type)?.delete(e.id);
  }

  private alive(e: EntityState | undefined): e is EntityState {
    return !!e && e.type !== "" && !(e.del !== null && e.del > e.maxSet);
  }

  has(id: string): boolean {
    return this.alive(this.ents.get(id));
  }

  typeOf(id: string): string | null {
    const e = this.ents.get(id);
    return e && e.type ? e.type : null;
  }

  /** 지금 값 (지운 항목이면 undefined) */
  get(id: string): Record<string, unknown> | undefined {
    const e = this.ents.get(id);
    if (!this.alive(e)) return undefined;
    const flat: Record<string, Json> = {};
    for (const [k, fs] of e.f) flat[k] = fs.v;
    return { ...expand(flat), id: e.id, type: e.type, createdAt: e.created, updatedAt: e.maxSet };
  }

  list(type: string): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    for (const id of this.byType.get(type) ?? []) {
      const x = this.get(id);
      if (x) out.push(x);
    }
    return out;
  }

  /** 칸의 지금 값 시각 (고칠 때 "보고 있던 값"으로 op.b 에 넣음) */
  fieldTime(id: string, field: string): Hlc | null {
    return this.ents.get(id)?.f.get(field)?.t ?? null;
  }

  /** 아무도 이어서 고치지 않은 값들의 시각 (충돌 해결 때 모두 '봤음'으로 표시) */
  headTimes(id: string, field: string): Hlc[] {
    const fs = this.ents.get(id)?.f.get(field);
    if (!fs) return [];
    return fs.heads ? fs.heads.map((h) => h.t) : [fs.t];
  }

  /** 동시에 고쳐서 묻힌 값들 */
  conflicts(id: string): Conflict[] {
    const e = this.ents.get(id);
    if (!this.alive(e)) return [];
    const out: Conflict[] = [];
    for (const [k, fs] of e.f) {
      for (const h of fs.heads ?? []) {
        if (h.t !== fs.t && !same(h.v, fs.v)) out.push({ field: k, value: h.v, t: h.t, device: parseHlc(h.t).node });
      }
    }
    return out;
  }

  /** 반영한 모든 변경 중 가장 늦은 시각 */
  latest(): Hlc | null {
    let m: Hlc | null = null;
    for (const e of this.ents.values()) {
      for (const t of [e.maxSet, e.del ?? ""]) if (t && (!m || t > m)) m = t;
    }
    return m;
  }

  size(): number {
    let n = 0;
    for (const e of this.ents.values()) if (this.alive(e)) n++;
    return n;
  }

  /** 정렬된 모양 — 두 기기의 상태가 같은지 비교하거나 스냅샷으로 저장 */
  dump(): EntityDump[] {
    return [...this.ents.values()]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((e) => ({
        id: e.id,
        type: e.type,
        typeT: e.typeT,
        created: e.created,
        maxSet: e.maxSet,
        del: e.del,
        f: Object.fromEntries(
          [...e.f.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, fs]) => [
              k,
              {
                v: fs.v,
                t: fs.t,
                ...(fs.heads ? { heads: fs.heads } : {}),
                ...(fs.refs ? { refs: [...fs.refs].sort() } : {}),
              },
            ]),
        ),
      }));
  }

  static load(dump: EntityDump[]): State {
    const s = new State();
    for (const d of dump) {
      const e: EntityState = {
        id: d.id,
        type: d.type,
        typeT: d.typeT,
        created: d.created,
        maxSet: d.maxSet,
        del: d.del,
        f: new Map(
          Object.entries(d.f).map(([k, x]) => [
            k,
            { v: x.v, t: x.t, ...(x.heads ? { heads: x.heads } : {}), ...(x.refs ? { refs: new Set(x.refs) } : {}) },
          ]),
        ),
      };
      s.ents.set(e.id, e);
      if (e.type) s.index(e);
    }
    return s;
  }

  /**
   * 다른 상태(스냅샷)를 합침 — 그 상태를 만든 변경들을 다시 반영한 것과 같은 결과.
   * 칸마다 { 값, 시각 } 을 set 으로, 지움을 del 로 되살려 apply 함.
   */
  merge(dump: EntityDump[]): void {
    for (const d of dump) {
      if (d.type) {
        // 종류 · 만든 시각 · 마지막 시각을 살리기 위해 빈 set 두 개 (만든 시각, 종류 시각)
        this.apply({ op: "set", id: d.id, type: d.type, f: {}, t: d.created });
        this.apply({ op: "set", id: d.id, type: d.type, f: {}, t: d.typeT });
        this.apply({ op: "set", id: d.id, type: d.type, f: {}, t: d.maxSet });
        for (const [k, x] of Object.entries(d.f)) {
          this.applyField(d.id, k, x.v, x.t);
          if (x.heads || x.refs) this.mergeHeads(d.id, k, x.heads ?? [], x.refs ?? []);
        }
      }
      if (d.del) this.apply({ op: "del", id: d.id, t: d.del });
    }
  }

  private applyField(id: string, k: string, v: Json, t: Hlc): void {
    const e = this.ents.get(id)!;
    const fs = e.f.get(k);
    if (!fs) e.f.set(k, { v, t });
    else if (t > fs.t) {
      fs.v = v;
      fs.t = t;
    }
  }

  private mergeHeads(id: string, k: string, heads: Head[], refs: Hlc[]): void {
    const fs = this.ents.get(id)!.f.get(k)!;
    const r = (fs.refs ??= new Set());
    for (const x of refs) r.add(x);
    const all = [...(fs.heads ?? []), ...heads].filter((h) => !r.has(h.t));
    const uniq = new Map(all.map((h) => [h.t, h]));
    fs.heads = [...uniq.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
  }
}
