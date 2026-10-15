/**
 * 한 기기의 복제본. 화면은 이것만 보고 쓰고 읽음.
 *
 *   쓰기: create · update · remove → 상태에 바로 반영(화면 즉시) + 보낼 목록(pending)에 쌓임
 *   flush(): 쌓인 변경을 log/<내 기기>/YYYY-MM.ndjson 에 덧붙임
 *   pull():  모든 기기의 기록 파일을 "어디까지 읽었나"(cursors) 이후만 읽어 합침
 *   sync():  flush + pull
 *
 * 기기 안 저장(exportLocal / local 옵션)은 P2 에서 SQLite 로 옮길 수 있게 JSON 하나로만 주고받음.
 */
import { Clock, type Hlc } from "./hlc.ts";
import { uuidv7 } from "./ids.ts";
import { deviceOfPath, encodeOps, isFieldName, logPath, parseLog, type Fields, type Json, type Op, type SetOp } from "./ops.ts";
import type { EntityOf, FieldsOf, TypeName } from "./schema.ts";
import { KEEP_HEADS, State, type Conflict, type EntityDump } from "./state.ts";
import { ensureVault, type DeviceInfo, type VaultFs, type VaultInfo } from "./vault.ts";

export interface LocalState {
  v: 1;
  deviceId: string;
  clock: Hlc | null;
  cursors: Record<string, number>;
  pending: Op[];
  entities: EntityDump[];
}

export interface Snapshot {
  v: 1;
  deviceId: string;
  at: Hlc | null;
  cursors: Record<string, number>;
  entities: EntityDump[];
}

export interface PullResult {
  /** 반영한 변경 수 (이미 있던 것 포함) */
  applied: number;
  /** 읽은 파일 수 (새 줄이 있던 파일) */
  files: number;
  /** 깨진 줄 수 */
  bad: number;
}

export interface OpenOptions {
  deviceId: string;
  name?: string;
  kind?: string;
  wall?: () => number;
  /** 이 기기에 저장해 둔 상태 (없으면 보관함의 스냅샷 + 기록에서 새로 만듦) */
  local?: LocalState;
  /** 쓰기 전용 임시 기기 (v1 가져오기): 기기 정보 파일을 안 쓰고 스냅샷도 안 읽음 */
  quiet?: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** { f: { rating: 5 } } → { "f.rating": 5 }. 배열은 값 그대로, undefined 는 건너뜀 (지우려면 null). */
function flatten(fields: Record<string, unknown>, prefix = "", out: Fields = {}): Fields {
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const key = prefix + k;
    if (isPlainObject(v)) flatten(v, key + ".", out);
    else {
      if (!isFieldName(key)) throw new Error(`칸 이름이 잘못됨: ${key}`);
      out[key] = v as Json;
    }
  }
  return out;
}

export class Replica {
  readonly deviceId: string;
  readonly fs: VaultFs;
  vault!: VaultInfo;
  private clock: Clock;
  private state: State;
  private pending: Op[] = [];
  private cursors: Record<string, number> = {};
  private tailChecked = new Set<string>();
  private wall: () => number;
  private listeners = new Set<() => void>();

  private constructor(fs: VaultFs, deviceId: string, wall: () => number, clockLast: Hlc | null, state: State) {
    this.fs = fs;
    this.deviceId = deviceId;
    this.wall = wall;
    this.clock = new Clock(deviceId, { wall, last: clockLast });
    this.state = state;
  }

  static async open(fs: VaultFs, opts: OpenOptions): Promise<Replica> {
    const wall = opts.wall ?? Date.now;
    const vault = await ensureVault(fs, wall());
    let rep: Replica;
    if (opts.local) {
      const l = opts.local;
      if (l.deviceId !== opts.deviceId) throw new Error("저장된 상태의 기기ID 가 다름");
      rep = new Replica(fs, opts.deviceId, wall, l.clock, State.load(l.entities));
      rep.cursors = { ...l.cursors };
      rep.pending = [...l.pending];
    } else {
      rep = new Replica(fs, opts.deviceId, wall, null, new State());
      if (!opts.quiet) await rep.loadBestSnapshot();
    }
    rep.vault = vault;
    if (!opts.quiet) {
      const info: DeviceInfo = { id: opts.deviceId, name: opts.name ?? opts.deviceId, kind: opts.kind ?? "pc", lastSeen: wall() };
      await fs.write(`devices/${opts.deviceId}.json`, JSON.stringify(info, null, 2) + "\n");
    }
    return rep;
  }

  // ---------- 쓰기 ----------

  /** 새 항목. id 를 주면 그 id 로 (없으면 UUIDv7). */
  create<T extends TypeName>(type: T, fields: FieldsOf<T>, id?: string): string {
    const newId = id ?? uuidv7(this.wall());
    this.write(newId, type, flatten(fields as Record<string, unknown>), false);
    return newId;
  }

  /** 있으면 고치고 없으면 만듦 (id 를 정해서 쓰는 v1 가져오기 등) */
  put(id: string, type: string, fields: Record<string, unknown>): void {
    this.write(id, type, flatten(fields), false);
  }

  update<T extends TypeName>(id: string, fields: FieldsOf<T>): void {
    const type = this.state.typeOf(id);
    if (!type) throw new Error(`없는 항목: ${id}`);
    this.write(id, type, flatten(fields as Record<string, unknown>), false);
  }

  remove(id: string): void {
    this.push({ op: "del", id, t: this.clock.now() });
  }

