/**
 * 사용자 동작 = 복제본 변경. 모든 동작은 되돌리기(Ctrl+Z · 스낵바)가 됨 (설계 원칙 4: 확인 창 대신 되돌리기).
 *
 * 되돌리기 방법: 동작 전에 건드릴 항목의 값을 찍어 두고, 되돌릴 때 그 값으로 다시 씀(새 변경으로).
 * 지운 항목은 지움 표시보다 늦은 set 이 오면 되살아나므로(state.ts) 그대로 다시 쓰면 됨.
 */
import {
  keyBetween, keysBetween, stopTask, startTimer, isRunning,
  type Replica, type Task,
} from "@dailytodo/core";
import { dayOf } from "./dates.ts";
import { parseInput, type Parsed } from "./parse.ts";
import { siblings } from "./selectors.ts";

type Snap = { id: string; before: Record<string, unknown> | undefined };
interface Entry {
  label: string;
  snaps: Snap[];
}

const META = new Set(["id", "type", "createdAt", "updatedAt"]);

/** { f: { rating: 5 } } → { "f.rating": 5 } (메타 칸 빼고) */
function flat(o: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(o)) {
    if (!prefix && META.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v as Record<string, unknown>, `${prefix}${k}.`, out);
    else out[prefix + k] = v;
  }
  return out;
}

export type AddResult = { ok: true; kind: Parsed["kind"]; id: string } | { ok: false; message: string };

export class Actions {
  readonly rep: Replica;
  /** 세션에 적을 이 PC 의 ID (위젯 · 메인 창이 같은 PC) */
  readonly pcId: string;
  private now: () => number;
  private stack: Entry[] = [];
  private listeners = new Set<(label: string | null) => void>();

  constructor(rep: Replica, pcId: string, now: () => number = Date.now) {
    this.rep = rep;
    this.pcId = pcId;
    this.now = now;
  }

  // ---------- 되돌리기 ----------

