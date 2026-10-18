/**
 * 휴대폰 첫 버전 (설계 5장 · 13장): 아래 탭 [오늘 | 일정 | 데이트] + 오른쪽 위 설정.
 * - 오늘: 다가오는 일정 · 3일 안의 마감 + 할 일 체크 (타이머는 PC 에서), ＋ 는 PC 와 같은 입력 한 줄
 * - 일정: 달력 · 그날 일정과 마감, ＋ 로 추가, 누르면 고치기
 * - 데이트: 카드 목록, ＋ 로 새 기록 (사진부터)
 * PC 와 같은 복제본 · 같은 동작(되돌리기 포함)을 그대로 씀 — 화면만 손에 맞게.
 */
import { useEffect, useState, type ReactNode } from "react";
import { addDays, ddayText, longDay, shortDay, toDate } from "../app/dates.ts";
import { THEMES, featureOn, sharedSettings } from "../app/appearance.ts";
import { parseScheduleInput } from "../app/parse.ts";
import { DATE, dateRecords } from "../app/records.ts";
import { itemsByDay } from "../app/schedule.ts";
import { dayTree, eventsOf, nextEvent, progress, upcomingDeadlines } from "../app/selectors.ts";
import { useApp, useData, useNow, useSync, useToday } from "../app/store.tsx";
import { MiniCalendar } from "./Calendar.tsx";
import { Detail } from "./Detail.tsx";
import { Close, Left, Right } from "./icons.tsx";
import { InputLine, Snackbar } from "./parts.tsx";
import { DateCard, DateEditor } from "./Records.tsx";
import { TaskList } from "./TaskList.tsx";

type Tab = "today" | "schedule" | "date";

/** 아래에서 올라오는 패널 */
function Sheet({ title, onClose, children, full }: { title: string; onClose: () => void; children: ReactNode; full?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="p-sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`p-sheet${full ? " full" : ""}`} role="dialog" aria-label={title}>
        <div className="p-sheet-head">
          <b>{title}</b>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
        </div>
        <div className="p-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (tab === "today") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" {...S} /><path d="M8.5 12.5l2.5 2.5 4.5-5" {...S} /></svg>;
  if (tab === "schedule") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5" {...S} /><path d="M4 10h16M9 3v4M15 3v4" {...S} /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19s-7-4.4-7-9.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 1.8C19 14.6 12 19 12 19z" {...S} /></svg>;
}

// ---------- 오늘 ----------

function TodayTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { rep } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [add, setAdd] = useState(false);
  const now = useNow(true, 30_000);
  const tree = dayTree(rep, day);
  const { done, total } = progress(tree);
  const events = featureOn(rep, "events") ? eventsOf(rep, day) : [];
  const next = nextEvent(events, day, now) ?? (day !== today ? events[0] : undefined);
  const soon = featureOn(rep, "deadlines") ? upcomingDeadlines(rep, today, 5).filter((d) => d.dday <= 3) : [];
  return (
    <>
      <header className="p-head">
        <button className="icon-btn" aria-label="전날" onClick={() => setDay(addDays(day, -1))}><Left /></button>
        <h1 onClick={() => setDay(today)}>{longDay(day).replace("요일", "")}</h1>
        <button className="icon-btn" aria-label="다음 날" onClick={() => setDay(addDays(day, 1))}><Right /></button>
      </header>
      <div className="p-body">
        {(next || soon.length > 0) && (
          <div className="stack">
            {next && (
              <div className="ev next clickable" onClick={() => onOpen(next.id)}>
                <span className="when num">{next.time ?? "미정"}</span><span className="what">{next.title}</span>
                {events.length > 1 && <span className="left">외 {events.length - 1}개</span>}
              </div>
            )}
            {soon.map((d) => (
              <div key={d.id} className="dl p-dl clickable" onClick={() => onOpen(d.id)}>
                <span className="tag tag-danger">{ddayText(d.dday)}</span><span className="what">{d.title}</span>
              </div>
            ))}
          </div>
        )}
        {total > 0 && <div className="bar" aria-label={`완료 ${done}/${total}`}><i style={{ width: `${(done / total) * 100}%` }} /></div>}
        <TaskList tree={tree} now={now} phone onSelect={onOpen} onDetail={onOpen} />
        {day !== today && <button className="btn" onClick={() => setDay(today)}>오늘로</button>}
      </div>
      <button className="fab" aria-label="추가" onClick={() => setAdd(true)}>＋</button>
      {add && (
        <Sheet title={`${shortDay(day)}에 추가`} onClose={() => setAdd(false)}>
          <InputLine day={day} today={today} autoFocus />
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>할 일 · <code>KAMP &gt; 발표</code> · <code>13:30 회의</code> · <code>마감 10/20 제출</code> · <code>- 기록</code></p>
        </Sheet>
      )}
    </>
  );
}

