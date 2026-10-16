import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { V1Data, VaultFs } from "@dailytodo/core";
import type { Config, HotkeyAction, PeerEvent, PinMode, Platform, Screen, WindowKind } from "./types.ts";
import { fromBase64, toBase64 } from "./base64.ts";

class TauriVaultFs implements VaultFs {
  private root: string;
  constructor(root: string) {
    this.root = root;
  }
  read(path: string) {
    return invoke<string | null>("vault_read", { root: this.root, path });
  }
  write(path: string, text: string) {
    return invoke<void>("vault_write", { root: this.root, path, text });
  }
  append(path: string, text: string) {
    return invoke<void>("vault_append", { root: this.root, path, text });
  }
  list(prefix: string) {
    return invoke<string[]>("vault_list", { root: this.root, prefix });
  }
  async readBytes(path: string) {
    const b64 = await invoke<string | null>("vault_read_bytes", { root: this.root, path });
    return b64 == null ? null : fromBase64(b64);
  }
  writeBytes(path: string, bytes: Uint8Array) {
    return invoke<void>("vault_write_bytes", { root: this.root, path, b64: toBase64(bytes) });
  }
}

const V1_KEYS: Record<string, keyof V1Data> = {
  "tasks.json": "tasks",
  "events.json": "events",
  "deadlines.json": "deadlines",
  "goals.json": "goals",
  "habits.json": "habits",
  "moods.json": "moods",
  "journal.json": "journal",
  "mandalart.json": "mandalart",
  "collections.json": "collections",
};

export function tauriPlatform(): Platform {
  const win = getCurrentWindow();
  const kind = win.label as WindowKind;
  return {
    kind: "tauri",
    window: kind,
    async readConfig() {
      // Rust 가 처음이면 PC ID 를 만들어 둔 뒤 돌려줌 (두 창이 동시에 불러도 한 번만)
      const text = await invoke<string>("config_read");
      return JSON.parse(text.replace(/^﻿/, "")) as Config;
    },
    writeConfig(c: Config) {
      return invoke("local_write", { name: "config.json", text: JSON.stringify(c, null, 2) });
    },
    readLocal() {
      return invoke<string | null>("local_read", { name: `local-${kind}.json` });
    },
    writeLocal(text: string) {
      return invoke("local_write", { name: `local-${kind}.json`, text });
    },
    defaultVaultRoot() {
      return invoke<string>("default_vault_root");
    },
    vaultFs(root: string) {
      return new TauriVaultFs(root);
    },
    async readV1() {
      const r = await invoke<[string, Record<string, string>] | null>("v1_read");
      if (!r) return null;
      const data: Record<string, unknown> = {};
      for (const [file, text] of Object.entries(r[1])) {
        const key = V1_KEYS[file];
        if (key) data[key] = JSON.parse(text);
      }
      return { dir: r[0], data: data as V1Data };
    },
    on(event: PeerEvent, cb: (payload?: string) => void) {
      // 내가 보낸 알림은 무시 (보낸 창 이름을 같이 실어 보냄)
      const p = listen<{ from: string; payload?: string }>(event, (e) => {
        if (e.payload.from !== kind) cb(e.payload.payload);
      });
      return () => void p.then((off) => off());
    },
    emit(event: PeerEvent, payload?: string) {
      void emit(event, { from: kind, payload });
    },
    async showMain(screen?: Screen, select?: string) {
      await invoke("show_main");
      if (screen) void emit("open-screen", { from: kind, payload: select ? `${screen}|${select}` : screen });
    },
    async setPin(mode: PinMode) {
      await win.setAlwaysOnBottom(mode === "desktop");
      await win.setAlwaysOnTop(mode === "top");
    },
    async notify(title: string, body: string) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
    },
    async setHotkeys(keys, onPress) {
      await unregisterAll();
      const failed: string[] = [];
      for (const [action, acc] of Object.entries(keys)) {
        if (!acc) continue;
        try {
          await register(acc, (e) => e.state === "Pressed" && onPress(action as HotkeyAction));
        } catch {
          failed.push(acc);
        }
      }
      return failed;
    },
    saveExport(name, ext, bytes) {
      return invoke<string | null>("save_export", { name, ext, b64: toBase64(bytes) });
    },
    async openUrl(url: string) {
      if (!url.startsWith("https://")) return;
      await openUrl(url);
    },
    idleSeconds: () => invoke<number>("idle_seconds"),
    showWidget: () => invoke<void>("show_widget"),
    async readImageFile(path: string) {
      return fromBase64(await invoke<string>("read_image_file", { path }));
    },
    minimize: () => win.minimize(),
    close: () => win.close(),
  };
}