  /** ids 의 지금 값을 찍어 두고 fn 실행. fn 이 돌려준 ID 는 새로 만든 것 → 되돌리면 지움 */
  private track(label: string, ids: string[], fn: () => string[] | void): void {
    const snaps: Snap[] = [...new Set(ids)].map((id) => ({ id, before: this.rep.get(id) as Record<string, unknown> | undefined }));
    const created = fn() ?? [];
    for (const id of created) if (!snaps.some((s) => s.id === id)) snaps.push({ id, before: undefined });
    this.stack.push({ label, snaps });
    if (this.stack.length > 50) this.stack.shift();
    this.notify(label);
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  undo(): string | null {
    const e = this.stack.pop();
    if (!e) return null;
    for (const { id, before } of [...e.snaps].reverse()) {
      const after = this.rep.get(id) as Record<string, unknown> | undefined;
      if (!before) {
        if (after) this.rep.remove(id);
        continue;
      }
      const fields = flat(before);
      if (after) for (const k of Object.keys(flat(after))) if (!(k in fields)) fields[k] = null;
      this.rep.put(id, before.type as string, fields);
    }
    this.notify(null);
    return e.label;
  }

  /** 마지막 동작 이름이 바뀔 때 (스낵바) — 되돌린 직후엔 null */
  onChange(fn: (label: string | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(label: string | null) {
    for (const fn of this.listeners) fn(label);
  }

  // ---------- 추가 ----------

  private orderAfterLast(sibs: Task[]): string {
    const last = sibs[sibs.length - 1]?.order;
    try {
      return keyBetween(typeof last === "string" ? last : null, null);
    } catch {
      return keyBetween(null, null);
    }
  }

  private topLevel(day: string): Task[] {
    return siblings(this.rep, { id: "", type: "task", day, title: "", createdAt: "", updatedAt: "", parentId: null });
  }

  /** 입력 한 줄 → 할 일 · 하위 할 일 · 일정 · 마감 · 기록 */
  add(text: string, viewDay: string): AddResult {
    const today = dayOf(new Date(this.now()));
    const p = parseInput(text, viewDay, today);
    if (p.kind === "error") return { ok: false, message: p.message };
    let id = "";
    switch (p.kind) {
      case "task": {
        const top = this.topLevel(viewDay);
        if (!p.parentTitle) {
          this.track(`'${p.title}' 추가`, [], () => [
            (id = this.rep.create("task", { day: viewDay, title: p.title, done: false, order: this.orderAfterLast(top) })),
          ]);
          break;
        }
        const parent = top.find((t) => t.title === p.parentTitle);
        this.track(`'${p.parentTitle} > ${p.title}' 추가`, parent ? [parent.id] : [], () => {
          const made: string[] = [];
          let pid = parent?.id;
          if (!pid) {
            pid = this.rep.create("task", { day: viewDay, title: p.parentTitle!, done: false, order: this.orderAfterLast(top) });
            made.push(pid);
          } else if (parent?.collapsed) {
            this.rep.update<"task">(pid, { collapsed: false });
          }
          const kids = this.rep.list("task", (t) => t.parentId === pid);
          const sorted = kids.sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1));
          id = this.rep.create("task", { day: viewDay, title: p.title, done: false, parentId: pid, order: this.orderAfterLast(sorted) });
          made.push(id);
          return made;
        });
        break;
      }
      case "event":
        this.track(`일정 '${p.title}' 추가`, [], () => [(id = this.rep.create("event", { day: p.day, time: p.time, title: p.title }))]);
        break;
      case "deadline":
        this.track(`마감 '${p.title}' 추가`, [], () => [(id = this.rep.create("deadline", { date: p.date, title: p.title }))]);
        break;
      case "moment":
        this.track("기록 추가", [], () => [(id = this.rep.create("moment", { at: this.now(), text: p.text }))]);
        break;
    }
    return { ok: true, kind: p.kind, id };
  }

  // ---------- 할 일 ----------

  private runningIds(taskId: string): string[] {
    return this.rep.list("session", (s) => s.taskId === taskId && s.end == null).map((s) => s.id);
  }

  toggleDone(id: string): void {
    const t = this.rep.get<"task">(id);
    if (!t) return;
    const done = !t.done;
    this.track(done ? `'${t.title}' 완료` : `'${t.title}' 완료 취소`, [id, ...this.runningIds(id)], () => {
      this.rep.update<"task">(id, { done, doneAt: done ? this.now() : null });
      if (done) stopTask(this.rep, id, this.now()); // 완료하면 타이머 정지
    });
  }

  /** 켜져 있으면 끄고, 꺼져 있으면 켬 (하나만 켜기) */
  toggleTimer(id: string): void {
    const t = this.rep.get<"task">(id);
    if (!t) return;
    const running = this.rep.list("session", (s) => s.end == null).map((s) => s.id);
    if (isRunning(this.rep, id)) {
      this.track(`'${t.title}' 정지`, running, () => stopTask(this.rep, id, this.now()));
    } else {
      this.track(`'${t.title}' 시작`, running, () => [startTimer(this.rep, id, this.now(), { deviceId: this.pcId })]);
    }
  }

  update(id: string, fields: Record<string, unknown>, label = "고침"): void {
    if (!this.rep.get(id)) return;
    this.track(label, [id], () => {
      this.rep.put(id, this.rep.get(id)!.type as string, fields);
    });
  }

  setCollapsed(id: string, collapsed: boolean): void {
    this.rep.update<"task">(id, { collapsed });
  }

  /** 할 일 지우기: 하위 할 일 · 세션까지 */
  removeTask(id: string): void {
    const t = this.rep.get<"task">(id);
    if (!t) return;
    const kids = this.rep.list("task", (c) => c.parentId === id).map((c) => c.id);
    const tasks = [id, ...kids];
    const sessions = this.rep.list("session", (s) => tasks.includes(s.taskId)).map((s) => s.id);
    const all = [...tasks, ...sessions];
    this.track(`'${t.title}' 지움`, all, () => {
      for (const x of all) this.rep.remove(x);
    });
  }

  remove(id: string, label = "지움"): void {
    if (!this.rep.get(id)) return;
    this.track(label, [id], () => this.rep.remove(id));
  }

  /** 같은 묶음 안에서 index 자리로 옮김 (드래그 정렬) */
  move(id: string, index: number): void {
    const t = this.rep.get<"task">(id);
    if (!t) return;
    const others = siblings(this.rep, t).filter((x) => x.id !== id);
    const at = Math.max(0, Math.min(index, others.length));
    const prev = others[at - 1]?.order;
    const next = others[at]?.order;
    let key: string | null = null;
    try {
      key = keyBetween(typeof prev === "string" ? prev : null, typeof next === "string" ? next : null);
    } catch {
      // 두 기기가 같은 순서 값을 만들었거나 값이 없음 → 묶음 전체를 다시 매김
    }
    if (key) {
      this.track(`'${t.title}' 옮김`, [id], () => this.rep.update<"task">(id, { order: key! }));
      return;
    }
    const arranged = [...others.slice(0, at), t, ...others.slice(at)];
    const keys = keysBetween(null, null, arranged.length);
    this.track(`'${t.title}' 옮김`, arranged.map((x) => x.id), () => {
      arranged.forEach((x, i) => this.rep.update<"task">(x.id, { order: keys[i]! }));
    });
  }

  // ---------- 세션 ----------

  updateSession(id: string, fields: { start?: number; end?: number | null }): void {
    const s = this.rep.get<"session">(id);
    if (!s) return;
    const start = fields.start ?? s.start;
    const end = fields.end === undefined ? s.end : fields.end;
    if (end != null && end < start) return;
    this.track("측정 기록 고침", [id], () => this.rep.update<"session">(id, { start, end }));
  }
}
