/**
 * 휴대폰: 아래에서 올라오는 패널.
 * 닫기: ✕ · 바깥 누르기 · Esc · 아래로 끌어내리기 · 안드로이드 뒤로 버튼(onBack — MainActivity.kt 가 물어봄)
 */
import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import { Close } from "./icons.tsx";

// 안드로이드 뒤로 버튼: 맨 위 시트부터 닫고, 시트가 없으면 화면이 정한 것(fallback) → 그래도 없으면 앱이 뒤로 감
const open: (() => void)[] = [];
let fallback: (() => boolean) | null = null;
/** 시트가 없을 때 뒤로 버튼 (예: 오늘 탭으로) — 처리했으면 true */
export function setBackFallback(fn: (() => boolean) | null) {
  fallback = fn;
}
if (typeof window !== "undefined") {
  (window as unknown as { __dtBack: () => boolean }).__dtBack = () => {
    const top = open[open.length - 1];
    if (top) {
      top();
      return true;
    }
    return fallback?.() ?? false;
  };
}

/** 이만큼(px) 끌어내리거나 빠르게 튕기면 닫힘 */
const CLOSE_PX = 110;

export function Sheet({ title, onClose, children, full }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const sheet = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number; on: boolean } | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", k);
    const close = () => closeRef.current();
    open.push(close);
    return () => {
      window.removeEventListener("keydown", k);
      const i = open.indexOf(close);
      if (i >= 0) open.splice(i, 1);
    };
  }, []);

  // 아래로 끌어내리기: 머리에서 시작했거나, 내용이 맨 위일 때만 (안쪽 스크롤과 안 겹치게)
  const start = (e: TouchEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, .paper-stage")) return;
    const top = !body.current || body.current.scrollTop <= 0 || !!t.closest(".p-sheet-head");
    drag.current = { y: e.touches[0]!.clientY, t: Date.now(), dy: 0, on: top };
  };
  const move = (e: TouchEvent) => {
    const d = drag.current;
    if (!d?.on || !sheet.current) return;
    d.dy = Math.max(0, e.touches[0]!.clientY - d.y);
    sheet.current.style.transition = "none";
    sheet.current.style.transform = `translateY(${d.dy}px)`;
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.on || !sheet.current) return;
    const fast = d.dy > 40 && d.dy / Math.max(1, Date.now() - d.t) > 0.6;
    if (d.dy > CLOSE_PX || fast) {
      sheet.current.style.transition = "transform .16s ease-in";
      sheet.current.style.transform = "translateY(100%)";
      setTimeout(() => closeRef.current(), 150);
    } else {
      sheet.current.style.transition = "transform .18s ease-out";
      sheet.current.style.transform = "";
    }
  };

  return (
    <div className="p-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={sheet} className={`p-sheet${full ? " full" : ""}`} role="dialog" aria-label={title}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}>
        <div className="p-sheet-grip" aria-hidden="true" />
        <div className="p-sheet-head">
          <b>{title}</b>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
        </div>
        <div ref={body} className="p-sheet-body">{children}</div>
      </div>
    </div>
  );
}
