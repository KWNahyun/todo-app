/** 우클릭 메뉴 (v1 tk.Menu 처럼): 화면 밖으로 안 나가게, 하위 메뉴는 마우스를 올리면 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  sub?: MenuItem[];
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  disabled?: boolean;
}

function List({ items, onDone, style }: { items: MenuItem[]; onDone: () => void; style: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [pos, setPos] = useState(style);
  // 화면 밖으로 나가면 안쪽으로
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const next = { ...style } as Record<string, number | string>;
    if (r.right > innerWidth - 4) next.left = Math.max(4, Number(style.left ?? 0) - (r.right - innerWidth) - 8);
    if (r.bottom > innerHeight - 4) next.top = Math.max(4, Number(style.top ?? 0) - (r.bottom - innerHeight) - 8);
    setPos(next);
  }, [style]);
  return (
    <div className="ctx" ref={ref} style={pos} role="menu">
      {items.map((it, i) =>
        it.separator ? <hr key={i} /> : (
          <div key={i} className="ctx-item-wrap" onMouseEnter={() => setOpen(it.sub ? i : null)}>
            <button role="menuitem" className={`ctx-item${it.danger ? " danger" : ""}`} disabled={it.disabled}
              aria-haspopup={it.sub ? "menu" : undefined}
              onClick={() => {
                if (it.sub) return setOpen(i);
                it.onClick?.();
                onDone();
              }}>
              <span className="mark">{it.checked ? "✓" : ""}</span>
              <span>{it.label}</span>
              {it.sub && <span className="more">›</span>}
            </button>
            {it.sub && open === i && (
              <List items={it.sub} onDone={onDone} style={{ left: (ref.current?.getBoundingClientRect().right ?? 0) - 4, top: (ref.current?.querySelectorAll(".ctx-item-wrap")[i]?.getBoundingClientRect().top ?? 0) - 4, position: "fixed" }} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const down = (e: MouseEvent) => !(e.target instanceof Element && e.target.closest(".ctx")) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const id = setTimeout(() => window.addEventListener("mousedown", down));
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      clearTimeout(id);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return <List items={items} onDone={onClose} style={{ position: "fixed", left: x, top: y }} />;
}
