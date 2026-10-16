/**
 * 휴대폰(Tauri 안드로이드)에서만: OneDrive 로그인 상태 · 토큰 저장 · Graph 보관함.
 * 토큰은 앱 전용 저장소(auth.json)에만 — 다른 앱은 못 읽음.
 */
import { invoke } from "@tauri-apps/api/core";
import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import { GraphFs, TokenSource, type Fetch, type Tokens } from "./graph.ts";

/**
 * Microsoft 에 등록한 앱의 '애플리케이션(클라이언트) ID' — 비밀이 아니라 앱 이름표 같은 것.
 * 등록 이름을 DailyTodo 로 해야 OneDrive/앱/DailyTodo(PC 보관함)와 같은 폴더가 됨.
 */
export const GRAPH_CLIENT_ID = "";

/** Tauri http 플러그인 → graph.ts 의 Fetch 모양 */
export const fetchViaRust: Fetch = async (url, init = {}) => {
  const r = await httpFetch(url, { method: init.method ?? "GET", headers: init.headers, body: init.body as BodyInit | undefined });
  return r;
};

export async function loadTokens(): Promise<Tokens | null> {
  const text = await invoke<string | null>("local_read", { name: "auth.json" });
  try {
    const t = text ? (JSON.parse(text) as Tokens) : null;
    return t?.refresh ? t : null;
  } catch {
    return null;
  }
}

export async function saveTokens(t: Tokens | null): Promise<void> {
  await invoke("local_write", { name: "auth.json", text: t ? JSON.stringify(t) : "" });
}

let source: TokenSource | null = null;

/** 보관함: 처음 쓸 때 저장해 둔 토큰을 읽어 TokenSource 를 만듦 */
export function phoneVault(): GraphFs {
  return new GraphFs(fetchViaRust, async () => {
    if (!source) {
      const t = await loadTokens();
      if (!t) throw new Error("OneDrive 에 로그인해 주세요");
      source = new TokenSource(fetchViaRust, GRAPH_CLIENT_ID, t, saveTokens);
    }
    return source.get();
  });
}
