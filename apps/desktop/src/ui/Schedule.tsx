/**
 * 일정표 (설계 4.2 · v1 ScheduleWindow): 이번 주 · 2주 · 한 달, [일정 | 마감] 추가, 누르면 상세.
 * 새로: 일정 · 마감을 다른 날로 끌어 놓기.
 */
import { useState, type DragEvent } from "react";
import type { Deadline, Event } from "@dailytodo/core";
import { daysBetween, ddayText, shortDay, toDate } from "../app/dates.ts";
import { parseScheduleInput } from "../app/parse.ts";
import { itemsByDay, rangeDays, sameMonth, shiftAnchor, type RangeMode } from "../app/schedule.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { CalendarPopup } from "./Calendar.tsx";
import { Left, Right } from "./icons.tsx";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
const MODES: [RangeMode, string][] = [["week", "이번 주"], ["2weeks", "2주"], ["month", "한 달"]];

function ddayTag(today: string, date: string) {
  const n = daysBetween(today, date);
  return <span className={`tag ${n < 0 ? "tag-past" : n <= 3 ? "tag-danger" : n <= 7 ? "tag-sun" : "tag-accent"}`}>{ddayText(n)}</span>;
}

interface ItemProps {
  today: string;
  selected: string | null;
  onSelect: (id: string) => void;
}

function EventChip({ e, selected, onSelect }: { e: Event } & Omit<ItemProps, "today">) {
  return (
    <button
      className={`sch-item${selected === e.id ? " on" : ""}`}
      draggable
      onDragStart={(ev) => ev.dataTransfer.setData("text/x-dt-id", e.id)}
      onClick={() => onSelect(e.id)}
      title={e.title}
    >
      <span className="when num">{e.time ?? "미정"}</span>
      <span className="what">{e.title}</span>
    </button>
  );
}

function DeadlineChip({ d, today, selected, onSelect }: { d: Deadline } & ItemProps) {
  return (
    <button
      className={`sch-item dl-item${selected === d.id ? " on" : ""}`}
      draggable
      onDragStart={(ev) => ev.dataTransfer.setData("text/x-dt-id", d.id)}
      onClick={() => onSelect(d.id)}
      title={d.title}
    >
      {ddayTag(today, d.date)}
      <span className="what">{d.title}</span>
    </button>
  );
}

