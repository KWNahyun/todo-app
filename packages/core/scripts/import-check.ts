/**
 * 실제 v1 기록으로 가져오기를 확인 (P1 끝 기준: "실제 v1 기록 가져오기 결과가 v1 통계와 일치").
 * v1 폴더는 읽기만, 결과는 메모리에만 — 아무 파일도 쓰지 않음.
 *
 *   node scripts/import-check.ts [v1 폴더]        (없으면 %APPDATA%\DailyTodo\location.json 이 가리키는 곳)
 *   node scripts/import-check.ts [폴더] --json    날짜별 초를 JSON 으로 (v1 Python 코드와 맞대 보기용)
 */
import { importV1 } from "../src/import-v1.ts";
import { findV1Folder, readV1Folder } from "../src/node-fs.ts";
import { Replica } from "../src/replica.ts";
import { dayTotalsMs } from "../src/sessions.ts";
import { MemoryFs } from "../src/vault.ts";

const args = process.argv.slice(2);
const json = args.includes("--json");
const dir = args.find((a) => !a.startsWith("--")) ?? (await findV1Folder());
if (!dir) throw new Error("v1 폴더를 찾지 못함");

const now = Date.now();
const data = await readV1Folder(dir);
const fs = new MemoryFs();
const t0 = performance.now();
const summary = await importV1(fs, data, { now });
const rep = await Replica.open(fs, { deviceId: "check", quiet: true });
await rep.pull();
const ms = performance.now() - t0;
const v2 = dayTotalsMs(rep, now);

if (json) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(v2).map(([d, x]) => [d, x / 1000]))));
  process.exit(0);
}

// v1 쪽 개수는 가져오기 코드와 따로 원본에서 직접 셈
const len = (x: unknown) => (Array.isArray(x) ? x.length : 0);
const sum = (o: Record<string, unknown> | undefined) => Object.values(o ?? {}).reduce<number>((a, x) => a + len(x), 0);
const habitIds = new Set((data.habits?.habits ?? []).map((h) => h.id));
const v1Counts: Record<string, number> = {
  task: sum(data.tasks),
  event: sum(data.events),
  deadline: len(data.deadlines),
  goal: len(data.goals),
  habit: habitIds.size,
  habitCheck: Object.values(data.habits?.log ?? {}).flat().filter((id) => habitIds.has(id)).length,
  mood: Object.keys(data.moods ?? {}).length,
  journal: Object.values(data.journal ?? {}).filter((t) => t.trim()).length,
  record: sum(data.collections),
};

let bad = 0;
console.log(`v1 폴더: ${dir}`);
console.log(`가져오기 + 읽기: ${ms.toFixed(0)}ms, 변경 기록 ${[...fs.files.values()].join("").split("\n").length - 1}줄`);
console.log("\n종류          v1    v2");
for (const [type, n] of Object.entries(v1Counts)) {
  const m = rep.list(type as never).length;
  if (m !== n) bad++;
  console.log(`${type.padEnd(12)} ${String(n).padStart(4)}  ${String(m).padStart(4)}${m === n ? "" : "  ← 다름"}`);
}
console.log(`mandala      ${data.mandalart ? "있음" : "없음"}  ${rep.list("mandala").length ? "있음" : "없음"}`);
console.log(`session         -  ${String(rep.list("session").length).padStart(4)}  (v1 진행 중 타이머 ${summary.running})`);

const fmt = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(Math.floor(s) % 60).padStart(2, "0")}`;
console.log("\n날짜          v1 잰 시간   v2 잰 시간");
const days = [...new Set([...Object.keys(summary.secondsByDay), ...Object.keys(v2)])].sort();
let total1 = 0;
let total2 = 0;
for (const d of days) {
  const a = summary.secondsByDay[d] ?? 0;
  const b = (v2[d] ?? 0) / 1000;
  total1 += a;
  total2 += b;
  const ok = Math.abs(a - b) < 1;
  if (!ok) bad++;
  console.log(`${d}   ${fmt(a).padStart(9)}    ${fmt(b).padStart(9)}${ok ? "" : "  ← 다름"}`);
}
console.log(`합계         ${fmt(total1).padStart(9)}    ${fmt(total2).padStart(9)}`);
console.log(bad ? `\n다른 곳 ${bad}개` : "\n모두 일치");
process.exit(bad ? 1 : 0);
