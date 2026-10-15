import { MemoryFs } from "../src/vault.ts";
import { Replica } from "../src/replica.ts";

/** 시드로 늘 같은 난수 (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  };
}

/** 손으로 돌리는 벽시계. skew 로 기기마다 시계가 틀린 상황도 만듦 */
export function manualClock(start = 1_792_000_000_000) {
  let t = start;
  return {
    now: () => t,
    tick: (ms = 1) => (t += ms),
    wall: (skew = 0) => () => t + skew,
  };
}

/**
 * 클라우드 드라이브 흉내. 기기마다 자기 폴더(MemoryFs)가 있고,
 * upload 는 그 기기가 쓴 파일을 클라우드로, download 는 남의 파일을 기기로 복사.
 * partial 이면 남의 파일을 중간까지만 받음 (드라이브가 받는 중인 상황).
 */
export class Drive {
  cloud = new MemoryFs();
  folders = new Map<string, MemoryFs>();

  folder(device: string): MemoryFs {
    let f = this.folders.get(device);
    if (!f) this.folders.set(device, (f = new MemoryFs()));
    return f;
  }

  private owns(device: string, path: string): boolean {
    return path.startsWith(`log/${device}/`) || path === `devices/${device}.json` || path === `snapshots/${device}.json`;
  }

  upload(device: string): void {
    for (const [p, text] of this.folder(device).files) {
      // vault.json 은 먼저 올린 쪽이 이김 (실제 드라이브처럼)
      if (this.owns(device, p) || !this.cloud.files.has(p)) this.cloud.files.set(p, text);
    }
  }

  download(device: string, r?: ReturnType<typeof rng>): void {
    const mine = this.folder(device);
    for (const [p, text] of this.cloud.files) {
      if (this.owns(device, p)) continue;
      const have = mine.files.get(p) ?? "";
      if (r && text.length > have.length && r.chance(0.5)) {
        // 덧붙이기만 하는 파일이라 받는 중인 파일 = 앞부분
        const cut = have.length + r.int(text.length - have.length + 1);
        mine.files.set(p, text.slice(0, cut));
      } else {
        mine.files.set(p, text);
      }
    }
  }

  async device(id: string, wall: () => number): Promise<Replica> {
    return Replica.open(this.folder(id), { deviceId: id, wall });
  }
}
