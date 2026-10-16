import { StrictMode, useEffect, useState } from "react";
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
import { PhoneLogin } from "./ui/PhoneLogin.tsx";
import { Widget } from "./ui/Widget.tsx";

const platform = getPlatform();
// 위젯 창은 투명 창 — 바탕은 위젯이 직접 칠함 (투명도 설정)
if (platform.window === "widget") document.documentElement.classList.add("widget-window");
if (platform.window === "phone") document.documentElement.classList.add("phone");

/** 휴대폰은 OneDrive 에 로그인해야 보관함을 열 수 있음 → 그 전엔 로그인 화면 */
function Root() {
  const [state, setState] = useState<"checking" | "login" | "ready">(platform.needsLogin ? "checking" : "ready");
  useEffect(() => {
    if (platform.needsLogin) void platform.needsLogin().then((n) => setState(n ? "login" : "ready"), () => setState("login"));
  }, []);
  if (state === "checking") return <div className="loading">불러오는 중…</div>;
  if (state === "login") return <PhoneLogin platform={platform} />;
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
