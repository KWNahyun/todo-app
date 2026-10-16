/** 위젯: 바탕화면에 늘 떠 있는 작은 창. 오늘만 보여 주고 나머지는 메인 창으로 (설계 3장) */
import { useEffect, useRef, useState } from "react";
import { addDays, at, clock, dayOf, ddayText, longDay, until } from "../app/dates.ts";
import { dueReminders, reminderKey } from "../app/reminders.ts";
import { dayTotal, dayTree, eventsOf, nextEvent, progress, runningSessions, upcomingDeadlines } from "../app/selectors.ts";
import { useApp, useData, useNow, useToday } from "../app/store.tsx";
import type { PinMode } from "../platform/index.ts";
import { CalendarPopup } from "./Calendar.tsx";
import { Close, Expand, Left, Minus, Pin, Right } from "./icons.tsx";
import { EventList, InputLine, Snackbar, TimelinePreview } from "./parts.tsx";
import { TaskList } from "./TaskList.tsx";

const PIN_NEXT: Record<PinMode, PinMode> = { normal: "top", top: "desktop", desktop: "normal" };
const PIN_LABEL: Record<PinMode, string> = { normal: "보통 창", top: "항상 위", desktop: "바탕화면 고정" };

/** 일정 알림 — 위젯 창만 돌림 (메인 창까지 돌리면 두 번 울림) */
function useReminders() {
  const { rep, platform, config } = useApp();
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      const today = dayOf(new Date(now));
      const events = [...eventsOf(rep, today), ...eventsOf(rep, addDays(today, 1))];
      for (const e of dueReminders(events, now, fired.current, config.remindMin ?? 10)) {
        fired.current.add(reminderKey(e));
        void platform.notify(`${e.time} ${e.title}`, until(at(e.day, e.time!) - now) + " 시작해요");
      }
    };
    check();
    const h = setInterval(check, 20_000);
    return () => clearInterval(h);
  }, [rep, platform, config.remindMin]);
}

export function Widget() {
  const { rep, platform, config, saveConfig } = useApp();
  useData();
  useReminders();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [follow, setFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const [cal, setCal] = useState(false);
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
          <span className="pop-anchor" style={{ flex: 1, textAlign: "center" }}>
            <h1 title="달력" onClick={() => setCal(!cal)}>{longDay(day)}</h1>
            {cal && <CalendarPopup value={day} today={today} onPick={go} onClose={() => setCal(false)} />}
          </span>
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
