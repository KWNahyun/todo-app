/** 작은 달력 (날짜 누르면 달력 팝업 — v1 CalendarPopup). 일정 · 마감 있는 날에 점 */
import { useEffect, useRef, useState } from "react";
import { toDate } from "../app/dates.ts";
import { itemsByDay, monthGrid, sameMonth, shiftAnchor } from "../app/schedule.ts";
import { useApp, useData } from "../app/store.tsx";
import { Left, Right } from "./icons.tsx";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function MiniCalendar({ value, today, onPick }: { value: string; today: string; onPick: (day: string) => void }) {
  const { rep } = useApp();
  useData();
  const [anchor, setAnchor] = useState(value);
  const days = monthGrid(anchor);
  const items = itemsByDay(rep, days);
  const a = toDate(anchor);
  return (
    <div className="minical">
      <div className="minical-head">
        <button className="icon-btn" aria-label="이전 달" onClick={() => setAnchor(shiftAnchor("month", anchor, -1))}><Left /></button>
        <b>{a.getFullYear()}년 {a.getMonth() + 1}월</b>
        <button className="icon-btn" aria-label="다음 달" onClick={() => setAnchor(shiftAnchor("month", anchor, 1))}><Right /></button>
      </div>
      <div className="minical-grid" role="grid">
        {WEEK.map((w, i) => <span key={w} className={`wd${i === 0 ? " sun" : ""}`}>{w}</span>)}
        {days.map((d) => {
          const it = items.get(d)!;
          const cls = [
            "d",
            !sameMonth(d, anchor) && "out",
            d === today && "today",
            d === value && "on",
            toDate(d).getDay() === 0 && "sun",
          ].filter(Boolean).join(" ");
          return (
            <button key={d} className={cls} onClick={() => onPick(d)} aria-label={d} aria-pressed={d === value}>
              {toDate(d).getDate()}
              <i className="dots">
                {it.events.length > 0 && <i className="dot ev" />}
                {it.deadlines.length > 0 && <i className="dot dl" />}
              </i>
            </button>
          );
        })}
      </div>
      {anchor.slice(0, 7) !== today.slice(0, 7) && (
        <button className="btn btn-ghost" onClick={() => onPick(today)}>오늘로</button>
      )}
    </div>
  );
}

/** 무엇을 누르면 아래에 뜨는 달력. 바깥을 누르거나 Esc 면 닫힘 */
export function CalendarPopup({ value, today, onPick, onClose }: { value: string; today: string; onPick: (d: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("mousedown", down));
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return (
    <div className="popover" ref={ref} role="dialog" aria-label="날짜 고르기">
      <MiniCalendar value={value} today={today} onPick={(d) => { onPick(d); onClose(); }} />
    </div>
  );
}
