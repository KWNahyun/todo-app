import { tauriPlatform } from "./tauri.ts";
import type { Platform } from "./types.ts";
import { webPlatform } from "./web.ts";

export * from "./types.ts";

export function getPlatform(): Platform {
  return "__TAURI_INTERNALS__" in window ? tauriPlatform() : webPlatform();
}
