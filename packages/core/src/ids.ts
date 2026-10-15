/** 항목 ID 와 기기 ID. 브라우저 · Tauri 웹뷰 · Node 모두에 있는 Web Crypto 만 씀. */

function toUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** UUIDv7: 앞 48비트가 만든 시각(ms)이라 시간 순으로 정렬됨. 어느 기기에서 만들어도 겹치지 않음. */
export function uuidv7(ms: number = Date.now(), rand?: Uint8Array): string {
  const b = new Uint8Array(16);
  let t = Math.floor(ms);
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b.set(rand ?? crypto.getRandomValues(new Uint8Array(10)), 6);
  b[6] = 0x70 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  return toUuid(b);
}

/**
 * 이름에서 늘 같은 ID (UUIDv8, SHA-256 앞 16바이트).
 * v1 가져오기에 씀 — 같은 v1 기록은 몇 번 가져와도 같은 항목이 되어 중복이 안 생김.
 */
export async function nameId(name: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)));
  const b = d.slice(0, 16);
  b[6] = 0x80 | (b[6]! & 0x0f);
  b[8] = 0x80 | (b[8]! & 0x3f);
  return toUuid(b);
}

/** 새 기기 ID. 예) "pc-k3x9q2ma" */
export function newDeviceId(kind: string = "pc"): string {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyz";
  const r = crypto.getRandomValues(new Uint8Array(8));
  return `${kind}-${Array.from(r, (x) => abc[x % 36]).join("")}`;
}
