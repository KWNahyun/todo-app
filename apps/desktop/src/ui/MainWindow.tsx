/** 메인 창: 왼쪽 메뉴 · 가운데 · 오른쪽 상세 (설계 4장) */
import { useEffect, useState } from "react";
import { featureOn, type FeatureId } from "../app/appearance.ts";
import { addDays, clock, longDay } from "../app/dates.ts";
import { dayTotal, dayTree, progress, runningSessions } from "../app/selectors.ts";
import { useApp, useData, useNow, useSync, useToday } from "../app/store.tsx";
import type { Screen } from "../platform/index.ts";
import { CalendarPopup } from "./Calendar.tsx";
import { Detail } from "./Detail.tsx";
import { Left, Right } from "./icons.tsx";
import { DeadlineList, EventList, InputLine, Snackbar, TimelinePreview } from "./parts.tsx";
import { Goals } from "./Goals.tsx";
import { Palette, type Go } from "./Palette.tsx";
import { Records } from "./Records.tsx";
import { Stats } from "./Stats.tsx";
import { Schedule } from "./Schedule.tsx";
import { Settings } from "./Settings.tsx";
import { TaskList } from "./TaskList.tsx";

/** 메뉴 — 기능을 꺼 두면 메뉴에서도 사라짐 */
const MENU: { id: Screen; label: string; needs?: FeatureId[] }[] = [
  { id: "today", label: "오늘" },
  { id: "schedule", label: "일정표", needs: ["events", "deadlines"] },
  { id: "records", label: "기록장" },
  { id: "stats", label: "통계", needs: ["stats"] },
  { id: "goals", label: "목표", needs: ["goals", "habits", "mandala"] },
];

function SyncBadge({ onClick }: { onClick: () => void }) {
  const s = useSync();
  const text =
    s.state === "error" ? "동기화 문제" : s.state === "syncing" && !s.last ? "맞추는 중" : s.last ? `동기화 · ${new Date(s.last).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "동기화";
  return (
    <button className={`sync ${s.state}`} title={s.error ?? "누르면 설정"} onClick={onClick}>
      <i />{text}
    </button>
  );
}

function Today({ selected, setSelected }: { selected: string | null; setSelected: (id: string | null) => void }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [cal, setCal] = useState(false);
  const running = runningSessions(rep).length > 0;
  const now = useNow(true, running ? 1000 : 20_000);
  const tree = dayTree(rep, day);
  const { done, total } = progress(tree);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      if (e.key === "Escape") setSelected(null);
      if (e.key === "Delete" && selected) {
        if (rep.get(selected)?.type === "task") actions.removeTask(selected);
        else actions.remove(selected);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, actions, setSelected, rep]);

  return (
    <>
      <div className="center-head">
        <button className="icon-btn" aria-label="전날" onClick={() => setDay(addDays(day, -1))}><Left /></button>
        <span className="pop-anchor">
          <h1 className="clickable" title="달력" onClick={() => setCal(!cal)}>{longDay(day)}</h1>
          {cal && <CalendarPopup value={day} today={today} onPick={setDay} onClose={() => setCal(false)} />}
        </span>
        <button className="icon-btn" aria-label="다음 날" onClick={() => setDay(addDays(day, 1))}><Right /></button>
        {day !== today && <button className="btn" onClick={() => setDay(today)}>오늘로</button>}
        <span className="stats">완료 {done}/{total} · <span className="num">{clock(dayTotal(rep, tree, now))}</span>{running ? " · 재는 중" : ""}</span>
      </div>
      <InputLine day={day} today={today} autoFocus />
      <div className="bar"><i style={{ width: total ? `${(done / total) * 100}%` : 0 }} /></div>
      <div className="cols">
        <TaskList tree={tree} now={now} selected={selected} onSelect={(id) => setSelected(id === selected ? null : id)} onDetail={setSelected} />
        <div className="stack" style={{ gap: 12 }}>
          {featureOn(rep, "events") && <div className="card"><span className="label">{day === today ? "오늘 일정" : "이날 일정"}</span><EventList day={day} now={now} onSelect={setSelected} /></div>}
          {featureOn(rep, "deadlines") && <div className="card"><span className="label">다가오는 마감</span><DeadlineList today={today} onSelect={setSelected} /></div>}
          <div className="card"><span className="label">오늘의 기록</span><TimelinePreview day={day} now={now} /></div>
        </div>
      </div>
    </>
  );
}

export function MainWindow() {
  const { platform, rep } = useApp();
  useData();
  const [screen, setScreen] = useState<Screen>(() => (location.hash.slice(1) as Screen) || "today");
  const [selected, setSelected] = useState<string | null>(null);
  const now = useNow(!!selected, 1000);
  const [palette, setPalette] = useState(false);
  const [rec, setRec] = useState<{ tab: string; dateId?: string }>({ tab: "diary" });
  const go = (s: Screen) => {
    setScreen(s);
    setSelected(null);
  };
  const goTo = (g: Go) => {
    go(g.screen);
    if (g.select) setSelected(g.select);
    if (g.recordsTab) setRec({ tab: g.recordsTab, dateId: g.dateId });
  };
  // 위젯에서: "today" 또는 "today|<항목 ID>" (상세 패널에 열기)
  useEffect(() => platform.on("open-screen", (p) => {
    if (!p) return;
    const [s, id] = p.split("|");
    go(s as Screen);
    if (id) setSelected(id);
  }), [platform]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="window">
      <nav className="nav" aria-label="메뉴">
        <div className="brand">❦ Daily Todo</div>
        {MENU.filter((m) => !m.needs || m.needs.some((f) => featureOn(rep, f))).map((m) => (
          <button key={m.id} className={screen === m.id ? "on" : ""} aria-current={screen === m.id ? "page" : undefined} onClick={() => go(m.id)}>
            {m.label}
          </button>
        ))}
        <div className="grow" />
        <button className="k-hint" onClick={() => setPalette(true)}>찾기 · 실행 <small>Ctrl+K</small></button>
        <button className={screen === "settings" ? "on" : ""} onClick={() => go("settings")}>설정</button>
        <SyncBadge onClick={() => go("settings")} />
      </nav>
      <main className="center">
        {screen === "today" && <Today selected={selected} setSelected={setSelected} />}
        {screen === "schedule" && <Schedule selected={selected} onSelect={(id) => setSelected(id === selected ? null : id)} />}
        {screen === "records" && <Records key={rec.dateId ?? rec.tab} initial={rec.tab} select={rec.dateId} />}
        {screen === "stats" && <Stats />}
        {screen === "goals" && <Goals />}
        {screen === "settings" && (
          <>
            <div className="center-head"><h1>설정</h1></div>
            <Settings />
          </>
        )}
      </main>
      {(screen === "today" || screen === "schedule") && selected && <Detail id={selected} now={now} onClose={() => setSelected(null)} />}
      <Snackbar />
      {palette && <Palette onClose={() => setPalette(false)} go={goTo} />}
    </div>
  );
}
