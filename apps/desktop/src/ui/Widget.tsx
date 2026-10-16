/** 위젯: 바탕화면에 늘 떠 있는 작은 창. 오늘만 보여 주고 나머지는 메인 창으로 (설계 3장) */
import { useEffect, useRef, useState } from "react";
import { addDays, at, clock, dayOf, ddayText, longDay, until } from "../app/dates.ts";
import { dueReminders, reminderKey } from "../app/reminders.ts";
import { featureOn } from "../app/appearance.ts";
import { dayTotal, dayTree, eventsOf, nextEvent, progress, runningSessions, upcomingDeadlines } from "../app/selectors.ts";
import { useApp, useData, useNow, useToday } from "../app/store.tsx";
import { DEFAULT_HOTKEYS, type HotkeyAction, type PinMode } from "../platform/index.ts";
import { CalendarPopup } from "./Calendar.tsx";
import { Close, Expand, Left, Minus, Pin, Right } from "./icons.tsx";
import { DeadlineList, EventList, InputLine, Snackbar, TimelinePreview } from "./parts.tsx";
import { MoodPicker } from "./Records.tsx";
import { TaskList } from "./TaskList.tsx";
import { AwayOverlay, HabitChips, PomoBar, ReviewSheet, useGuard } from "./WidgetGuard.tsx";

const PIN_NEXT: Record<PinMode, PinMode> = { normal: "top", top: "desktop", desktop: "normal" };
const PIN_LABEL: Record<PinMode, string> = { normal: "보통 창", top: "항상 위", desktop: "바탕화면 고정" };

/** 일정 알림 — 위젯 창만 돌림 (메인 창까지 돌리면 두 번 울림) */
function useReminders() {
  const { rep, platform, config } = useApp();
  const fired = useRef(new Set<string>());
  useEffect(() => {
    const check = () => {
      if (!featureOn(rep, "events")) return;
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
  const { rep, platform, config, saveConfig, actions } = useApp();
  useData();
  useReminders();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [follow, setFollow] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const [cal, setCal] = useState(false);
  const [review, setReview] = useState(false);
  const [showDl, setShowDl] = useState(false);
  /** 위젯은 좁아서 상세는 메인 창의 상세 패널로 */
  const openDetail = (id: string) => void platform.showMain("today", id);
  const [toast, setToast] = useState<string | null>(null);
  const guard = useGuard();
  useEffect(() => {
    if (follow) setDay(today);
  }, [today, follow]);
  useEffect(() => platform.on("open-review", () => setReview(true)), [platform]);

  // 전역 단축키 (v1 과 같은 세 가지) — 위젯 창이 맡음
  const hotkeys = JSON.stringify({ ...DEFAULT_HOTKEYS, ...config.hotkeys });
  useEffect(() => {
    const onPress = (a: HotkeyAction) => {
      if (a === "show") {
        void platform.showWidget();
        setTimeout(() => document.querySelector<HTMLInputElement>(".w-body .input input")?.focus(), 80);
      } else if (a === "review") {
        void platform.showWidget();
        if (featureOn(rep, "review")) setReview(true);
      } else {
        const today = dayOf(new Date());
        const mine = runningSessions(rep).filter((s) => s.deviceId === actions.pcId);
        if (mine.length) {
          const names = mine.map((s) => rep.get<"task">(s.taskId)?.title ?? "").join(", ");
          for (const s of mine) actions.toggleTimer(s.taskId);
          void platform.notify("타이머 정지", names);
          return;
        }
        // 오늘 할 일 중 가장 최근에 잰 것 (완료 안 한 것)
        const todays = new Map(rep.list("task", (t) => t.day === today && !t.done).map((t) => [t.id, t]));
        const last = rep.list("session", (s) => todays.has(s.taskId)).sort((x, y) => y.start - x.start)[0];
        if (last) {
          actions.toggleTimer(last.taskId);
          void platform.notify("타이머 시작", todays.get(last.taskId)!.title);
        } else {
          void platform.showWidget();
          void platform.notify("다시 시작할 할 일이 없어요", "할 일 옆의 ▶ 를 눌러 주세요");
        }
      }
    };
    void platform.setHotkeys(JSON.parse(hotkeys), onPress).then((failed) => {
      if (failed.length) setToast(`단축키를 등록하지 못했어요: ${failed.join(", ")} — 다른 프로그램이 쓰는 중이에요. 설정에서 바꿀 수 있어요`);
    });
  }, [hotkeys, platform, rep, actions]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(h);
  }, [toast]);
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
  const f = { events: featureOn(rep, "events"), deadlines: featureOn(rep, "deadlines"), mood: featureOn(rep, "mood"), habits: featureOn(rep, "habits"), review: featureOn(rep, "review") };
  const dl = f.deadlines ? upcomingDeadlines(rep, today, 1)[0] : undefined;

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
          {f.events && (
            <button className="chip clickable" title="일정표 열기" onClick={() => void platform.showMain("schedule")}>
              일정 {events.length}
              {next?.time && <span className="num" style={{ color: "var(--accent)" }}>{next.time}</span>}
            </button>
          )}
          {dl && (
            <button className={`chip clickable${showDl ? " on" : ""}`} title="다가오는 마감 펼치기" aria-expanded={showDl} onClick={() => setShowDl(!showDl)}>
              마감 <span className={`tag ${dl.dday <= 3 ? "tag-danger" : dl.dday <= 7 ? "tag-sun" : "tag-accent"}`}>{ddayText(dl.dday)}</span>
            </button>
          )}
          {day !== today && <button className="chip" style={{ cursor: "pointer" }} onClick={() => go(today)}>오늘로</button>}
        </div>

        {showDl && f.deadlines && <div className="card"><DeadlineList today={today} onSelect={openDetail} /></div>}
        {f.events && events.length > 0 && <EventList day={day} now={now} limit={4} onSelect={openDetail} />}
        {guard.pomo && <PomoBar pomo={guard.pomo} setPomo={guard.setPomo} />}
        <InputLine day={day} today={today} />
        <div className="bar" aria-label={`완료 ${done}/${total}`}><i style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></div>
        <TaskList tree={tree} now={now} compact onDetail={openDetail} />

        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="sechead" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>
            <span>{logOpen ? "▾" : "▸"} 오늘의 기록</span>
          </button>
          {logOpen && f.mood && <MoodPicker day={day} />}
        </div>
        {logOpen && (
          <>
            {f.habits && <HabitChips day={day} />}
            <TimelinePreview day={day} now={now} limit={4} />
          </>
        )}
      </main>

      <footer className="w-foot">
        <span>완료 {done}/{total} · 총 <span className="num">{clock(dayTotal(rep, tree, now))}</span></span>
        <span className="row" style={{ gap: 4 }}>
          {f.review && <button className="btn" onClick={() => setReview(true)}>정리하기</button>}
          <button className="btn btn-ghost" onClick={() => void platform.showMain("settings")}>설정</button>
        </span>
      </footer>
      <Snackbar />
      {toast && <div className="snack upper" role="status"><span>{toast}</span></div>}
      {review && (
        <ReviewSheet day={day} onClose={() => setReview(false)} onDone={(msg) => {
          guard.markReviewed(day);
          setReview(false);
          setToast(msg);
        }} />
      )}
      {guard.away && <AwayOverlay away={guard.away} onPick={guard.resolveAway} />}
    </div>
  );
}
