/**
 * v1(Python · tkinter) 기록 가져오기 (설계 10장).
 *
 * - v1 JSON 을 읽어 "import-…" 기기 이름으로 변경 기록을 만듦. v1 파일은 건드리지 않음.
 * - ID 는 v1 기록에서 늘 같게 만듦(nameId) → 다시 가져와도 중복 없이 같은 항목이 최신 v1 값으로 맞춰짐.
 * - elapsed(누적 초) → 그날 끝에 끝나는 세션 하나(kind: imported), 진행 중 타이머 → 열린 세션.
 * - 기록장 모음(버킷리스트 · 리뷰 …)도 지금 화면이 없어도 record 로 모두 옮겨 둠.
 */
import { nameId } from "./ids.ts";
import { keysBetween } from "./order.ts";
import { Replica } from "./replica.ts";
import type { Day } from "./schema.ts";
import type { VaultFs } from "./vault.ts";

export interface V1Task {
  id: string;
  title: string;
  done?: boolean;
  elapsed?: number;
  started_at?: number | null;
  note?: string;
  estimate?: number | null;
  parent?: string | null;
  collapsed?: boolean;
  pomos?: number;
  mandala?: [number, number] | null;
}

export interface V1Data {
  tasks?: Record<Day, V1Task[]>;
  events?: Record<Day, { id: string; time?: string; title: string }[]>;
  deadlines?: { id: string; title: string; date: Day; group?: string | null }[];
  goals?: { id: string; title: string; target_hours?: number | null; titles?: string[]; created?: Day }[];
  habits?: { habits?: { id: string; name: string }[]; log?: Record<Day, string[]> };
  moods?: Record<Day, number>;
  journal?: Record<Day, string>;
  mandalart?: { center?: string; subs?: string[]; actions?: string[][]; done?: boolean[][] };
  collections?: Record<string, Record<string, unknown>[]>;
}

/** v1 데이터 폴더의 파일 이름 */
export const V1_FILES: Record<keyof V1Data, string> = {
  tasks: "tasks.json",
  events: "events.json",
  deadlines: "deadlines.json",
  goals: "goals.json",
  habits: "habits.json",
  moods: "moods.json",
  journal: "journal.json",
  mandalart: "mandalart.json",
  collections: "collections.json",
};

export interface V1Summary {
  /** 종류별로 만든 항목 수 */
  counts: Record<string, number>;
  /** v1 기준 날짜별 잰 시간(초) — 진행 중 타이머는 now 까지 */
  secondsByDay: Record<Day, number>;
  totalSeconds: number;
  /** v1 에서 재는 중이던 타이머 수 */
  running: number;
}

/** 그날이 끝나는 순간 (이 기기 현지 시각 다음 날 0시) */
export function dayEnd(day: Day): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d + 1).getTime();
}

const RECORD_KNOWN = new Set(["id", "title", "tags", "note", "created", "done", "done_on", "stage", "date"]);

