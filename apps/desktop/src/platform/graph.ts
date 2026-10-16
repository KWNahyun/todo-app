/**
 * 휴대폰: OneDrive 앱 전용 폴더를 Microsoft Graph 로 읽고 씀 (설계 8장).
 * - 로그인: 기기 코드 흐름 (앱이 코드를 보여 주고, 브라우저에서 microsoft.com/devicelogin 에 넣음)
 * - 권한: Files.ReadWrite.AppFolder (앱 전용 폴더만 — 다른 파일은 못 봄) + offline_access (다시 로그인 안 하게)
 * - 앱 전용 폴더 = OneDrive/앱/<앱 등록 이름>. 등록 이름을 DailyTodo 로 하면 PC 의 보관함과 같은 폴더.
 * 동기화 로직은 core 그대로 — 여기는 VaultFs 모양만 맞춤.
 */
import type { VaultFs } from "@dailytodo/core";

/** fetch 와 같은 모양 (Tauri http 플러그인 · 테스트용 가짜) */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<any>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export const AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
export const SCOPE = "Files.ReadWrite.AppFolder offline_access";
export const ROOT = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
/** 한 번에 올릴 수 있는 크기 (넘으면 업로드 세션) */
const SIMPLE_MAX = 4 * 1024 * 1024;

export interface Tokens {
  access: string;
  refresh: string;
  /** 만료 시각 (epoch ms) */
  expires: number;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresAt: number;
}

const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export async function startDeviceLogin(f: Fetch, clientId: string, now = Date.now()): Promise<DeviceCode> {
  const r = await f(`${AUTH}/devicecode`, { method: "POST", headers: FORM, body: form({ client_id: clientId, scope: SCOPE }) });
  const j = await r.json();
  if (r.status !== 200) throw new Error(j.error_description ?? `로그인을 시작하지 못했어요 (${r.status})`);
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, interval: j.interval ?? 5, expiresAt: now + j.expires_in * 1000 };
}

function toTokens(j: any, now: number): Tokens {
  return { access: j.access_token, refresh: j.refresh_token, expires: now + (j.expires_in ?? 3600) * 1000 };
}

/** 사용자가 코드를 넣을 때까지 기다리는 동안: "pending" · 끝나면 Tokens */
export async function pollDeviceLogin(f: Fetch, clientId: string, deviceCode: string, now = Date.now()): Promise<Tokens | "pending"> {
  const r = await f(`${AUTH}/token`, {
    method: "POST",
    headers: FORM,
    body: form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: clientId, device_code: deviceCode }),
  });
  const j = await r.json();
  if (r.status === 200) return toTokens(j, now);
  if (j.error === "authorization_pending" || j.error === "slow_down") return "pending";
  throw new Error(j.error === "expired_token" ? "코드 시간이 지났어요. 다시 시작해 주세요." : j.error_description ?? j.error ?? "로그인하지 못했어요");
}

export async function refreshTokens(f: Fetch, clientId: string, refresh: string, now = Date.now()): Promise<Tokens> {
  const r = await f(`${AUTH}/token`, { method: "POST", headers: FORM, body: form({ grant_type: "refresh_token", client_id: clientId, refresh_token: refresh, scope: SCOPE }) });
  const j = await r.json();
  if (r.status !== 200) throw new AuthError(j.error_description ?? "다시 로그인해 주세요");
  return toTokens(j, now);
}

export class AuthError extends Error {}

/** 토큰 관리: 만료 2분 전에 미리 새로 받음, 바뀌면 save 로 기기 안에 저장 */
export class TokenSource {
  private t: Tokens;
  private f: Fetch;
  private clientId: string;
  private save: (t: Tokens) => Promise<void>;
  private now: () => number;
  private pending: Promise<string> | null = null;
  constructor(f: Fetch, clientId: string, t: Tokens, save: (t: Tokens) => Promise<void>, now = Date.now) {
    this.f = f;
    this.clientId = clientId;
    this.t = t;
    this.save = save;
    this.now = now;
  }
  get = (): Promise<string> => {
    if (this.t.expires - this.now() > 120_000) return Promise.resolve(this.t.access);
    // 여러 요청이 동시에 와도 새로 받기는 한 번만
    this.pending ??= refreshTokens(this.f, this.clientId, this.t.refresh, this.now()).then(async (t) => {
      this.t = t;
      await this.save(t);
      this.pending = null;
      return t.access;
    }, (e) => {
      this.pending = null;
      throw e;
    });
    return this.pending;
  };
}

