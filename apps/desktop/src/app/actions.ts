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

  /**
   * ids 의 지금 값을 찍어 두고 fn 실행. fn 이 돌려준 ID 는 새로 만든 것 → 되돌리면 지움.
   * 되돌리기 줄은 지울 때만 띄움 (announce) — 누를 때마다 뜨면 거슬려서 (사용자 요청). 나머지는 Ctrl+Z 로.
   */
  private track(label: string, ids: string[], fn: () => string[] | void, announce = false): void {
    const snaps: Snap[] = [...new Set(ids)].map((id) => ({ id, before: this.rep.get(id) as Record<string, unknown> | undefined }));
    const created = fn() ?? [];
    for (const id of created) if (!snaps.some((s) => s.id === id)) snaps.push({ id, before: undefined });
    this.stack.push({ label, snaps });
    if (this.stack.length > 50) this.stack.shift();
    this.notify(announce ? label : null);
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

  /** 일정표에서: 이미 해석한 일정 · 마감 추가 */
  addDated(p: { kind: "event"; day: string; time: string | null; title: string } | { kind: "deadline"; date: string; title: string }): string {
    let id = "";
    if (p.kind === "event") {
      this.track(`일정 '${p.title}' 추가`, [], () => [(id = this.rep.create("event", { day: p.day, time: p.time, title: p.title }))]);
    } else {
      this.track(`마감 '${p.title}' 추가`, [], () => [(id = this.rep.create("deadline", { date: p.date, title: p.title }))]);
    }
    return id;
  }

  /** 일정 · 마감을 다른 날로 (끌어 놓기) */
  moveToDay(id: string, day: string): void {
    const x = this.rep.get(id) as { type: string; title?: string; day?: string; date?: string } | undefined;
    if (!x) return;
    const field = x.type === "deadline" ? "date" : x.type === "event" ? "day" : null;
    if (!field || x[field] === day) return;
    this.track(`'${x.title ?? ""}' 날짜 옮김`, [id], () => this.rep.put(id, x.type, { [field]: day }));
  }

  // ---------- 할 일 ----------

  private runningIds(taskId: string): string[] {
    return this.rep.list("session", (s) => s.taskId === taskId && s.end == null).map((s) => s.id);
  }

  toggleDone(id: string): void {
    const t = this.rep.get<"task">(id);
    if (!t) return;
    const done = !t.done;
    // 만다라트 실천 칸에서 온 할 일이면 칸도 같이 (v1)
    const m = /^mandala\/(\d)\/(\d)$/.exec(t.ref ?? "");
    const mid = m ? this.mandalaId() : null;
    this.track(done ? `'${t.title}' 완료` : `'${t.title}' 완료 취소`, [id, ...this.runningIds(id), ...(mid ? [mid] : [])], () => {
      this.rep.update<"task">(id, { done, doneAt: done ? this.now() : null });
      if (done) stopTask(this.rep, id, this.now()); // 완료하면 타이머 정지
      if (m && mid) this.rep.put(mid, "mandala", { [`done.${m[1]}.${m[2]}`]: done });
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

  /** 묶음 아래에 하위 할 일 바로 추가 (+ 버튼 · 우클릭 '하위 할 일 추가') */
  addChild(parentId: string, title: string): string | null {
    const p = this.rep.get<"task">(parentId);
    if (!p || !title.trim()) return null;
    const kids = this.rep.list("task", (t) => t.parentId === parentId).sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1));
    let id = "";
    this.track(`'${p.title} > ${title.trim()}' 추가`, [parentId], () => {
      if (p.collapsed) this.rep.update<"task">(parentId, { collapsed: false });
      id = this.rep.create("task", { day: p.day, title: title.trim(), done: false, parentId, order: this.orderAfterLast(kids) });
      return [id];
    });
    return id;
  }

  /** 다른 할 일 아래로 묶기 / 묶음에서 빼기(null) (v1 set_parent) */
  setParent(id: string, parentId: string | null): void {
    const t = this.rep.get<"task">(id);
    if (!t || t.id === parentId) return;
    const p = parentId ? this.rep.get<"task">(parentId) : undefined;
    const sibs = parentId
      ? this.rep.list("task", (x) => x.parentId === parentId).sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1))
      : this.topLevel(t.day);
    this.track(p ? `'${t.title}' → '${p.title}' 아래로` : `'${t.title}' 묶음에서 뺌`, [id, ...(parentId ? [parentId] : [])], () => {
      this.rep.update<"task">(id, { parentId, order: this.orderAfterLast(sibs) });
      if (p?.collapsed) this.rep.update<"task">(parentId!, { collapsed: false });
    });
  }

  /** 마감을 이 묶음에 연결 · 다시 누르면 풂 (v1 link_deadline) */
  linkDeadline(deadlineId: string, groupTitle: string): void {
    const d = this.rep.get<"deadline">(deadlineId);
    if (!d) return;
    const on = d.groupTitle !== groupTitle;
    this.track(on ? `마감 '${d.title}' 연결` : `마감 '${d.title}' 연결 풂`, [deadlineId], () => this.rep.update<"deadline">(deadlineId, { groupTitle: on ? groupTitle : null }));
  }

  /** 이 이름의 시간이 목표에 쌓이게 · 다시 누르면 풂 (v1 link_goal) */
  linkGoal(goalId: string, title: string): void {
    const g = this.rep.get<"goal">(goalId);
    if (!g || g.title === title) return;
    const linked = g.linkedTitles ?? [];
    const on = !linked.includes(title);
    this.track(on ? `목표 '${g.title}'에 연결` : `목표 '${g.title}' 연결 풂`, [goalId], () =>
      this.rep.update<"goal">(goalId, { linkedTitles: on ? [...linked, title] : linked.filter((x) => x !== title) }));
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
    }, true);
  }

  remove(id: string, label = "지움"): void {
    if (!this.rep.get(id)) return;
    this.track(label, [id], () => this.rep.remove(id), true);
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

  // ---------- 기록장 ----------

  /** 그날 기분 (같은 걸 다시 누르면 지움) */
  setMood(day: string, level: number): void {
    const cur = this.rep.list("mood", (m) => m.day === day);
    if (cur.length && cur.every((m) => m.level === level)) {
      this.track("기분 지움", cur.map((m) => m.id), () => cur.forEach((m) => this.rep.remove(m.id)));
      return;
    }
    const id = cur[0]?.id ?? `mood-${day}`; // 날짜로 ID 를 정해 두 기기가 같은 날 기분을 따로 만들지 않게
    this.track("기분 고침", [id], () => this.rep.put(id, "mood", { day, level }));
  }

  /** 일기 글 저장 (자동 저장 — 입력칸이 자기 되돌리기를 가지므로 되돌리기 줄에는 안 올림) */
  saveJournal(journalId: string | undefined, day: string, text: string): string {
    const id = journalId ?? `journal-${day}`;
    if (this.rep.get(id)) this.rep.update<"journal">(id, { text });
    else this.rep.put(id, "journal", { day, text });
    return id;
  }

  addMoment(at: number, text: string, photos: unknown[] = []): string {
    let id = "";
    this.track("기록 추가", [], () => [(id = this.rep.create("moment", { at, text, ...(photos.length ? { photos: photos as never } : {}) }))]);
    return id;
  }

  /** 데이트 일기 새로 쓰기 */
  addRecord(collection: string, fields: Record<string, unknown>): string {
    let id = "";
    this.track("새 기록", [], () => {
      id = this.rep.create("record", { collection, ...fields } as never);
      return [id];
    });
    return id;
  }

  /** 여러 개를 한 번에 지우기 (지우개로 그은 획들 → 되돌리기 한 번에) */
  removeMany(ids: string[], label: string): void {
    const live = ids.filter((id) => this.rep.get(id));
    if (live.length) this.track(label, live, () => live.forEach((id) => this.rep.remove(id)), true);
  }

  /** 모음(완료 방식): 완료 표시 · 이룬 날 */
  setRecordDone(id: string, done: boolean, day: string): void {
    const r = this.rep.get<"record">(id);
    if (!r) return;
    this.track(done ? `'${r.title}' 완료` : `'${r.title}' 완료 취소`, [id], () => this.rep.update<"record">(id, { done, doneOn: done ? day : null }));
  }

  /** 모음(단계 방식): 마지막 단계가 되면 그날을 기록 (v1 set_stage) */
  setRecordStage(s: { stages?: string[] }, id: string, stage: number, day: string): void {
    const r = this.rep.get<"record">(id);
    if (!r || (r.stage ?? 0) === stage) return;
    const last = (s.stages?.length ?? 1) - 1;
    const label = s.stages?.[stage] ?? String(stage);
    this.track(`'${r.title}' → ${label}`, [id], () => this.rep.update<"record">(id, { stage, doneOn: stage >= last ? day : null }));
  }

  /** 모음 항목 → 오늘 할 일 '묶음 > 제목' (이미 있으면 false) */
  recordToToday(id: string, group: string, day: string): boolean {
    const r = this.rep.get<"record">(id);
    if (!r) return false;
    const ref = `record/${id}`;
    if (this.rep.list("task", (t) => t.ref === ref && t.day === day && !t.done).length) return false;
    const res = this.add(`${group} > ${r.title}`, day);
    if (!res.ok) return false;
    this.rep.update<"task">(res.id, { ref });
    return true;
  }

  /** 사용자 정의 모음 지우기: 그 안의 기록까지 (되돌리기로 모두 되살림) */
  removeCollection(id: string): void {
    const c = this.rep.get<"collection">(id);
    if (!c) return;
    const ids = [id, ...this.rep.list("record", (r) => r.collection === id).map((r) => r.id)];
    this.track(`모음 '${c.label}' 지움`, ids, () => ids.forEach((x) => this.rep.remove(x)), true);
  }

  /** 이름으로 큰 목표 등록 (이미 있으면 false) */
  toGoal(title: string): boolean {
    if (this.rep.list("goal", (g) => g.title === title).length) return false;
    this.create("goal", { title, linkedTitles: [] }, `목표 '${title}' 추가`);
    return true;
  }

  /** 아무 종류나 새로 (목표 · 습관 등) */
  create(type: string, fields: Record<string, unknown>, label: string, id?: string): string {
    let made = "";
    this.track(label, [], () => {
      made = id ?? this.rep.create(type as never, fields as never);
      if (id) this.rep.put(id, type, fields);
      return [made];
    });
    return made;
  }

  /** 습관 체크 켜고 끄기 (체크 하나 = 항목 하나, ID 를 날짜로 정해 두 기기가 같은 날 중복으로 안 만듦) */
  toggleHabit(habitId: string, day: string): void {
    const h = this.rep.get<"habit">(habitId);
    if (!h) return;
    const cur = this.rep.list("habitCheck", (c) => c.habitId === habitId && c.day === day);
    if (cur.length) {
      this.track(`'${h.name}' 체크 해제`, cur.map((c) => c.id), () => cur.forEach((c) => this.rep.remove(c.id)));
    } else {
      const id = `hc-${habitId}-${day}`.slice(0, 64);
      this.track(`'${h.name}' 체크`, [id], () => this.rep.put(id, "habitCheck", { habitId, day }));
    }
  }

  /** 습관 지우기: 체크 기록까지 */
  removeHabit(habitId: string): void {
    const h = this.rep.get<"habit">(habitId);
    if (!h) return;
    const ids = [habitId, ...this.rep.list("habitCheck", (c) => c.habitId === habitId).map((c) => c.id)];
    this.track(`습관 '${h.name}' 지움`, ids, () => ids.forEach((x) => this.rep.remove(x)), true);
  }

  /** 같이 쓰는 설정 (모양 · 기능 켜고 끄기) — 모든 기기에 동기화 */
  setShared(fields: Record<string, unknown>, label = "설정 바꿈"): void {
    this.track(label, ["settings"], () => this.rep.put("settings", "setting", fields));
  }

  // ---------- 만다라트 ----------

  /** 만다라트 하나 (가져온 것이 있으면 그것) */
  mandalaId(): string {
    return this.rep.list("mandala")[0]?.id ?? "mandala-main";
  }

  setMandalaCell(field: string, value: string | boolean, label = "만다라트 고침"): void {
    const id = this.mandalaId();
    this.track(label, [id], () => this.rep.put(id, "mandala", { [field]: value }));
  }

  /** 실천 칸 → 오늘 할 일 '세부목표 > 실천' (v1 과 같음, 완료하면 칸도 완료) */
  mandalaToTask(s: number, a: number, sub: string, action: string, day: string): string | null {
    const ref = `mandala/${s}/${a}`;
    if (this.rep.list("task", (t) => t.ref === ref && !t.done && t.day === day).length) return null;
    const r = this.add(`${sub || "만다라트"} > ${action}`, day);
    if (!r.ok) return null;
    this.rep.update<"task">(r.id, { ref });
    return r.id;
  }

  // ---------- 날짜 넘기기 · 자리 비움 (v1 copy_task · split_at_midnight · AwayDialog) ----------

  /** 할 일을 다른 날로 복사 (같은 묶음 이름 아래, 이미 같은 할 일이 있으면 그것) → 그 날의 할 일 ID */
  private copyTaskTo(taskId: string, day: string): string {
    const t = this.rep.get<"task">(taskId)!;
    const parent = t.parentId ? this.rep.get<"task">(t.parentId) : undefined;
    const top = this.topLevel(day);
    let pid: string | null = null;
    if (parent) {
      pid = top.find((x) => x.title === parent.title)?.id ?? null;
      if (!pid) pid = this.rep.create("task", { day, title: parent.title, done: false, order: this.orderAfterLast(top) });
    }
    const sibs = pid ? this.rep.list("task", (x) => x.parentId === pid).sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1)) : this.topLevel(day);
    const same = sibs.find((x) => x.title === t.title && !x.done);
    if (same) return same.id;
    return this.rep.create("task", {
      day, title: t.title, done: false, parentId: pid, order: this.orderAfterLast(sibs),
      note: t.note ?? "", estimateMin: t.estimateMin ?? null, ref: t.ref ?? null,
    });
  }

  /** 오늘 정리하기: 고른 할 일을 다음 날로 (타이머는 멈춤) → 넘긴 수 */
  carryTo(taskIds: string[], day: string): number {
    if (!taskIds.length) return 0;
    const running = this.rep.list("session", (s) => taskIds.includes(s.taskId) && s.end == null).map((s) => s.id);
    this.track(`내일로 ${taskIds.length}개 넘김`, [...taskIds, ...running], () => {
      const made = taskIds.map((id) => {
        stopTask(this.rep, id, this.now());
        return this.copyTaskTo(id, day);
      });
      return made;
    });
    return taskIds.length;
  }

  /**
   * 자정 넘기기: 지난 날의 할 일을 재는 중이면 그날 자정에 끊고, 바로 이어서 잰 거면 오늘의 같은 할 일로 이어 잼.
   * 하루 넘게 켜져 있었으면 이어 재지 않음 (자리 비움 확인이 먼저 물어봄).
   */
  splitAtMidnight(): number {
    const now = this.now();
    const today = dayOf(new Date(now));
    const todayStart = new Date(new Date(now).setHours(0, 0, 0, 0)).getTime();
    let n = 0;
    for (const s of this.rep.list("session", (x) => x.end == null && x.deviceId === this.pcId)) {
      const t = this.rep.get<"task">(s.taskId);
      if (!t || t.day >= today) continue;
      const startDay = new Date(s.start);
      const midnight = new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + 1).getTime();
      this.rep.update<"session">(s.id, { end: Math.max(s.start, midnight) });
      if (midnight === todayStart) {
        const id = this.copyTaskTo(t.id, today);
        this.rep.create("session", { taskId: id, start: todayStart, end: null, deviceId: this.pcId, kind: s.kind });
      }
      n++;
    }
    return n;
  }

  /** 자리 비움 확인의 답: since 에 멈춘 것으로 (resume 이면 지금부터 다시 — 날이 바뀌었으면 오늘의 같은 할 일로) */
  cutAway(sessionIds: string[], since: number, resume: boolean): void {
    const now = this.now();
    const today = dayOf(new Date(now));
    this.track(resume ? "비운 시간 빼고 계속" : "비운 시간 빼고 멈춤", sessionIds, () => {
      const made: string[] = [];
      for (const sid of sessionIds) {
        const s = this.rep.get<"session">(sid);
        if (!s || s.end != null) continue;
        this.rep.update<"session">(sid, { end: Math.max(s.start, since) });
        if (resume) {
          const t = this.rep.get<"task">(s.taskId);
          const id = t && t.day !== today ? this.copyTaskTo(t.id, today) : s.taskId;
          made.push(this.rep.create("session", { taskId: id, start: now, end: null, deviceId: this.pcId, kind: s.kind }));
        }
      }
      return made;
    });
  }

  /** 뽀모도로 집중이 끝남: 그 시각에 멈추고 뽀모도로 한 번으로 기록 */
  finishPomodoro(sessionId: string, end: number): void {
    const s = this.rep.get<"session">(sessionId);
    if (!s || s.end != null) return;
    this.rep.update<"session">(sessionId, { end: Math.max(s.start, end), kind: "pomodoro" });
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
