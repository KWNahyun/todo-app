/**
 * 사진 · 첨부 = blobs/<sha256>.<확장자> (설계 4장). 내용 해시가 이름이라 한 번 쓰면 안 바뀌고,
 * 같은 사진을 두 기기에서 올려도 같은 파일 하나 → 충돌 없음.
 * 항목에는 이름(예: "3f2a….webp")만 적음.
 */
import type { VaultFs } from "./vault.ts";

const NAME_RE = /^[0-9a-f]{64}\.(webp|jpg|png)$/;

export function isBlobName(name: unknown): name is string {
  return typeof name === "string" && NAME_RE.test(name);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** 저장하고 이름을 돌려줌. 이미 있으면 다시 쓰지 않음 */
export async function putBlob(fs: VaultFs, bytes: Uint8Array, ext: "webp" | "jpg" | "png"): Promise<string> {
  const name = `${await sha256Hex(bytes)}.${ext}`;
  const path = `blobs/${name}`;
  if (!(await fs.list(path)).includes(path)) await fs.writeBytes(path, bytes);
  return name;
}

/** 이름으로 읽기. 다른 기기가 올린 사진을 드라이브가 아직 안 받았으면 null */
export async function getBlob(fs: VaultFs, name: string): Promise<Uint8Array | null> {
  if (!isBlobName(name)) throw new Error(`사진 이름이 잘못됨: ${name}`);
  return fs.readBytes(`blobs/${name}`);
}

/** 사진 하나 (원본은 저장 안 함 — 긴 변 2048px WebP + 400px 썸네일, 위치 정보 없음) */
export interface Photo {
  /** 2048px 본 사진 blob 이름 */
  id: string;
  /** 400px 썸네일 blob 이름 */
  thumb: string;
  w: number;
  h: number;
  /** 촬영 시각 (epoch ms, 알 수 없으면 없음) */
  takenAt?: number | null;
}
