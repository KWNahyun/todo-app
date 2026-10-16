import { describe, expect, it } from "vitest";
import { parseLog, type Op } from "../src/ops.ts";
import { Replica } from "../src/replica.ts";
import { State } from "../src/state.ts";
import { MemoryFs, VaultError } from "../src/vault.ts";
import { startTimer, stopTask } from "../src/sessions.ts";
import { Drive, manualClock, rng } from "./helpers.ts";

const same = (a: Replica, b: Replica) => expect(JSON.stringify(a.dump())).toBe(JSON.stringify(b.dump()));

describe("두 기기", () => {
  it("한 기기에서 쓴 것이 다른 기기에 보임", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.now });
    const id = pc.create("task", { day: "2026-10-15", title: "KAMP 제출", done: false });
    expect(pc.pendingCount()).toBe(1);
    await pc.sync();
    expect(pc.pendingCount()).toBe(0);
    await phone.sync();
    expect(phone.get<"task">(id)).toMatchObject({ title: "KAMP 제출", done: false, type: "task" });
    expect(fs.files.has("devices/pc.json")).toBe(true);
    expect(JSON.parse(fs.files.get("vault.json")!)).toMatchObject({ format: 1, encryption: null });
  });

  it("동시에 다른 칸을 고치면 둘 다 남고, 같은 칸은 늦은 쪽", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.wall(0) });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.wall(-3000) }); // 휴대폰 시계가 3초 늦음
    const id = pc.create("task", { day: "2026-10-15", title: "모델링" });
    await pc.sync();
    await phone.sync();
    clk.tick(1000);
    pc.update<"task">(id, { title: "모델링 마무리", note: "PC 메모" });
    phone.update<"task">(id, { done: true, note: "폰 메모" });
    await pc.sync();
    await phone.sync();
    await pc.sync();
    const p = pc.get<"task">(id)!;
    expect(p).toMatchObject({ title: "모델링 마무리", done: true });
    // 휴대폰은 PC 의 변경을 본 적 없이 고쳤고 시계가 늦어서 note 는 PC 가 이김
    expect(p.note).toBe("PC 메모");
    same(pc, phone);
  });

  it("받은 뒤에 고친 값은, 내 시계가 늦어도 이김 (HLC)", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.wall(0) });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.wall(-60_000) }); // 1분 늦음
    const id = pc.create("task", { day: "2026-10-15", title: "PC 가 지은 이름" });
    await pc.sync();
    await phone.sync();
    phone.update<"task">(id, { title: "휴대폰에서 고침" });
    await phone.sync();
    await pc.sync();
    expect(pc.get<"task">(id)!.title).toBe("휴대폰에서 고침");
  });

  it("지운 항목은 다른 기기에서도 사라짐", async () => {
    const fs = new MemoryFs();
    const pc = await Replica.open(fs, { deviceId: "pc" });
    const phone = await Replica.open(fs, { deviceId: "phone" });
    const id = pc.create("event", { day: "2026-10-15", time: "13:30", title: "삐약이들 회의" });
    await pc.sync();
    await phone.sync();
    phone.remove(id);
    await phone.sync();
    await pc.sync();
    expect(pc.get(id)).toBeUndefined();
    expect(pc.list("event")).toEqual([]);
  });

  it("일기를 동시에 고치면 묻힌 글을 보관하고, 정하면 사라짐", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.now });
    const id = pc.create("journal", { day: "2026-10-15", text: "아침" });
    await pc.sync();
    await phone.sync();
    clk.tick(10);
    pc.update<"journal">(id, { text: "아침 산책" });
    clk.tick(10);
    pc.update<"journal">(id, { text: "아침 산책 20분" }); // 자기 글을 이어 고침 → 충돌 아님
    phone.update<"journal">(id, { text: "아침에 코테 문제" });
    await pc.sync();
    await phone.sync();
    await pc.sync();
    same(pc, phone);
    const winner = pc.get<"journal">(id)!.text;
    const lost = pc.conflicts(id);
    expect(lost).toHaveLength(1);
    expect([winner, lost[0]!.value].sort()).toEqual(["아침 산책 20분", "아침에 코테 문제"]);

    phone.resolve(id, "text", "아침 산책 20분, 그리고 코테 문제");
    await phone.sync();
    await pc.sync();
    expect(pc.conflicts(id)).toEqual([]);
    expect(pc.get<"journal">(id)!.text).toBe("아침 산책 20분, 그리고 코테 문제");
  });

  it("묻힌 글은 보통 수정으로는 안 사라짐 (사용자가 볼 때까지)", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    const phone = await Replica.open(fs, { deviceId: "phone", wall: clk.now });
    const id = pc.create("journal", { day: "2026-10-15", text: "a" });
    await pc.sync();
    await phone.sync();
    clk.tick(1);
    pc.update<"journal">(id, { text: "pc" });
    clk.tick(1);
    phone.update<"journal">(id, { text: "phone" });
    await pc.sync();
    await phone.sync();
    await pc.sync();
    clk.tick(1);
    pc.update<"journal">(id, { text: "phone + 더 씀" });
    await pc.sync();
    expect(pc.conflicts(id).map((c) => c.value)).toEqual(["pc"]);
  });
});