// ---------- 일정 ----------

function ScheduleTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [add, setAdd] = useState<"event" | "deadline" | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(day, i));
  const items = itemsByDay(rep, days);
  const submit = () => {
    const p = parseScheduleInput(text, add!, day, today);
    if (p.kind === "error") return setMsg(p.message);
    actions.addDated(p);
    setText("");
    setMsg(null);
    setAdd(null);
    setDay(p.kind === "event" ? p.day : p.date);
  };
  return (
    <>
      <header className="p-head"><h1>일정</h1></header>
      <div className="p-body">
        <div className="p-cal"><MiniCalendar value={day} today={today} onPick={setDay} /></div>
        {days.map((d) => {
          const it = items.get(d)!;
          if (d !== day && !it.events.length && !it.deadlines.length) return null;
          return (
            <section key={d} className="p-day">
              <div className={`day-h${toDate(d).getDay() === 0 ? " sun" : ""}`}>{shortDay(d)}{d === today ? " · 오늘" : ""}</div>
              {it.deadlines.map((x) => (
                <div key={x.id} className="dl p-dl clickable" onClick={() => onOpen(x.id)}><span className="tag tag-danger">마감</span><span className="what">{x.title}</span></div>
              ))}
              {it.events.map((x) => (
                <div key={x.id} className="ev clickable" onClick={() => onOpen(x.id)}><span className="when num">{x.time ?? "미정"}</span><span className="what">{x.title}</span></div>
              ))}
              {d === day && !it.events.length && !it.deadlines.length && <div className="empty">일정 · 마감 없음</div>}
            </section>
          );
        })}
      </div>
      <button className="fab" aria-label="일정 추가" onClick={() => setAdd("event")}>＋</button>
      {add && (
        <Sheet title={`${shortDay(day)}에 추가`} onClose={() => setAdd(null)}>
          <div className="seg" role="group" aria-label="종류">
            <button aria-pressed={add === "event"} onClick={() => setAdd("event")}>일정</button>
            <button aria-pressed={add === "deadline"} onClick={() => setAdd("deadline")}>마감</button>
          </div>
          <div className="input">
            <input autoFocus value={text} aria-label="일정 입력" placeholder={add === "event" ? "13:30 회의 · 10/7 MT" : "KAMP 제출 · 10/20 보고서"}
              onChange={(e) => { setText(e.target.value); setMsg(null); }}
              onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && submit()} />
            <button className="btn btn-accent" onClick={submit}>추가</button>
          </div>
          {msg && <div className="input-msg">{msg}</div>}
        </Sheet>
      )}
    </>
  );
}

// ---------- 데이트 ----------

