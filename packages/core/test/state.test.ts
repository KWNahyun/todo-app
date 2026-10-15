import { describe, expect, it } from "vitest";
import { formatHlc } from "../src/hlc.ts";
import { encodeOps, logPath, parseLog, validateOp, type Op } from "../src/ops.ts";
import { State, expand } from "../src/state.ts";
import { rng } from "./helpers.ts";

const T = (ms: number, node = "pc", c = 0) => formatHlc({ ms, c, node });

function stateOf(ops: Op[]): State {
  const s = new State();
  for (const o of ops) s.apply(o);
  return s;
}

/** 무작위 변경 묶음 (같은 항목을 여러 기기가 고치고 지우고 되살림) */
function randomOps(seed: number, n: number): Op[] {
  const r = rng(seed);
  const ids = ["i1", "i2", "i3", "j1"];
  const nodes = ["pc", "phone", "mac"];
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    const id = r.pick(ids);
    // 일부러 같은 ms 를 많이 (실제 HLC 처럼 변경마다 시각은 다르게: 순번 = i)
    const t = T(1000 + r.int(50), r.pick(nodes), i);
    if (r.chance(0.15)) ops.push({ op: "del", id, t });
    else if (id === "j1") {
      const base = ops.filter((o) => o.op === "set" && o.id === "j1").map((o) => o.t);
      ops.push({ op: "set", id, type: "journal", f: { text: `글${i}` }, t, b: { text: base.length && r.chance(0.6) ? [r.pick(base)] : [] } });
    } else ops.push({ op: "set", id, type: "task", f: r.chance(0.5) ? { title: `제목${i}` } : { done: r.chance(0.5), [`x.k${r.int(3)}`]: i }, t });
  }
  return ops;
}

describe("합치기 규칙", () => {
  it("칸마다 따로: 제목 수정과 완료 체크가 둘 다 남음", () => {
    const s = stateOf([
      { op: "set", id: "a", type: "task", f: { title: "모델링", done: false }, t: T(1) },
      { op: "set", id: "a", type: "task", f: { title: "모델링 v2" }, t: T(5, "pc") },
      { op: "set", id: "a", type: "task", f: { done: true }, t: T(4, "phone") },
    ]);
    expect(s.get("a")).toMatchObject({ title: "모델링 v2", done: true });
  });

  it("같은 칸은 늦은 시각이 이김, 같은 시각이면 기기ID", () => {
    const s = stateOf([
      { op: "set", id: "a", type: "task", f: { title: "B" }, t: T(5, "b") },
      { op: "set", id: "a", type: "task", f: { title: "A" }, t: T(5, "a") },
    ]);
    expect(s.get("a")!.title).toBe("B");
  });

  it("지움: 더 늦은 set 이 없으면 지운 것, 있으면 되살아남", () => {
    const ops: Op[] = [
      { op: "set", id: "a", type: "task", f: { title: "x" }, t: T(1) },
      { op: "del", id: "a", t: T(2) },
    ];
    expect(stateOf(ops).get("a")).toBeUndefined();
    expect(stateOf([...ops, { op: "set", id: "a", type: "task", f: { done: true }, t: T(3) }]).get("a")).toMatchObject({ title: "x", done: true });
    // 지움이 먼저 도착해도 같음
    expect(stateOf([...ops].reverse()).get("a")).toBeUndefined();
  });

  it("순서를 바꿔도, 두 번 받아도 결과가 같음 (무작위 300 묶음)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const ops = randomOps(seed, 40);
      const want = JSON.stringify(stateOf(ops).dump());
      const r = rng(seed * 31);
      const shuffled = [...ops].sort(() => r.next() - 0.5);
      const twice = [...shuffled, ...ops.slice(0, 10)];
      expect(JSON.stringify(stateOf(twice).dump())).toBe(want);
    }
  });

  it("스냅샷을 합치면 변경을 다시 받은 것과 같음", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const ops = randomOps(seed, 40);
      const cut = 15;
      const a = stateOf(ops.slice(0, cut));
      const b = stateOf(ops.slice(cut));
      a.merge(b.dump());
      expect(JSON.stringify(a.dump())).toBe(JSON.stringify(stateOf(ops).dump()));
      // load 는 그대로 복원
      expect(JSON.stringify(State.load(a.dump()).dump())).toBe(JSON.stringify(a.dump()));
    }
  });

  it("점(.) 칸은 하위 객체로 펼침", () => {
    expect(expand({ "f.rating": 5, "f.where": "성수", title: "x", "a.0.1": true })).toEqual({
      f: { rating: 5, where: "성수" },
      title: "x",
      a: { "0": { "1": true } },
    });
  });
});