/** "log/pc-1/2026-10.ndjson" → 경로 조각마다 인코딩 */
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export class GraphFs implements VaultFs {
  private f: Fetch;
  private token: () => Promise<string>;
  private sleep: (ms: number) => Promise<void>;

  constructor(f: Fetch, token: () => Promise<string>, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.f = f;
    this.token = token;
    this.sleep = sleep;
  }

  /** 429 · 5xx 는 Retry-After 만큼 기다렸다 다시 (최대 4번) */
  private async call(url: string, init: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array } = {}) {
    for (let i = 0; ; i++) {
      const r = await this.f(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...init.headers } });
      if ((r.status === 429 || r.status >= 500) && i < 4) {
        const wait = Number(r.headers.get("Retry-After") ?? 0) * 1000 || 500 * 2 ** i;
        await this.sleep(Math.min(wait, 30_000));
        continue;
      }
      if (r.status === 401) throw new AuthError("OneDrive 연결이 끊겼어요. 다시 로그인해 주세요.");
      return r;
    }
  }

  private content = (path: string) => `${ROOT}:/${enc(path)}:/content`;

  async read(path: string): Promise<string | null> {
    const r = await this.call(this.content(path));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`읽지 못했어요 ${path} (${r.status})`);
    return new TextDecoder().decode(await r.arrayBuffer());
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const r = await this.call(this.content(path));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`읽지 못했어요 ${path} (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }

  private async put(path: string, body: Uint8Array, type: string): Promise<void> {
    if (body.length <= SIMPLE_MAX) {
      const r = await this.call(this.content(path), { method: "PUT", headers: { "Content-Type": type }, body });
      if (r.status !== 200 && r.status !== 201) throw new Error(`쓰지 못했어요 ${path} (${r.status})`);
      return;
    }
    // 큰 파일 (스냅샷 등): 업로드 세션으로 조각조각
    const s = await this.call(`${ROOT}:/${enc(path)}:/createUploadSession`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
    });
    const { uploadUrl } = await s.json();
    const CHUNK = 320 * 1024 * 10; // 3.2MB (320KB 의 배수)
    for (let at = 0; at < body.length; at += CHUNK) {
      const part = body.subarray(at, Math.min(at + CHUNK, body.length));
      const r = await this.f(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${at}-${at + part.length - 1}/${body.length}` }, body: part });
      if (r.status >= 300 && r.status !== 202) throw new Error(`올리지 못했어요 ${path} (${r.status})`);
    }
  }

  write(path: string, text: string): Promise<void> {
    return this.put(path, new TextEncoder().encode(text), "text/plain; charset=utf-8");
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.put(path, bytes, "application/octet-stream");
  }

  /** Graph 엔 덧붙이기가 없어서 읽고 다시 씀 — 휴대폰은 자기 기록 파일에만 쓰므로 겹칠 일이 없음 */
  async append(path: string, text: string): Promise<void> {
    await this.write(path, ((await this.read(path)) ?? "") + text);
  }

  /** 폴더 하나의 자식들 (다음 쪽까지) */
  private async children(dir: string): Promise<{ name: string; size: number; folder: boolean }[]> {
    const out: { name: string; size: number; folder: boolean }[] = [];
    let url: string | null = `${dir ? `${ROOT}:/${enc(dir)}:` : ROOT}/children?$select=name,size,folder,file&$top=999`;
    while (url) {
      const r = await this.call(url);
      if (r.status === 404) return out;
      if (r.status !== 200) throw new Error(`목록을 읽지 못했어요 ${dir} (${r.status})`);
      const j = await r.json();
      for (const x of j.value ?? []) out.push({ name: x.name, size: x.size ?? 0, folder: !!x.folder });
      url = j["@odata.nextLink"] ?? null;
    }
    return out;
  }

  async listSizes(prefix: string): Promise<{ path: string; size: number }[]> {
    const start = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    const out: { path: string; size: number }[] = [];
    const walk = async (dir: string) => {
      for (const c of await this.children(dir)) {
        const p = dir ? `${dir}/${c.name}` : c.name;
        if (c.folder) {
          if (p.startsWith(prefix) || prefix.startsWith(`${p}/`)) await walk(p);
        } else if (p.startsWith(prefix)) out.push({ path: p, size: c.size });
      }
    };
    await walk(start);
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async list(prefix: string): Promise<string[]> {
    return (await this.listSizes(prefix)).map((x) => x.path);
  }

  /** 앱 전용 폴더 정보 (설정에 "OneDrive/앱/DailyTodo" 처럼 보여 줌) */
  async whereAmI(): Promise<string> {
    const r = await this.call(`${ROOT}?$select=name,parentReference`);
    const j = await r.json();
    const parent = String(j.parentReference?.path ?? "").replace(/^\/drive\/root:?/, "");
    return `OneDrive${decodeURIComponent(parent)}/${j.name}`;
  }
}
