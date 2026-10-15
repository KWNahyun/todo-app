/**
 * 하이브리드 논리 시계(HLC). 변경 하나하나에 붙는 시각표.
 *
 * 문자열 모양: "벽시계ms(13자리):순번(4자리):기기ID"  예) "1729000000123:0004:pc-1"
 * 앞 두 부분이 고정 길이라 **문자열 비교 = 시각 순서** (같으면 기기ID 로 결정 → 모든 기기가 같은 순서).
 * 기기 시계가 조금 틀려도, 받은 시각보다 항상 뒤의 시각을 만들어서 순서가 뒤집히지 않음.
 */

export type Hlc = string;

export interface HlcParts {
  ms: number;
  c: number;
  node: string;
}

export const NODE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const HLC_RE = /^(\d{13}):(\d{4}):([A-Za-z0-9_-]{1,64})$/;
const MAX_COUNTER = 9999;

export function formatHlc(p: HlcParts): Hlc {
  return `${String(p.ms).padStart(13, "0")}:${String(p.c).padStart(4, "0")}:${p.node}`;
}

export function isHlc(t: unknown): t is Hlc {
  return typeof t === "string" && HLC_RE.test(t);
}

export function parseHlc(t: Hlc): HlcParts {
  const m = HLC_RE.exec(t);
  if (!m) throw new Error(`HLC 형식이 아님: ${t}`);
  return { ms: Number(m[1]), c: Number(m[2]), node: m[3]! };
}

export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const maxHlc = (a: Hlc, b: Hlc): Hlc => (a > b ? a : b);

/** 이 기기의 시계. now() 는 매번 이전보다 큰 시각을 줌. */
export class Clock {
  readonly node: string;
  private wall: () => number;
  private maxDriftMs: number;
  private ms = 0;
  private c = 0;

  /**
   * @param last 지난번에 쓴 마지막 시각 (앱을 다시 켤 때 이어가기)
   * @param maxDriftMs 다른 기기 시계가 이만큼 넘게 미래면 따라가지 않음 (그 기기 시계 고장 대비)
   */
  constructor(node: string, opts: { wall?: () => number; last?: Hlc | null; maxDriftMs?: number } = {}) {
    if (!NODE_RE.test(node)) throw new Error(`기기ID 는 영문 · 숫자 · - · _ 만: ${node}`);
    this.node = node;
    this.wall = opts.wall ?? Date.now;
    this.maxDriftMs = opts.maxDriftMs ?? 24 * 3600_000;
    if (opts.last) this.observe(parseHlc(opts.last));
  }

  now(): Hlc {
    const w = Math.floor(this.wall());
    if (w > this.ms) {
      this.ms = w;
      this.c = 0;
    } else if (++this.c > MAX_COUNTER) {
      this.ms += 1; // 같은 1ms 안에 1만 번 넘게 쓰면 논리적으로 1ms 앞으로
      this.c = 0;
    }
    return formatHlc({ ms: this.ms, c: this.c, node: this.node });
  }

  /** 다른 기기의 시각을 봤음 → 다음 now() 는 그보다 뒤. */
  receive(t: Hlc): void {
    const r = parseHlc(t);
    if (r.ms > this.wall() + this.maxDriftMs) return;
    this.observe(r);
  }

  /** 지금까지 본 가장 늦은 시각 (저장해 두었다가 last 로 넘김). */
  last(): Hlc | null {
    return this.ms === 0 ? null : formatHlc({ ms: this.ms, c: this.c, node: this.node });
  }

  private observe(r: HlcParts): void {
    if (r.ms > this.ms || (r.ms === this.ms && r.c > this.c)) {
      this.ms = r.ms;
      this.c = r.c;
    }
  }
}