describe("드라이브 상황", () => {
  it("받는 중이라 끝이 잘린 파일 · 깨진 줄이 있어도 이어서 읽음", async () => {
    const fs = new MemoryFs();
    const pc = await Replica.open(fs, { deviceId: "pc" });
    const ids = [1, 2, 3].map((i) => pc.create("task", { day: "2026-10-15", title: `할 일 ${i}` }));
    await pc.flush();
    const path = [...fs.files.keys()].find((p) => p.startsWith("log/pc/"))!;
    const full = fs.files.get(path)!;

    const other = new MemoryFs();
    other.files.set("vault.json", fs.files.get("vault.json")!);
    other.files.set(path, full.slice(0, full.length - 10)); // 마지막 줄이 덜 받아짐
    const phone = await Replica.open(other, { deviceId: "phone" });
    expect((await phone.pull()).applied).toBe(2);
    expect(phone.get(ids[2]!)).toBeUndefined();
    other.files.set(path, full + "{깨진 줄\n");
    const r = await phone.pull();
    expect(r).toMatchObject({ applied: 1, bad: 1 });
    expect(phone.get<"task">(ids[2]!)!.title).toBe("할 일 3");
  });

  it("쓰다 끊긴 내 파일 뒤에 이어 쓸 때 줄이 섞이지 않음", async () => {
    const fs = new MemoryFs();
    const pc = await Replica.open(fs, { deviceId: "pc" });
    pc.create("task", { day: "2026-10-15", title: "a" });
    await pc.flush();
    const path = [...fs.files.keys()].find((p) => p.startsWith("log/pc/"))!;
    fs.files.set(path, fs.files.get(path)! + '{"op":"set","id":"x'); // 강제 종료로 반쯤 쓴 줄
    const pc2 = await Replica.open(fs, { deviceId: "pc" });
    const id = pc2.create("task", { day: "2026-10-15", title: "b" });
    await pc2.flush();
    const parsed = parseLog(fs.files.get(path)!);
    expect(parsed.bad).toBe(1);
    expect(parsed.ops.map((o) => o.id)).toContain(id);
  });

  it("세 기기 · 무작위 수정 · 늦거나 덜 받는 드라이브 → 마지막엔 모두 같은 상태", async () => {
    for (let seed = 1; seed <= 15; seed++) {
      const r = rng(seed);
      const drive = new Drive();
      const clk = manualClock();
      const names = ["pc", "laptop", "phone"];
      const skew: Record<string, number> = { pc: 0, laptop: 4000, phone: -7000 };
      const devs = new Map<string, Replica>();
      for (const n of names) {
        devs.set(n, await drive.device(n, clk.wall(skew[n])));
        drive.upload(n);
      }
      for (let step = 0; step < 250; step++) {
        clk.tick(r.int(500));
        const n = r.pick(names);
        const d = devs.get(n)!;
        const tasks = d.list("task");
        const x = r.next();
        if (x < 0.25 || !tasks.length) {
          d.create("task", { day: "2026-10-15", title: `${n}-${step}`, done: false });
        } else if (x < 0.45) {
          d.update<"task">(r.pick(tasks).id, { title: `${n}-고침-${step}` });
        } else if (x < 0.6) {
          d.update<"task">(r.pick(tasks).id, { done: r.chance(0.5) });
        } else if (x < 0.67) {
          d.remove(r.pick(tasks).id);
        } else if (x < 0.75) {
          const t = r.pick(tasks).id;
          if (r.chance(0.5)) startTimer(d, t, clk.now());
          else stopTask(d, t, clk.now());
        } else if (x < 0.85) {
          const j = d.list("journal")[0];
          if (j) d.update<"journal">(j.id, { text: `${n} 일기 ${step}` });
          else d.create("journal", { day: "2026-10-15", text: `${n} 첫 일기` }, "journal-2026-10-15");
        } else if (x < 0.95) {
          await d.sync();
          drive.upload(n);
          drive.download(n, r);
        } else {
          drive.download(n, r);
          await d.pull();
        }
      }
      // 모두 올리고 · 모두 받고 · 모두 읽음
      for (const n of names) {
        await devs.get(n)!.flush();
        drive.upload(n);
      }
      for (const n of names) {
        drive.download(n);
        await devs.get(n)!.pull();
      }
      const [a, b, c] = names.map((n) => devs.get(n)!);
      same(a!, b!);
      same(a!, c!);

      // 모든 기록을 시각 순으로 처음부터 다시 반영한 것과도 같음
      const all: Op[] = [];
      for (const [p, text] of drive.cloud.files) if (p.startsWith("log/")) all.push(...parseLog(text).ops);
      const fresh = new State();
      for (const op of all.sort((x, y) => (x.t < y.t ? -1 : 1))) fresh.apply(op);
      expect(JSON.stringify(a!.dump())).toBe(JSON.stringify(fresh.dump()));
    }
  });
});

