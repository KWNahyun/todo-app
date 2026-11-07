/**
 * 할 일 창고: 언제 할지 아직 안 정한 일. 매일 목록에 다시 적지 않고 여기 모아 둠.
 * - PC: 줄을 끌어서 할 일 목록(data-drop="day")에 놓으면 그날 할 일 · 할 일을 끌어 여기 놓으면 창고로
 * - 휴대폰(끌기 없음): 줄의 '→ 오늘' 버튼
 * 접힘 상태는 창마다 기억 (localStorage)
 */
import { useState, type PointerEvent as RPointerEvent } from "react";
import type { Task } from "@dailytodo/core";
import { shortDay } from "../app/dates.ts";
import { BACKLOG, dayTree } from "../app/selectors.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { Trash } from "./icons.tsx";

const KEY = "dt-backlog-open";

interface Drag {
  id: string;
  title: string;
  sx: number;
  sy: number;
  x: number;
  y: number;
  active: boolean;
}

/** 끌던 줄 아래의 할 일 목록 → 그 날짜 */
function dayUnder(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop="day"]');
  return el?.dataset.day || null;
}

export function Backlog({ day, phone, onDetail }: { day: string; phone?: boolean; onDetail?: (id: string) => void }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const tree = dayTree(rep, BACKLOG).filter((n) => !n.task.done);
  const count = tree.reduce((a, n) => a + (n.children.length || 1), 0);
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [text, setText] = useState("");
  const [drag, setDrag] = useState<Drag | null>(null);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(KEY, open ? "0" : "1");
    } catch {
      // 기억 못 해도 그만
    }
  };
  const add = () => {
    if (actions.addBacklog(text)) setText("");
  };
  const toWord = day === today ? "오늘" : shortDay(day);

  // 끌기 (PC 마우스 · 펜) — 6px 넘게 움직여야 끌기, 아니면 누르기
  const down = (e: RPointerEvent, t: Task) => {
    if (phone || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // 이미 떨어진 포인터 — 끌기는 그래도 됨
    }
    setDrag({ id: t.id, title: t.title, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false });
  };
  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const active = drag.active || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6;
    if (active) {
      const over = dayUnder(e.clientX, e.clientY);
      document.querySelectorAll('[data-drop="day"]').forEach((el) => el.classList.toggle("drop-over", !!over && el === document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drop="day"]')));
      document.body.classList.add("dt-dragging");
    }
    setDrag({ ...drag, x: e.clientX, y: e.clientY, active });
  };
  const up = (e: RPointerEvent) => {
    if (!drag) return;
    document.querySelectorAll(".drop-over").forEach((el) => el.classList.remove("drop-over"));
    document.body.classList.remove("dt-dragging");
    const d = drag;
    setDrag(null);
    if (!d.active) return void onDetail?.(d.id);
    const target = dayUnder(e.clientX, e.clientY);
    if (target) actions.sendTo(d.id, target);
  };

  const row = (t: Task, child?: boolean, kids?: number) => (
    <div key={t.id} className={`bl-row${child ? " child" : ""}${kids ? " group" : ""}${drag?.active && drag.id === t.id ? " dragging" : ""}`}
      onPointerDown={(e) => down(e, t)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      title={phone ? undefined : "끌어서 할 일 목록에 놓으면 그날 할 일이 돼요"}>
      <span className="bl-title">{t.title}{kids ? <span className="faint"> · {kids}</span> : null}</span>
      <button className="bl-go" onClick={() => actions.sendTo(t.id, day)} aria-label={`'${t.title}' ${toWord} 할 일로`}>→ {toWord}</button>
      <button className="icon-btn bl-del" onClick={() => actions.removeTask(t.id)} aria-label={`'${t.title}' 지우기`}><Trash /></button>
    </div>
  );

  return (
    <section className="backlog" data-drop="backlog">
      <button className="sechead" aria-expanded={open} onClick={toggle}>
        <span>{open ? "▾" : "▸"} 할 일 창고 {count > 0 && <span className="faint">{count}</span>}</span>
      </button>
      {open && (
        <>
          <div className="input bl-input">
            <input value={text} placeholder="언제 할지 아직 모르는 일 (묶음 > 할 일)" aria-label="할 일 창고에 적기"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
            <button className="btn" onClick={add}>담기</button>
          </div>
          {tree.map((n) => [
            row(n.task, false, n.children.length || undefined),
            ...n.children.filter((c) => !c.done).map((c) => row(c, true)),
          ])}
          {!tree.length && (
            <div className="empty" style={{ fontSize: 12.5 }}>
              {phone ? "언젠가 할 일을 담아 두고, 할 날에 '→ 오늘'을 눌러요." : "언젠가 할 일을 담아 두고, 할 날에 끌어서 할 일 목록에 놓아요. 할 일을 끌어 여기 놓으면 창고로 와요."}
            </div>
          )}
        </>
      )}
      {drag?.active && <div className="bl-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>{drag.title}</div>}
    </section>
  );
}
