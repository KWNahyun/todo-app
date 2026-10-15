/**
 * 앱 상태: 복제본 하나(창마다) + 동기화 + 설정. 화면은 useApp() 으로 꺼내 씀.
 *
 * 동기화 흐름 (설계 7장):
 * - 내가 바꿈 → 화면 즉시 → 0.4초 모아서 보관함에 덧붙임 → 다른 창에 "바뀜" 알림
 * - 다른 창 알림 · 창이 앞으로 옴 · 15초마다 → 보관함에서 새 줄만 읽어 합침
 * - 이 창의 상태는 2초 모아서 앱 데이터 폴더에 (다음에 켤 때 빨리)
 */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Replica, VaultError, type LocalState } from "@dailytodo/core";
import type { Config, Platform, ThemeName } from "../platform/index.ts";
import { Actions } from "./actions.ts";

export interface SyncStatus {
  state: "ok" | "syncing" | "error";
  last: number | null;
  error?: string;
}

/** 보관함과 주고받기. React 밖에서 돌고, 상태만 화면에 알림 */
export class SyncEngine {
  status: SyncStatus = { state: "syncing", last: null };
  private rep: Replica;
  private platform: Platform;
  private vaultRoot: string;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(rep: Replica, platform: Platform, vaultRoot: string) {
    this.rep = rep;
    this.platform = platform;
    this.vaultRoot = vaultRoot;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private set(s: SyncStatus) {
    this.status = s;
    for (const fn of this.listeners) fn();
  }

  /** 한 번에 하나씩 (flush 와 pull 이 겹치지 않게) */
  private run(fn: () => Promise<unknown>): Promise<void> {
    this.queue = this.queue.then(async () => {
      try {
        await fn();
        this.set({ state: "ok", last: Date.now() });
      } catch (e) {
        this.set({ ...this.status, state: "error", error: String(e) });
      }
    });
    return this.queue;
  }

  syncNow = () => this.run(() => this.rep.sync());
  pull = () => this.run(() => this.rep.pull());

  saveLocal = () => {
    const l = { ...this.rep.exportLocal(), vaultRoot: this.vaultRoot };
    void this.platform.writeLocal(JSON.stringify(l));
  };

  /** 동기화 고리 시작 → 멈추는 함수 */
  start(): () => void {
    let flushT: ReturnType<typeof setTimeout> | undefined;
    let saveT: ReturnType<typeof setTimeout> | undefined;
    const offRep = this.rep.subscribe(() => {
      clearTimeout(saveT);
      saveT = setTimeout(this.saveLocal, 2000);
      if (this.rep.pendingCount() > 0) {
        clearTimeout(flushT);
        flushT = setTimeout(() => {
          void this.run(async () => {
            if ((await this.rep.flush()) > 0) this.platform.emit("vault-changed");
          });
        }, 400);
      }
    });
    const offPeer = this.platform.on("vault-changed", () => void this.pull());
    const onFocus = () => void this.pull();
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", this.saveLocal);
    const every = setInterval(this.pull, 15_000);
    void this.syncNow();
    return () => {
      offRep();
      offPeer();
      clearInterval(every);
      clearTimeout(flushT);
      clearTimeout(saveT);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", this.saveLocal);
      this.saveLocal();
    };
  }
}

export interface AppValue {
  platform: Platform;
  config: Config;
  rep: Replica;
  actions: Actions;
  engine: SyncEngine;
  saveConfig(patch: Partial<Config>): Promise<void>;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppProvider 밖");
  return v;
}

/** 복제본이 바뀔 때마다 다시 그림 */
export function useData(): number {
  const { rep } = useApp();
  const ver = useRef(0);
  return useSyncExternalStore(
    (cb) =>
      rep.subscribe(() => {
        ver.current++;
        cb();
      }),
    () => ver.current,
  );
}

export function useSync(): SyncStatus {
  const { engine } = useApp();
  return useSyncExternalStore(engine.subscribe, () => engine.status);
}

/** 1초마다 (타이머 표시) — on 이 false 면 멈춤 */
export function useNow(on = true, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(h);
  }, [on, ms]);
  return now;
}

export function applyTheme(theme: ThemeName | undefined) {
  document.documentElement.dataset.theme = theme ?? "minimal";
}

async function boot(platform: Platform): Promise<Omit<AppValue, "saveConfig">> {
  const config = await platform.readConfig();
  if (!config.deviceBase) throw new Error("이 PC 의 ID 가 설정에 없어요");
  if (!config.vaultRoot) {
    config.vaultRoot = await platform.defaultVaultRoot();
    await platform.writeConfig(config);
  }
  applyTheme(config.theme);
  const deviceId = `${config.deviceBase}-${platform.window}`;
  let local: LocalState | undefined;
  try {
    const text = await platform.readLocal();
    const l = text ? (JSON.parse(text) as LocalState & { vaultRoot?: string }) : undefined;
    // 보관함을 바꿨으면 예전 상태는 버리고 새 보관함에서 다시 만듦
    if (l && l.deviceId === deviceId && l.vaultRoot === config.vaultRoot) local = l;
  } catch {
    // 깨진 기기 안 저장 → 보관함에서 다시 만듦
  }
  const rep = await Replica.open(platform.vaultFs(config.vaultRoot), {
    deviceId,
    name: `${config.deviceName} · ${platform.window === "widget" ? "위젯" : "메인 창"}`,
    kind: "pc",
    local,
  });
  return {
    platform,
    config,
    rep,
    actions: new Actions(rep, config.deviceBase),
    engine: new SyncEngine(rep, platform, config.vaultRoot),
  };
}

export function AppProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [app, setApp] = useState<Omit<AppValue, "saveConfig"> | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    boot(platform).then(setApp, (e: unknown) =>
      setFatal(e instanceof VaultError ? e.message : `시작하지 못했어요: ${String(e)}`),
    );
  }, [platform]);

  const engine = app?.engine;
  useEffect(() => engine?.start(), [engine]);

  // 다른 창에서 설정을 바꾸면 따라감
  const root = app?.config.vaultRoot;
  useEffect(() => {
    if (!root) return;
    return platform.on("config-changed", async () => {
      const c = await platform.readConfig();
      if (c.vaultRoot !== root) location.reload();
      else {
        applyTheme(c.theme);
        setApp((a) => (a ? { ...a, config: c } : a));
      }
    });
  }, [root, platform]);

  if (fatal) return <div className="fatal" role="alert"><b>Daily Todo</b><p>{fatal}</p></div>;
  if (!app) return <div className="loading">불러오는 중…</div>;

  const saveConfig = async (patch: Partial<Config>) => {
    const next = { ...(await platform.readConfig()), ...patch };
    await platform.writeConfig(next);
    platform.emit("config-changed");
    if (patch.vaultRoot && patch.vaultRoot !== app.config.vaultRoot) {
      app.engine.saveLocal();
      location.reload();
      return;
    }
    applyTheme(next.theme);
    setApp({ ...app, config: next });
  };

  return <Ctx.Provider value={{ ...app, saveConfig }}>{children}</Ctx.Provider>;
}