describe("바뀐 파일만 읽기", () => {
  it("크기가 그대로인 기록 파일은 다시 읽지 않고, 늘어나면 새 줄만", async () => {
    const fs = new MemoryFs();
    const pc = await Replica.open(fs, { deviceId: "pc" });
    const phone = await Replica.open(fs, { deviceId: "phone" });
    pc.create("task", { day: "2026-10-15", title: "a" });
    await pc.sync();
    const reads: string[] = [];
    const orig = fs.read.bind(fs);
    fs.read = async (p) => {
      reads.push(p);
      return orig(p);
    };
    await phone.pull();
    const first = reads.filter((p) => p.startsWith("log/")).length;
    reads.length = 0;
    await phone.pull();
    expect(reads.filter((p) => p.startsWith("log/"))).toEqual([]); // 바뀐 게 없음
    pc.create("task", { day: "2026-10-15", title: "b" });
    await pc.flush();
    await phone.pull();
    expect(reads.filter((p) => p.startsWith("log/"))).toHaveLength(1);
    expect(first).toBe(1);
    expect(phone.list("task")).toHaveLength(2);
  });
});

describe("스냅샷 · 기기 안 저장 · 보관함", () => {
  it("새 기기는 스냅샷 + 이후 기록으로 같은 상태", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    for (let i = 0; i < 50; i++) {
      clk.tick(1);
      pc.create("task", { day: "2026-10-15", title: `할 일 ${i}` });
    }
    await pc.writeSnapshot();
    clk.tick(1);
    pc.create("task", { day: "2026-10-16", title: "스냅샷 뒤에 만든 것" });
    await pc.sync();

    const fresh = await Replica.open(fs, { deviceId: "laptop", wall: clk.now });
    expect(fresh.list("task")).toHaveLength(50); // 기록 안 읽고도 스냅샷으로
    await fresh.pull();
    same(fresh, pc);
    expect(fresh.list("task")).toHaveLength(51);
  });

  it("기기 안 저장 → 다시 열면 이어서 (보내지 못한 변경 포함)", async () => {
    const fs = new MemoryFs();
    const clk = manualClock();
    const pc = await Replica.open(fs, { deviceId: "pc", wall: clk.now });
    const a = pc.create("task", { day: "2026-10-15", title: "보냄" });
    await pc.sync();
    const b = pc.create("task", { day: "2026-10-15", title: "아직 안 보냄" });
    const local = JSON.parse(JSON.stringify(pc.exportLocal()));
    const again = await Replica.open(fs, { deviceId: "pc", wall: () => clk.now() - 10_000, local });
    expect(again.pendingCount()).toBe(1);
    const c = again.create("task", { day: "2026-10-15", title: "다시 연 뒤" });
    expect(again.dump().find((e) => e.id === c)!.created > again.dump().find((e) => e.id === b)!.created).toBe(true);
    await again.sync();
    const phone = await Replica.open(fs, { deviceId: "phone" });
    await phone.pull();
    expect(phone.list("task").map((t) => t.id).sort()).toEqual([a, b, c].sort());
  });

  it("새 형식 보관함 · 잠근 보관함은 열지 않음", async () => {
    const fs = new MemoryFs();
    fs.files.set("vault.json", JSON.stringify({ format: 2, vaultId: "x", createdAt: 0, encryption: null }));
    await expect(Replica.open(fs, { deviceId: "pc" })).rejects.toBeInstanceOf(VaultError);
    fs.files.set("vault.json", JSON.stringify({ format: 1, vaultId: "x", createdAt: 0, encryption: { kdf: "argon2id", salt: "", check: "" } }));
    await expect(Replica.open(fs, { deviceId: "pc" })).rejects.toThrow("비밀번호");
  });

  it("칸 이름 검사 · 하위 칸 펼치기", async () => {
    const rep = await Replica.open(new MemoryFs(), { deviceId: "pc" });
    const id = rep.create("record", { collection: "date", title: "100일", f: { where: "성수", rating: 5 } });
    rep.update<"record">(id, { f: { rating: 4 } });
    expect(rep.get<"record">(id)!.f).toEqual({ where: "성수", rating: 4 });
    expect(() => rep.put("x", "task", { "bad key": 1 })).toThrow();
    expect(() => rep.update("없음", {})).toThrow();
  });

  it("바뀌면 알려 줌", async () => {
    const fs = new MemoryFs();
    const pc = await Replica.open(fs, { deviceId: "pc" });
    const phone = await Replica.open(fs, { deviceId: "phone" });
    let n = 0;
    const off = phone.subscribe(() => n++);
    pc.create("task", { day: "2026-10-15", title: "a" });
    await pc.sync();
    await phone.pull();
    phone.create("task", { day: "2026-10-15", title: "b" });
    expect(n).toBe(2);
    off();
    phone.create("task", { day: "2026-10-15", title: "c" });
    expect(n).toBe(2);
  });
});