describe("일기처럼 덮이면 안 되는 칸", () => {
  it("이어서 고치면 충돌 없음", () => {
    const s = stateOf([
      { op: "set", id: "j", type: "journal", f: { day: "2026-10-15", text: "아침" }, t: T(1, "pc") },
      { op: "set", id: "j", type: "journal", f: { text: "아침 산책" }, t: T(2, "phone"), b: { text: [T(1, "pc")] } },
    ]);
    expect(s.get("j")!.text).toBe("아침 산책");
    expect(s.conflicts("j")).toEqual([]);
  });

  it("동시에 고치면 묻힌 쪽을 알려 줌 — 어느 순서로 받아도 같게", () => {
    const ops: Op[] = [
      { op: "set", id: "j", type: "journal", f: { day: "2026-10-15", text: "아침" }, t: T(1, "pc") },
      { op: "set", id: "j", type: "journal", f: { text: "아침 산책" }, t: T(3, "pc"), b: { text: [T(1, "pc")] } },
      { op: "set", id: "j", type: "journal", f: { text: "아침 코딩" }, t: T(2, "phone"), b: { text: [T(1, "pc")] } },
    ];
    for (const order of [ops, [...ops].reverse(), [ops[1]!, ops[2]!, ops[0]!]]) {
      const s = stateOf(order);
      expect(s.get("j")!.text).toBe("아침 산책");
      expect(s.conflicts("j")).toEqual([{ field: "text", value: "아침 코딩", t: T(2, "phone"), device: "phone" }]);
    }
  });

  it("둘 다 본 뒤 정하면 충돌이 사라짐", () => {
    const s = stateOf([
      { op: "set", id: "j", type: "journal", f: { text: "아침 산책" }, t: T(3, "pc") },
      { op: "set", id: "j", type: "journal", f: { text: "아침 코딩" }, t: T(2, "phone") },
      { op: "set", id: "j", type: "journal", f: { text: "아침 산책, 그리고 코딩" }, t: T(4, "pc"), b: { text: [T(2, "phone"), T(3, "pc")] } },
    ]);
    expect(s.conflicts("j")).toEqual([]);
  });

  it("값이 같으면 충돌로 치지 않음", () => {
    const s = stateOf([
      { op: "set", id: "j", type: "journal", f: { text: "같은 글" }, t: T(3, "pc") },
      { op: "set", id: "j", type: "journal", f: { text: "같은 글" }, t: T(2, "phone") },
    ]);
    expect(s.conflicts("j")).toEqual([]);
  });
});

describe("변경 기록 파일", () => {
  it("쓰고 읽기, 끝이 잘린 줄은 다음에", () => {
    const ops: Op[] = [
      { op: "set", id: "a", type: "task", f: { title: "한글 제목 \"따옴표\"\n줄바꿈" }, t: T(1) },
      { op: "del", id: "a", t: T(2) },
    ];
    const text = encodeOps(ops);
    expect(parseLog(text)).toEqual({ ops, lines: 2, bad: 0 });
    const cut = text.slice(0, text.length - 5);
    expect(parseLog(cut)).toEqual({ ops: [ops[0]], lines: 1, bad: 0 });
    expect(parseLog(text, 1)).toEqual({ ops: [ops[1]], lines: 2, bad: 0 });
  });

  it("깨진 줄 · 이상한 변경은 건너뜀", () => {
    const text = [
      "{not json",
      JSON.stringify({ op: "set", id: "a", type: "task", f: { __proto__x: 1 }, t: T(1) }),
      JSON.stringify({ op: "set", id: "a", type: "task", f: { id: "x" }, t: T(1) }),
      JSON.stringify({ op: "set", id: "a", type: "Task", f: {}, t: T(1) }),
      JSON.stringify({ op: "set", id: "a", type: "task", f: { ok: 1 }, t: "123" }),
      JSON.stringify({ op: "set", id: "a", type: "task", f: { ok: 1 }, t: T(1) }),
      "",
    ].join("\n");
    const r = parseLog(text);
    expect(r.ops).toHaveLength(1);
    expect(r.bad).toBe(5);
    expect(validateOp({ op: "set", id: "a", type: "task", f: { a: 1 }, t: T(1), b: { zz: [T(1)] } })).toBe(false);
  });

  it("달마다 파일 (UTC)", () => {
    expect(logPath("pc-1", T(Date.UTC(2026, 9, 31, 23, 59)))).toBe("log/pc-1/2026-10.ndjson");
    expect(logPath("pc-1", T(Date.UTC(2026, 10, 1)))).toBe("log/pc-1/2026-11.ndjson");
  });
});
