/**
 * PC 용: 동기화 앱(OneDrive · Google Drive)이 만든 폴더를 그대로 읽고 씀. Node 전용 (Tauri 에선 P2 에서 플러그인으로).
 */
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { V1_FILES, type V1Data } from "./import-v1.ts";
import type { VaultFs } from "./vault.ts";

export class NodeFs implements VaultFs {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private abs(path: string): string {
    if (path.split("/").some((p) => p === ".." || p === "")) throw new Error(`잘못된 경로: ${path}`);
    return join(this.root, ...path.split("/"));
  }

  async read(path: string): Promise<string | null> {
    try {
      return await readFile(this.abs(path), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  /** 임시 파일에 쓰고 바꿔치기 — 드라이브가 반쯤 쓴 파일을 올리지 않게 */
  async write(path: string, text: string): Promise<void> {
    const p = this.abs(path);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, p);
  }

  async listSizes(prefix: string): Promise<{ path: string; size: number }[]> {
    const out: { path: string; size: number }[] = [];
    for (const path of await this.list(prefix)) {
      try {
        out.push({ path, size: (await stat(this.abs(path))).size });
      } catch {
        // 그 사이 사라진 파일
      }
    }
    return out;
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.abs(path)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const p = this.abs(path);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, p);
  }

  async append(path: string, text: string): Promise<void> {
    const p = this.abs(path);
    await mkdir(dirname(p), { recursive: true });
    await appendFile(p, text, "utf8");
  }

  async list(prefix: string): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.root, { recursive: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return names
      .map((n) => n.split(/[\\/]/).join("/"))
      .filter((p) => p.startsWith(prefix) && !p.endsWith(".tmp"))
      .sort();
  }
}

/** v1 이 쓰는 데이터 폴더: %APPDATA%\DailyTodo\location.json 이 가리키는 곳, 없으면 %APPDATA%\DailyTodo */
export async function findV1Folder(): Promise<string | null> {
  const appdata = process.env.APPDATA;
  if (!appdata) return null;
  const local = join(appdata, "DailyTodo");
  try {
    const loc = JSON.parse(await readFile(join(local, "location.json"), "utf8")) as { data_dir?: string };
    if (loc.data_dir) return loc.data_dir;
  } catch {
    // location.json 이 없으면 기본 위치
  }
  return local;
}

/** v1 데이터 폴더의 JSON 들을 읽음 (읽기만) */
export async function readV1Folder(dir: string): Promise<V1Data> {
  const out: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(V1_FILES)) {
    try {
      out[key] = JSON.parse(await readFile(join(dir, file), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${file} 을 읽을 수 없음: ${String(e)}`);
    }
  }
  return out as V1Data;
}
