/** 휴대폰: 아래에서 올라오는 패널 (바깥을 누르거나 Esc 면 닫힘) */
import { useEffect, type ReactNode } from "react";
import { Close } from "./icons.tsx";

export function Sheet({ title, onClose, children, full }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="p-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`p-sheet${full ? " full" : ""}`} role="dialog" aria-label={title}>
        <div className="p-sheet-head">
          <b>{title}</b>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
        </div>
        <div className="p-sheet-body">{children}</div>
      </div>
    </div>
  );
}
