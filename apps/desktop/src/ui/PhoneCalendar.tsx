/**
 * 휴대폰 일정 탭: 달력 앱처럼 — 날짜 칸 바로 아래에 그날 마감 · 일정 이름.
 * 날짜를 누르면 그날만 자세히(시트: 시각 · 이름 · 추가). 달은 ‹ › 또는 달력을 좌우로 밀어서.
 * 홈 화면 위젯에서 날짜를 누르고 들어오면 그날 시트가 바로 열림 (openDay).
 */
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { longDay, toDate } from "../app/dates.ts";
import { parseScheduleInput } from "../app/parse.ts";
import { itemsByDay, monthGrid, sameMonth, shiftAnchor } from "../app/schedule.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { Left, Right } from "./icons.tsx";
import { Sheet } from "./Sheet.tsx";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 한 칸에 보이는 줄 수 (넘치면 +n) */
const PER_CELL = 3;

function DaySheet({ day, onClose, onOpen }: { day: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const it = itemsByDay(rep, [day]).get(day)!;
  const [kind, setKind] = useState<"event" | "deadline">("event");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const add = () => {
    const p = parseScheduleInput(text, kind, day, today);
    if (p.kind === "error") return setMsg(p.message);
    actions.addDated(p);
    setText("");
    setMsg(null);
  };
  const empty = !it.events.length && !it.deadlines.length;
  return (
    <Sheet title={`${longDay(day)}${day === today ? " · 오늘" : ""}`} onClose={onClose}>
      {it.deadlines.map((x) => (
        <button key={x.id} className="pd-row dl" onClick={() => onOpen(x.id)}>
          <span className="tag tag-danger">마감</span><span className="what">{x.title}</span>
        </button>
      ))}
      {it.events.map((x) => (
        <button key={x.id} className="pd-row" onClick={() => onOpen(x.id)}>
          <span className="when num">{x.time ?? "종일"}</span><span className="what">{x.title}</span>
        </button>
      ))}
      {empty && <div className="empty">이날은 일정 · 마감이 없어요.</div>}
      <div className="pd-add">
        <div className="seg" role="group" aria-label="종류">
          <button aria-pressed={kind === "event"} onClick={() => setKind("event")}>일정</button>
          <button aria-pressed={kind === "deadline"} onClick={() => setKind("deadline")}>마감</button>
        </div>
        <div className="input">
          <input value={text} aria-label={kind === "event" ? "일정 추가" : "마감 추가"} placeholder={kind === "event" ? "13:30 회의 (시각 없으면 종일)" : "보고서 제출"}
            onChange={(e) => { setText(e.target.value); setMsg(null); }}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
          <button className="btn btn-accent" onClick={add}>추가</button>
        </div>
        {msg && <div className="input-msg">{msg}</div>}
      </div>
    </Sheet>
  );
}

export function PhoneCalendar({ onOpen, openDay }: { onOpen: (id: string) => void; openDay?: { day: string; n: number } }) {
  const { rep } = useApp();
  useData();
  const today = useToday();
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState<string | null>(null);
  // 위젯에서 날짜를 누르고 들어옴 → 그달 · 그날 시트
  useEffect(() => {
    if (!openDay) return;
    setAnchor(openDay.day);
    setSel(openDay.day);
  }, [openDay]);
  const days = monthGrid(anchor);
  const items = itemsByDay(rep, days);
  const a = toDate(anchor);
  const shift = (n: number) => setAnchor(shiftAnchor("month", anchor, n));

  // 달력을 좌우로 밀면 달 넘김 (탭 넘기기 대신)
  const touch = useRef<{ x: number; y: number } | null>(null);
  const start = (e: TouchEvent) => (touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY });
  const end = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0]!.clientX - s.x;
    const dy = e.changedTouches[0]!.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  };

  return (
    <>
      <header className="p-head pc-head">
        <button className="icon-btn" aria-label="이전 달" onClick={() => shift(-1)}><Left /></button>
        <h1>{a.getFullYear()}년 {a.getMonth() + 1}월</h1>
        <button className="icon-btn" aria-label="다음 달" onClick={() => shift(1)}><Right /></button>
        {!sameMonth(anchor, today) && <button className="chip pc-today" onClick={() => setAnchor(today)}>오늘</button>}
      </header>
      <div className="p-month" onTouchStart={start} onTouchEnd={end} style={{ gridTemplateRows: `auto repeat(${days.length / 7}, minmax(0, 1fr))` }}>
        {WEEK.map((w, i) => <span key={w} className={`pm-wd${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{w}</span>)}
        {days.map((d) => {
          const it = items.get(d)!;
          const lines = [
            ...it.deadlines.map((x) => ({ id: x.id, text: x.title, dl: true })),
            ...it.events.map((x) => ({ id: x.id, text: x.title, dl: false })),
          ];
          const dow = toDate(d).getDay();
          return (
            <button key={d} className={["pm-cell", !sameMonth(d, anchor) && "out", d === today && "today"].filter(Boolean).join(" ")}
              onClick={() => setSel(d)} aria-label={`${longDay(d)} · ${lines.length ? `${lines.length}개` : "없음"}`}>
              <span className={`pm-n${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}>{toDate(d).getDate()}</span>
              {lines.slice(0, lines.length > PER_CELL ? PER_CELL - 1 : PER_CELL).map((l) => (
                <span key={l.id} className={`pm-item${l.dl ? " dl" : ""}`}>{l.text}</span>
              ))}
              {lines.length > PER_CELL && <span className="pm-more">+{lines.length - PER_CELL + 1}</span>}
            </button>
          );
        })}
      </div>
      <button className="fab" aria-label="일정 추가" onClick={() => setSel(sameMonth(anchor, today) ? today : anchor)}>＋</button>
      {sel && <DaySheet day={sel} onClose={() => setSel(null)} onOpen={onOpen} />}
    </>
  );
}
