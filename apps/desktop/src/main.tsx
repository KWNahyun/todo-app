import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/gowun-batang/korean-400.css";
import "@fontsource/gowun-batang/korean-700.css";
import "@fontsource/gaegu/korean-400.css";
import "@fontsource/gaegu/korean-700.css";
import "./ui/styles.css";
import { AppProvider } from "./app/store.tsx";
import { getPlatform } from "./platform/index.ts";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { MainWindow } from "./ui/MainWindow.tsx";
import { Phone } from "./ui/Phone.tsx";
import { PhoneSetup } from "./ui/PhoneSetup.tsx";
import type { PhoneSetup as SetupStatus } from "./platform/index.ts";
import { Widget } from "./ui/Widget.tsx";

const platform = getPlatform();
// 위젯 창은 투명 창 — 바탕은 위젯이 직접 칠함 (투명도 설정)
if (platform.window === "widget") document.documentElement.classList.add("widget-window");
if (platform.window === "phone") document.documentElement.classList.add("phone");

/** 휴대폰은 보관함 폴더가 준비돼야 (권한 · PC 에서 받아 옴) 열 수 있음 → 그 전엔 준비 화면 */
function Root() {
  const [state, setState] = useState<"checking" | SetupStatus>(platform.phoneSetup ? "checking" : "ok");
  useEffect(() => {
    if (platform.phoneSetup) void platform.phoneSetup().then(setState, () => setState("permission"));
  }, []);
  const ready = useCallback(() => setState("ok"), []);
  if (state === "checking") return <div className="loading">불러오는 중…</div>;
  if (state !== "ok") return <PhoneSetup platform={platform} status={state} onReady={ready} />;
  return (
    <AppProvider platform={platform}>
      {platform.window === "widget" ? <Widget /> : platform.window === "phone" ? <Phone /> : <MainWindow />}
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