  /**
   * 충돌 해결: 묻힌 값들까지 모두 보고 이 값으로 정함 → conflicts() 에서 사라짐.
   * (보통 update 는 지금 보이는 값만 '봤음'으로 표시해서, 묻힌 값은 계속 남아 알려 줌)
   */
  resolve(id: string, field: string, value: Json): void {
    const type = this.state.typeOf(id);
    if (!type) throw new Error(`없는 항목: ${id}`);
    this.write(id, type, { [field]: value }, true);
  }

  private write(id: string, type: string, f: Fields, all: boolean): void {
    const op: SetOp = { op: "set", id, type, f, t: this.clock.now() };
    const keep = KEEP_HEADS[type] ?? [];
    const b: Record<string, Hlc[]> = {};
    for (const k of Object.keys(f)) {
      if (!keep.includes(k)) continue;
      const seen = all ? this.state.headTimes(id, k) : [this.state.fieldTime(id, k)].filter((x): x is Hlc => !!x);
      if (seen.length) b[k] = seen;
    }
    if (Object.keys(b).length) op.b = b;
    this.push(op);
  }

  private push(op: Op): void {
    this.state.apply(op);
    this.pending.push(op);
    this.emit();
  }

  // ---------- 읽기 ----------

  get<T extends TypeName>(id: string): EntityOf<T> | undefined {
    return this.state.get(id) as EntityOf<T> | undefined;
  }

  list<T extends TypeName>(type: T, pred?: (x: EntityOf<T>) => boolean): EntityOf<T>[] {
    const all = this.state.list(type) as unknown as EntityOf<T>[];
    return pred ? all.filter(pred) : all;
  }

  conflicts(id: string): Conflict[] {
    return this.state.conflicts(id);
  }

  /** 아직 보관함에 안 쓴 변경 수 */
  pendingCount(): number {
    return this.pending.length;
  }

  /** 상태가 바뀔 때마다 (화면 다시 그리기) */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 비교 · 디버그용 전체 상태 */
  dump(): EntityDump[] {
    return this.state.dump();
  }

  // ---------- 동기화 ----------

  async flush(): Promise<number> {
    if (!this.pending.length) return 0;
    const groups = new Map<string, Op[]>();
    for (const op of this.pending) {
      const p = logPath(this.deviceId, op.t);
      const g = groups.get(p);
      if (g) g.push(op);
      else groups.set(p, [op]);
    }
    // 파일 하나를 쓸 때마다 pending 에서 빼므로, 중간에 실패하면 못 쓴 변경만 남아 다음에 다시 씀
    let written = 0;
    for (const [path, ops] of groups) {
      let text = encodeOps(ops);
      if (!this.tailChecked.has(path)) {
        // 지난번에 쓰다 끊긴 줄이 있으면 새 줄에서 시작 (끊긴 줄은 깨진 줄로 버려짐)
        const old = await this.fs.read(path);
        if (old && !old.endsWith("\n")) text = "\n" + text;
        this.tailChecked.add(path);
      }
      await this.fs.append(path, text);
      written += ops.length;
      const sent = new Set(ops);
      this.pending = this.pending.filter((o) => !sent.has(o));
    }
    return written;
  }

  async pull(): Promise<PullResult> {
    const paths = (await this.fs.list("log/")).filter((p) => deviceOfPath(p) !== null);
    const r: PullResult = { applied: 0, files: 0, bad: 0 };
    for (const path of paths) {
      const text = await this.fs.read(path);
      if (text === null) continue;
      let from = this.cursors[path] ?? 0;
      const lines = text.split("\n").length - 1;
      if (lines < from) from = 0; // 파일이 바뀌어 짧아짐 (드문 일) → 처음부터 다시 (합치기는 멱등)
      if (lines === from) continue;
      const parsed = parseLog(text, from);
      for (const op of parsed.ops) {
        this.state.apply(op);
        this.clock.receive(op.t);
      }
      this.cursors[path] = parsed.lines;
      r.applied += parsed.ops.length;
      r.bad += parsed.bad;
      r.files++;
    }
    if (r.applied) this.emit();
    return r;
  }

  async sync(): Promise<PullResult> {
    await this.flush();
    return this.pull();
  }

  // ---------- 스냅샷 · 기기 안 저장 ----------

  /** 지금 상태를 snapshots/<기기>.json 에 → 새 기기는 이것 + 이후 기록만 읽으면 됨 */
  async writeSnapshot(): Promise<void> {
    await this.sync();
    const snap: Snapshot = {
      v: 1,
      deviceId: this.deviceId,
      at: this.state.latest(),
      cursors: this.cursors,
      entities: this.state.dump(),
    };
    await this.fs.write(`snapshots/${this.deviceId}.json`, JSON.stringify(snap));
  }

  private async loadBestSnapshot(): Promise<void> {
    let best: Snapshot | null = null;
    for (const p of await this.fs.list("snapshots/")) {
      try {
        const s = JSON.parse((await this.fs.read(p)) ?? "null") as Snapshot | null;
        if (s && s.v === 1 && Array.isArray(s.entities) && (!best || (s.at ?? "") > (best.at ?? ""))) best = s;
      } catch {
        // 받는 중이거나 깨진 스냅샷은 건너뜀 — 기록에서 다시 만들면 됨
      }
    }
    if (!best) return;
    this.state.merge(best.entities);
    this.cursors = { ...best.cursors };
    if (best.at) this.clock.receive(best.at);
  }

  exportLocal(): LocalState {
    return {
      v: 1,
      deviceId: this.deviceId,
      clock: this.clock.last(),
      cursors: { ...this.cursors },
      pending: [...this.pending],
      entities: this.state.dump(),
    };
  }
}
