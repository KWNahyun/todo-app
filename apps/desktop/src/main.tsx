import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@fontsource/gowun-batang/korean-400.css";
import "@fontsource/gowun-batang/korean-700.css";
import "./ui/styles.css";
import { AppProvider } from "./app/store.tsx";
import { getPlatform } from "./platform/index.ts";
import { ErrorBoundary } from "./ui/ErrorBoundary.tsx";
import { MainWindow } from "./ui/MainWindow.tsx";
import { Widget } from "./ui/Widget.tsx";

const platform = getPlatform();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider platform={platform}>{platform.window === "widget" ? <Widget /> : <MainWindow />}</AppProvider>
    </ErrorBoundary>
  </StrictMode>,
);
