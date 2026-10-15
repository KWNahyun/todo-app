/**
 * 보관함(클라우드 폴더) 접근. PC 는 동기화 폴더를 그대로(node-fs.ts), 휴대폰은 드라이브 API(P4),
 * 테스트는 메모리(MemoryFs) — 같은 모양이라 동기화 로직은 하나.
 *
 *   vault.json                  형식 버전 · 보관함 ID · 암호화 여부
 *   devices/<기기>.json          기기 이름 · 종류 · 마지막 접속
 *   log/<기기>/YYYY-MM.ndjson    그 기기의 변경 기록 (덧붙이기만)
 *   snapshots/<기기>.json        빠른 시작용 상태
 *   blobs/<sha256>.<확장자>       사진 · 첨부 (P3)
 */
import { uuidv7 } from "./ids.ts";

/** 경로는 보관함 기준 상대 경로, 구분자는 "/" */
export interface VaultFs {
  /** 없으면 null */
  read(path: string): Promise<string | null>;
  /** 통째로 쓰기 (자기 기기 파일만 씀) */
  write(path: string, text: string): Promise<void>;
  /** 끝에 덧붙이기 (없으면 만듦) */
  append(path: string, text: string): Promise<void>;
  /** prefix 로 시작하는 모든 파일 경로 */
  list(prefix: string): Promise<string[]>;
}

export class MemoryFs implements VaultFs {
  files = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }
  async write(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }
  async append(path: string, text: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + text);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }
}

export const VAULT_FORMAT = 1;

export interface VaultInfo {
  format: number;
  vaultId: string;
  createdAt: number;
  /** 비밀번호 잠금 (설계 9장) — 형식에 자리만, P1 은 null 만 지원 */
  encryption: null | { kdf: string; salt: string; check: string };
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind: string;
  lastSeen: number;
}

export class VaultError extends Error {}

/** vault.json 을 읽고, 없으면 새 보관함을 만듦. */
export async function ensureVault(fs: VaultFs, now: number = Date.now()): Promise<VaultInfo> {
  const text = await fs.read("vault.json");
  if (text === null) {
    const info: VaultInfo = { format: VAULT_FORMAT, vaultId: uuidv7(now), createdAt: now, encryption: null };
    await fs.write("vault.json", JSON.stringify(info, null, 2) + "\n");
    return info;
  }
  let info: VaultInfo;
  try {
    info = JSON.parse(text) as VaultInfo;
  } catch {
    throw new VaultError("vault.json 을 읽을 수 없음");
  }
  if (typeof info.format !== "number" || info.format > VAULT_FORMAT) {
    throw new VaultError(`이 보관함은 더 새 버전 앱의 형식(${info.format})이에요. 앱을 업데이트해 주세요.`);
  }
  if (info.encryption) throw new VaultError("비밀번호로 잠근 보관함은 아직 지원하지 않아요.");
  return info;
}
