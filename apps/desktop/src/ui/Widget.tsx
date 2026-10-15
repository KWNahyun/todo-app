/** 위젯: 바탕화면에 늘 떠 있는 작은 창. 오늘만 보여 주고 나머지는 메인 창으로 (설계 3장) */
import { useEffect, useState } from "react";
import { addDays, clock, dayOf, ddayText, longDay } from "../app/dates.ts";
import { dayTotal, dayTree, eventsOf, nextEvent, progress, runningSessions, upcomingDeadlines } from "../app/selectors.ts";
import { useApp, useData, useNow } from "../app/store.tsx";
import type { PinMode } from "../platform/index.ts";
import { Close, Expand, Left, Minus, Pin, Right } from "./icons.tsx";
import { EventList, InputLine, Snackbar, TimelinePreview } from "./parts.tsx";
import { TaskList } from "./TaskList.tsx";

const PIN_NEXT: Record<PinMode, PinMode> = { normal: "top", top: "desktop", desktop: "normal" };
const PIN_LABEL: Record<PinMode, string> = { normal: "보통 창", top: "항상 위", desktop: "바탕화면 고정" };

/** 오늘 날짜 (자정이 지나면 바뀜) */
export function useToday(): string {
  const now = useNow(true, 30_000);
  return dayOf(new Date(now));
}

export function Widget() {
  const { rep, platform, config, saveConfig } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [follow, setFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  useEffect(() => {
    if (follow) setDay(today);
  }, [today, follow]);
  const go = (d: string) => {
    setDay(d);
    setFollow(d === today);
  };

  const pin = config.pin ?? "normal";
  useEffect(() => void platform.setPin(pin), [pin, platform]);

  const running = runningSessions(rep).length > 0;
  const now = useNow(true, running ? 1000 : 20_000);
  const tree = dayTree(rep, day);
  const { done, total } = progress(tree);
  const events = eventsOf(rep, day);
  const next = nextEvent(events, day, now);
  const dl = upcomingDeadlines(rep, today, 1)[0];

  return (
    <div className="widget">
      <header className="w-top" data-tauri-drag-region>
        <b data-tauri-drag-region>❦ Daily Todo</b>
        <div className="btns">
          <button className="icon-btn" title={`${PIN_LABEL[pin]} (누르면 ${PIN_LABEL[PIN_NEXT[pin]]})`} aria-label="고정 방식 바꾸기" onClick={() => void saveConfig({ pin: PIN_NEXT[pin] })}>
            <Pin mode={pin} />
          </button>
          <button className="icon-btn" title="메인 창" aria-label="메인 창 열기" onClick={() => void platform.showMain("today")}>
            <Expand />
          </button>
          <button className="icon-btn" title="최소화" aria-label="최소화" onClick={() => void platform.minimize()}>
            <Minus />
          </button>
          <button className="icon-btn" title="끄기" aria-label="끄기" onClick={() => void platform.close()}>
            <Close />
          </button>
        </div>
      </header>

      <main className="w-body">
        <div className="w-date">
          <button className="icon-btn" aria-label="전날" onClick={() => go(addDays(day, -1))}><Left /></button>
          <h1 title="오늘로" onClick={() => go(today)}>{longDay(day)}</h1>
          <button className="icon-btn" aria-label="다음 날" onClick={() => go(addDays(day, 1))}><Right /></button>
        </div>

        <div className="w-chips">
          <span className="chip">
            일정 {events.length}
            {next?.time && <span className="num" style={{ color: "var(--accent)" }}>{next.time}</span>}
          </span>
          {dl && (
            <span className="chip" title={dl.title}>
              마감 <span className={`tag ${dl.dday <= 3 ? "tag-danger" : dl.dday <= 7 ? "tag-sun" : "tag-accent"}`}>{ddayText(dl.dday)}</span>
            </span>
          )}
          {day !== today && <button className="chip" style={{ cursor: "pointer" }} onClick={() => go(today)}>오늘로</button>}
        </div>

        {events.length > 0 && <EventList day={day} now={now} limit={4} />}
        <InputLine day={day} today={today} />
        <div className="bar" aria-label={`완료 ${done}/${total}`}><i style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></div>
        <TaskList tree={tree} now={now} compact />

        <button className="sechead" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
          <span>{logOpen ? "▾" : "▸"} 오늘의 기록</span>
        </button>
        {logOpen && <TimelinePreview day={day} now={now} limit={4} />}
      </main>

      <footer className="w-foot">
        <span>완료 {done}/{total} · 총 <span className="num">{clock(dayTotal(rep, tree, now))}</span></span>
        <button className="btn btn-ghost" onClick={() => void platform.showMain("settings")}>설정</button>
      </footer>
      <Snackbar />
    </div>
  );
}