export function Schedule({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [mode, setMode] = useState<RangeMode>("week");
  const [anchor, setAnchor] = useState(today);
  const [day, setDay] = useState(today); // 추가할 날
  const [kind, setKind] = useState<"event" | "deadline">("event");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cal, setCal] = useState(false);
  const [over, setOver] = useState<string | null>(null);

  const days = rangeDays(mode, anchor);
  const items = itemsByDay(rep, days);
  const a = toDate(anchor);
  const label = mode === "month" ? `${a.getFullYear()}년 ${a.getMonth() + 1}월` : `${shortDay(days[0]!)} – ${shortDay(days[days.length - 1]!)}`;

  const pick = (d: string) => {
    setDay(d);
    if (!days.includes(d)) setAnchor(d);
  };
  const add = () => {
    const p = parseScheduleInput(text, kind, day, today);
    if (p.kind === "error") return setMsg({ ok: false, text: p.message });
    actions.addDated(p);
    const d = p.kind === "event" ? p.day : p.date;
    setText("");
    setMsg({ ok: true, text: `${shortDay(d)} ${p.kind === "event" ? (p.time ?? "시간 미정") : "마감"} ${p.title} — 추가했어요` });
    pick(d);
  };
  const drop = (d: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/x-dt-id");
    if (id) actions.moveToDay(id, d);
  };
  const target = (d: string) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes("text/x-dt-id")) {
        e.preventDefault();
        setOver(d);
      }
    },
    onDragLeave: () => setOver((o) => (o === d ? null : o)),
    onDrop: drop(d),
  });
  const chips = (d: string, limit?: number) => {
    const it = items.get(d)!;
    const all = [
      ...it.deadlines.map((x) => <DeadlineChip key={x.id} d={x} today={today} selected={selected} onSelect={onSelect} />),
      ...it.events.map((x) => <EventChip key={x.id} e={x} selected={selected} onSelect={onSelect} />),
    ];
    if (!limit || all.length <= limit) return all;
    return [...all.slice(0, limit - 1), <span key="more" className="more">+{all.length - limit + 1}</span>];
  };

  return (
    <>
      <div className="center-head">
        <button className="icon-btn" aria-label="이전" onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}><Left /></button>
        <h1>{label}</h1>
        <button className="icon-btn" aria-label="다음" onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}><Right /></button>
        {!days.includes(today) && <button className="btn" onClick={() => { setAnchor(today); setDay(today); }}>오늘로</button>}
        <div className="seg" role="group" aria-label="보기" style={{ marginLeft: "auto" }}>
          {MODES.map(([m, l]) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{l}</button>)}
        </div>
      </div>

      <div className="stack">
        <div className="input">
          <div className="seg" role="group" aria-label="종류">
            <button aria-pressed={kind === "event"} onClick={() => setKind("event")}>일정</button>
            <button aria-pressed={kind === "deadline"} onClick={() => setKind("deadline")}>마감</button>
          </div>
          <span className="pop-anchor">
            <button className="chip" style={{ cursor: "pointer" }} onClick={() => setCal(!cal)} aria-haspopup="dialog">{shortDay(day)} ▾</button>
            {cal && <CalendarPopup value={day} today={today} onPick={pick} onClose={() => setCal(false)} />}
          </span>
          <input
            value={text}
            aria-label={kind === "event" ? "일정 입력" : "마감 입력"}
            placeholder={kind === "event" ? "13:30 회의 · 10/7 MT (시간 없으면 미정)" : "KAMP 제출 · 10/20 보고서"}
            onChange={(e) => { setText(e.target.value); setMsg(null); }}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()}
          />
          <button className="btn btn-accent" onClick={add}>추가</button>
        </div>
        {msg && <div className={msg.ok ? "input-ok" : "input-msg"} role="status">{msg.text}</div>}
      </div>

      {mode === "month" ? (
        <>
          <div className="month" role="grid">
            {WEEK.map((w, i) => <span key={w} className={`wd${i === 0 ? " sun" : ""}`}>{w}</span>)}
            {days.map((d) => (
              <div
                key={d}
                role="gridcell"
                className={["cell", !sameMonth(d, anchor) && "out", d === today && "today", d === day && "on", over === d && "over"].filter(Boolean).join(" ")}
                onClick={(e) => (e.target as HTMLElement).closest(".sch-item") || setDay(d)}
                {...target(d)}
              >
                <span className={`n${toDate(d).getDay() === 0 ? " sun" : ""}`}>{toDate(d).getDate()}</span>
                {chips(d, 3)}
              </div>
            ))}
          </div>
          <div className="card">
            <span className="label">{shortDay(day)}{day === today ? " · 오늘" : ""}</span>
            {chips(day).length ? chips(day) : <div className="empty">일정 · 마감 없음 — 위에 적으면 이날에 들어가요.</div>}
          </div>
        </>
      ) : (
        <div className="days">
          {days.map((d) => (
            <section key={d} className={["day", d === day && "on", d === today && "today", over === d && "over"].filter(Boolean).join(" ")} {...target(d)}>
              <button className={`day-h${toDate(d).getDay() === 0 ? " sun" : ""}`} onClick={() => setDay(d)}>
                {toDate(d).getMonth() + 1}월 {toDate(d).getDate()}일 ({WEEK[toDate(d).getDay()]}){d === today ? " · 오늘" : ""}
              </button>
              <div className="day-items">{chips(d).length ? chips(d) : <span className="faint">—</span>}</div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
