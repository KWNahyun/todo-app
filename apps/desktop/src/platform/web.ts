/**
 * 브라우저용 (화면 미리보기 · 개발). 보관함은 localStorage 안의 가짜 폴더,
 * 위젯 · 메인 창은 같은 주소의 ?view=widget / ?view=main 탭, 창 사이 알림은 BroadcastChannel.
 */
import { MemoryFs, type VaultFs } from "@dailytodo/core";
import { fromBase64, toBase64 } from "./base64.ts";
import type { Config, PeerEvent, Platform, Screen, WindowKind } from "./types.ts";

const KEY = "dt-v2-web";

function load<T>(k: string): T | null {
  try {
    const s = localStorage.getItem(`${KEY}:${k}`);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function save(k: string, v: unknown): void {
  try {
    localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v));
  } catch {
    // 저장 공간이 없어도 화면은 계속
  }
}

/** 파일 하나 = localStorage 키 하나 → 두 탭이 같은 "폴더"를 봄. 저장이 안 되는 환경이면 메모리로 */
class StoredFs implements VaultFs {
  private mem = new MemoryFs();
  private k = (p: string) => `${KEY}:file:${p}`;
  async read(path: string) {
    try {
      return localStorage.getItem(this.k(path)) ?? (await this.mem.read(path));
    } catch {
      return this.mem.read(path);
    }
  }
  async write(path: string, text: string) {
    await this.mem.write(path, text);
    try {
      localStorage.setItem(this.k(path), text);
    } catch {
      // 메모리에만
    }
  }
  async append(path: string, text: string) {
    await this.write(path, ((await this.read(path)) ?? "") + text);
  }
  async readBytes(path: string) {
    const s = await this.read(`${path}.b64`);
    return s == null ? null : fromBase64(s);
  }
  async writeBytes(path: string, bytes: Uint8Array) {
    await this.write(`${path}.b64`, toBase64(bytes));
  }
  async list(prefix: string) {
    const out = new Set(await this.mem.list(prefix));
    try {
      const head = this.k("");
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(head) && key.slice(head.length).startsWith(prefix)) out.add(key.slice(head.length));
      }
    } catch {
      // 메모리 것만
    }
    return [...out].map((p) => p.replace(/\.b64$/, "")).sort();
  }
}

export function webPlatform(): Platform {
  const kind: WindowKind = new URLSearchParams(location.search).get("view") === "widget" ? "widget" : "main";
  const ch = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(KEY) : null;
  return {
    kind: "web",
    window: kind,
    async readConfig() {
      let c = load<Config>("config");
      if (!c) {
        c = { deviceBase: `web-${Math.random().toString(36).slice(2, 10)}`, deviceName: "브라우저" };
        save("config", c);
      }
      return c;
    },
    async writeConfig(c) {
      save("config", c);
    },
    async readLocal() {
      return load<string>(`local-${kind}`);
    },
    async writeLocal(text) {
      save(`local-${kind}`, text);
    },
    async defaultVaultRoot() {
      return "브라우저 저장소";
    },
    vaultFs() {
      return new StoredFs();
    },
    async readV1() {
      return null;
    },
    on(event: PeerEvent, cb) {
      const h = (e: MessageEvent<{ event: PeerEvent; from: WindowKind; payload?: string }>) => {
        if (e.data.event === event && e.data.from !== kind) cb(e.data.payload);
      };
      ch?.addEventListener("message", h);
      return () => ch?.removeEventListener("message", h);
    },
    emit(event, payload) {
      ch?.postMessage({ event, from: kind, payload });
    },
    async showMain(screen?: Screen) {
      if (kind === "main") return;
      window.open(`?view=main${screen ? `#${screen}` : ""}`, "dt-main");
    },
    async setPin() {},
    async setHotkeys() {
      return []; // 브라우저엔 전역 단축키가 없음
    },
    async idleSeconds() {
      return 0;
    },
    async showWidget() {
      window.focus();
    },
    async readImageFile() {
      throw new Error("브라우저에서는 PC 파일을 바로 읽을 수 없어요");
    },
    async notify(title, body) {
      try {
        if (typeof Notification === "undefined") return;
        if (Notification.permission === "default") await Notification.requestPermission();
        if (Notification.permission === "granted") new Notification(title, { body });
      } catch {
        // 알림을 못 띄우는 환경
      }
    },
    async minimize() {},
    async close() {},
  };
}