function DateTab() {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const list = dateRecords(rep, q);
  const r = open ? rep.get<"record">(open) : undefined;
  return (
    <>
      <header className="p-head"><h1>데이트 일기</h1></header>
      <div className="p-body">
        <input className="field" placeholder="검색 (제목 · 장소 · 태그)" aria-label="데이트 일기 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="p-cards">
          {list.map((x) => <DateCard key={x.id} r={x} on={false} onClick={() => setOpen(x.id)} />)}
        </div>
        {!list.length && <div className="empty">함께한 날을 남겨 보세요. ＋ 를 누르면 사진부터 고를 수 있어요.</div>}
      </div>
      <button className="fab" aria-label="새 데이트" onClick={() => setOpen(actions.addRecord(DATE, { title: "새 데이트", day: today }))}>＋</button>
      {r && (
        <Sheet title={r.title} onClose={() => setOpen(null)} full>
          <DateEditor key={r.id} r={r} onClose={() => setOpen(null)} />
        </Sheet>
      )}
    </>
  );
}

// ---------- 설정 ----------

function PhoneSettings({ onClose }: { onClose: () => void }) {
  const { rep, actions, platform, engine, config } = useApp();
  useData();
  const sync = useSync();
  const shared = sharedSettings(rep);
  return (
    <Sheet title="설정" onClose={onClose} full>
      <section className="stack">
        <span className="label">동기화 (Syncthing)</span>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {platform.kind === "web" ? "브라우저 미리보기 — PC 화면과 같은 저장소를 봐요." : `보관함 폴더 · ${config.vaultRoot ?? ""} — PC 와 휴대폰이 둘 다 켜져 있을 때 주고받아요`}
        </p>
        <div className="row">
          <button className="btn" onClick={() => void engine.syncNow()}>지금 맞추기</button>
          <span className="muted" style={{ fontSize: 13 }}>
            {sync.state === "error" ? `문제: ${sync.error}` : sync.last ? `마지막 ${new Date(sync.last).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}` : "맞추는 중…"}
          </span>
        </div>
      </section>
      <section className="stack">
        <span className="label">테마 (모든 기기 공통)</span>
        <div className="theme-pick">
          {THEMES.map((t) => (
            <button key={t.id} aria-pressed={(shared.theme ?? "minimal") === t.id} onClick={() => actions.setShared({ theme: t.id }, `테마: ${t.label}`)}>
              <i className="dot" style={{ background: t.swatch }} />{t.label}
            </button>
          ))}
        </div>
      </section>
      <p className="faint" style={{ fontSize: 12 }}>타이머 · 기분 · 습관 · 기록장 · 통계는 PC 에서 — 기록은 모두 동기화돼요.</p>
    </Sheet>
  );
}

export function Phone() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem("dt-phone-tab") as Tab) || "today";
    } catch {
      return "today";
    }
  });
  const [detail, setDetail] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const { rep } = useApp();
  useData();
  const go = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("dt-phone-tab", t);
    } catch {
      // 기억 못 해도 그만
    }
  };
  const date = featureOn(rep, "date");
  const tabs: [Tab, string][] = [["today", "오늘"], ["schedule", "일정"], ...(date ? [["date", "데이트"] as [Tab, string]] : [])];
  return (
    <div className="phone-app">
      <button className="icon-btn p-gear" aria-label="설정" onClick={() => setSettings(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      <main className="p-main">
        {tab === "today" && <TodayTab onOpen={setDetail} />}
        {tab === "schedule" && <ScheduleTab onOpen={setDetail} />}
        {tab === "date" && date && <DateTab />}
      </main>
      <nav className="p-tabs" aria-label="탭">
        {tabs.map(([t, l]) => (
          <button key={t} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => go(t)}>
            <TabIcon tab={t} />{l}
          </button>
        ))}
      </nav>
      {detail && (
        <Sheet title="자세히" onClose={() => setDetail(null)}>
          <Detail id={detail} now={Date.now()} onClose={() => setDetail(null)} />
        </Sheet>
      )}
      {settings && <PhoneSettings onClose={() => setSettings(false)} />}
      <Snackbar />
    </div>
  );
}
