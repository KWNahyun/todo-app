/** 위젯 · 메인 창이 같이 쓰는 작은 조각들 */
import { useEffect, useState } from "react";
import { at, dayOf, ddayText, hhmm, until } from "../app/dates.ts";
import { previewKind } from "../app/parse.ts";
import { eventsOf, nextEvent, timeline, upcomingDeadlines } from "../app/selectors.ts";
import { useApp } from "../app/store.tsx";

/** 입력 한 줄. 왼쪽에 지금 무엇으로 들어갈지 표시 */
export function InputLine({ day, today, autoFocus }: { day: string; today: string; autoFocus?: boolean }) {
  const { actions } = useApp();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const kind = previewKind(text, day, today);
  const submit = () => {
    if (!text.trim()) return;
    const r = actions.add(text, day);
    if (r.ok) {
      setText("");
      setMsg(null);
    } else setMsg(r.message);
  };
  return (
    <div className="stack">
      <div className="input">
        <span className="kind">{kind.label}</span>
        <input
          value={text}
          autoFocus={autoFocus}
          aria-label="할 일 · 일정 · 마감 · 기록 입력"
          placeholder="할 일 · 13:30 회의 · 마감 10/20 … · - 기록"
          onChange={(e) => {
            setText(e.target.value);
            setMsg(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            if (e.key === "Escape") setText("");
          }}
        />
        <button className="btn btn-accent" onClick={submit}>추가</button>
      </div>
      {msg && <div className="input-msg" role="status">{msg}</div>}
    </div>
  );
}

export function EventList({ day, now, limit, onSelect }: { day: string; now: number; limit?: number; onSelect?: (id: string) => void }) {
  const { rep } = useApp();
  const events = eventsOf(rep, day);
  const next = nextEvent(events, day, now);
  if (!events.length) return <div className="empty">일정 없음</div>;
  return (
    <div className="stack">
      {events.slice(0, limit).map((e) => {
        // 지난 일정은 흐리게: 지난 날짜거나, 오늘인데 시각이 지남
        const today = dayOf(new Date(now));
        const past = day < today || (day === today && !!e.time && at(day, e.time) < now);
        return (
          <div key={e.id} className={`ev${e === next ? " next" : ""}${past ? " past" : ""}${onSelect ? " clickable" : ""}`}
            onClick={onSelect && (() => onSelect(e.id))}>
            <span className="when num">{e.time ?? "미정"}</span>
            <span className="what" title={e.title}>{e.title}</span>
            {e === next && <span className="left">{until(at(day, e.time!) - now)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function DeadlineList({ today, limit = 5, onSelect }: { today: string; limit?: number; onSelect?: (id: string) => void }) {
  const { rep } = useApp();
  const ds = upcomingDeadlines(rep, today, limit);
  if (!ds.length) return <div className="empty">다가오는 마감 없음</div>;
  return (
    <div className="stack">
      {ds.map((d) => (
        <div key={d.id} className={`dl${onSelect ? " clickable" : ""}`} onClick={onSelect && (() => onSelect(d.id))}>
          <span className={`tag ${d.dday <= 3 ? "tag-danger" : d.dday <= 7 ? "tag-sun" : "tag-accent"}`}>{ddayText(d.dday)}</span>
          <span className="what" title={d.title}>{d.title}</span>
        </div>
      ))}
    </div>
  );
}

export function TimelinePreview({ day, now, limit }: { day: string; now: number; limit?: number }) {
  const { rep } = useApp();
  let items = timeline(rep, day, now);
  if (limit) items = items.slice(-limit);
  if (!items.length) return <div className="empty">'- 점심 맛있었다' 처럼 적으면 여기에 쌓여요.</div>;
  return (
    <div className="tl">
      {items.map((i) => (
        <div key={`${i.kind}-${i.id}`} className={i.auto ? "auto" : ""}>
          <span className="t num">{hhmm(i.at)}</span>
          <span>{i.text}</span>
        </div>
      ))}
    </div>
  );
}

/** 되돌리기 줄 + Ctrl+Z */
export function Snackbar() {
  const { actions } = useApp();
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => actions.onChange(setLabel), [actions]);
  useEffect(() => {
    if (!label) return;
    const h = setTimeout(() => setLabel(null), 6000);
    return () => clearTimeout(h);
  }, [label]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        actions.undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);
  if (!label) return null;
  return (
    <div className="snack" role="status">
      <span>{label}</span>
      <button onClick={() => actions.undo()}>되돌리기</button>
    </div>
  );
}