export async function importV1(
  fs: VaultFs,
  data: V1Data,
  opts: { deviceId?: string; now?: number; wall?: () => number } = {},
): Promise<V1Summary> {
  const now = opts.now ?? Date.now();
  const rep = await Replica.open(fs, { deviceId: opts.deviceId ?? "import", wall: opts.wall, quiet: true });
  // 보관함의 기존 기록을 먼저 읽어 시계를 그 뒤로 → 다시 가져오기가 지난 가져오기 · 그 사이 수정보다 확실히 늦음
  await rep.pull();
  const counts: Record<string, number> = {};
  const id = (key: string) => nameId(`v1/${key}`);
  const put = async (key: string, type: string, fields: Record<string, unknown>) => {
    rep.put(await id(key), type, fields);
    counts[type] = (counts[type] ?? 0) + 1;
  };
  const secondsByDay: Record<Day, number> = {};
  let running = 0;

  // 할 일 + 세션 (v1 의 할 일 ID 는 날짜 안에서만 쓰므로 날짜를 붙여 구분)
  for (const [day, tasks] of Object.entries(data.tasks ?? {})) {
    const orders = keysBetween(null, null, tasks.length);
    for (const [i, t] of tasks.entries()) {
      const fields: Record<string, unknown> = {
        day,
        title: t.title,
        done: !!t.done,
        parentId: t.parent ? await id(`task/${day}/${t.parent}`) : null,
        order: orders[i],
        note: t.note ?? "",
        estimateMin: t.estimate ?? null,
        collapsed: !!t.collapsed,
        ref: t.mandala ? `mandala/${t.mandala[0]}/${t.mandala[1]}` : null,
      };
      if (t.pomos) fields.pomos = t.pomos;
      const taskId = await id(`task/${day}/${t.id}`);
      await put(`task/${day}/${t.id}`, "task", fields);

      const elapsedMs = Math.round((t.elapsed ?? 0) * 1000);
      if (elapsedMs > 0) {
        const end = dayEnd(day);
        await put(`session/${day}/${t.id}`, "session", {
          taskId, start: end - elapsedMs, end, deviceId: "v1", kind: "imported",
        });
      }
      let secs = t.elapsed ?? 0;
      if (t.started_at) {
        const start = Math.round(t.started_at * 1000);
        await put(`session-running/${day}/${t.id}`, "session", {
          taskId, start, end: null, deviceId: "v1", kind: "normal",
        });
        secs += Math.max(0, now - start) / 1000;
        running++;
      }
      if (secs > 0) secondsByDay[day] = (secondsByDay[day] ?? 0) + secs;
    }
  }

  for (const [day, events] of Object.entries(data.events ?? {})) {
    for (const e of events) {
      await put(`event/${day}/${e.id}`, "event", { day, time: e.time || null, title: e.title });
    }
  }

  for (const d of data.deadlines ?? []) {
    await put(`deadline/${d.id}`, "deadline", { date: d.date, title: d.title, groupTitle: d.group ?? null });
  }

  for (const g of data.goals ?? []) {
    await put(`goal/${g.id}`, "goal", {
      title: g.title, targetHours: g.target_hours ?? null, linkedTitles: g.titles ?? [], createdDay: g.created,
    });
  }

  const habits = data.habits?.habits ?? [];
  const habitOrders = keysBetween(null, null, habits.length);
  for (const [i, h] of habits.entries()) await put(`habit/${h.id}`, "habit", { name: h.name, order: habitOrders[i] });
  const known = new Set(habits.map((h) => h.id));
  for (const [day, ids] of Object.entries(data.habits?.log ?? {})) {
    for (const hid of ids) {
      if (known.has(hid)) await put(`habitCheck/${hid}/${day}`, "habitCheck", { habitId: await id(`habit/${hid}`), day });
    }
  }

  for (const [day, level] of Object.entries(data.moods ?? {})) await put(`mood/${day}`, "mood", { day, level });

  for (const [day, text] of Object.entries(data.journal ?? {})) {
    if (text.trim()) await put(`journal/${day}`, "journal", { day, text });
  }

  const m = data.mandalart;
  if (m && (m.center || m.subs?.some(Boolean) || m.actions?.some((r) => r.some(Boolean)))) {
    const obj = <T>(xs: T[] | undefined) => Object.fromEntries((xs ?? []).map((x, i) => [String(i), x]));
    await put("mandala/main", "mandala", {
      center: m.center ?? "",
      subs: obj(m.subs),
      actions: obj((m.actions ?? []).map(obj)),
      done: obj((m.done ?? []).map(obj)),
    });
  }

  for (const [coll, items] of Object.entries(data.collections ?? {})) {
    for (const it of items) {
      const f = Object.fromEntries(Object.entries(it).filter(([k]) => !RECORD_KNOWN.has(k)));
      await put(`record/${coll}/${String(it.id)}`, "record", {
        collection: coll,
        title: it.title,
        tags: it.tags ?? [],
        note: it.note ?? "",
        createdDay: it.created,
        done: it.done,
        doneOn: it.done_on,
        stage: it.stage,
        day: it.date,
        f,
      });
    }
  }

  await rep.flush();
  const totalSeconds = Object.values(secondsByDay).reduce((a, b) => a + b, 0);
  return { counts, secondsByDay, totalSeconds, running };
}
