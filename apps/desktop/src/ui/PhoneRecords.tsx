/**
 * 휴대폰 기록 탭: PC 기록장을 손에 맞게.
 * - 위: 모음 칩 (다이어리 · 데이트 일기 · 버킷리스트 · …)
 * - 데이트 일기: 카드 목록, ＋ 로 새 기록 → 시트에서 사진 · 장소 · 별점 · 이야기
 * - 다이어리: 날짜 한 줄(누르면 지난 기록 목록) → 기분 → [글 | 타임라인] → 쓰는 칸이 화면 대부분
 * - 모음: 목록만, 누르면 아래에서 올라오는 시트로 자세히
 */
import { useState } from "react";
import { featureOn } from "../app/appearance.ts";
import { allSchemas } from "../app/collections.ts";
import { addDays, longDay } from "../app/dates.ts";
import { DATE, dateRecords, daySummary } from "../app/records.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { CollectionView } from "./Collection.tsx";
import { Caret, Left, Right } from "./icons.tsx";
import { DateCard, DateEditor, DiaryList, Essay, MoodPicker, Timeline } from "./Records.tsx";
import { Sheet } from "./Sheet.tsx";

type View = "essay" | "tl";

function remembered<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 기억 못 해도 그만
  }
}

function PhoneDiary() {
  const { rep } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [view, setView] = useState<View>(() => remembered<View>("dt-phone-diary-view", "essay"));
  const [list, setList] = useState(false);
  const pickView = (v: View) => {
    setView(v);
    remember("dt-phone-diary-view", v);
  };
  return (
    <>
      <div className="p-daybar">
        <button className="icon-btn" aria-label="전날" onClick={() => setDay(addDays(day, -1))}><Left /></button>
        <button className="p-daybtn" onClick={() => setList(true)} aria-haspopup="dialog">
          {longDay(day)}{day === today ? " · 오늘" : ""} <Caret />
        </button>
        <button className="icon-btn" aria-label="다음 날" onClick={() => setDay(addDays(day, 1))}><Right /></button>
      </div>
      {day !== today && <button className="chip p-today" onClick={() => setDay(today)}>오늘로</button>}
      {featureOn(rep, "mood") && <div className="p-mood"><MoodPicker day={day} /></div>}
      <div className="muted p-summary">{daySummary(rep, day, Date.now())}</div>
      <div className="seg p-seg" role="group" aria-label="보기">
        <button aria-pressed={view === "essay"} onClick={() => pickView("essay")}>글</button>
        <button aria-pressed={view === "tl"} onClick={() => pickView("tl")}>타임라인</button>
      </div>
      {view === "essay" ? <Essay key={day} day={day} /> : <Timeline day={day} />}
      {list && (
        <Sheet title="지난 기록" onClose={() => setList(false)} full>
          <DiaryList day={day} setDay={(d) => { setDay(d); setList(false); }} />
        </Sheet>
      )}
    </>
  );
}

// ---------- 데이트 일기 (목록 → 누르면 시트) ----------

function PhoneDate() {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const list = dateRecords(rep, q);
  const r = open ? rep.get<"record">(open) : undefined;
  return (
    <>
      <div className="stack" style={{ gap: 10 }}>
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

export function PhoneRecords() {
  const { rep } = useApp();
  useData();
  const schemas = allSchemas(rep).filter((s) => s.key !== "date" && (!s.feature || featureOn(rep, s.feature)));
  const date = featureOn(rep, "date");
  const [tab, setTab] = useState<string>(() => remembered<string>("dt-phone-rec-tab", "diary"));
  const cur = schemas.some((s) => s.key === tab) || (date && tab === "date") ? tab : "diary";
  const schema = schemas.find((s) => s.key === cur);
  const pick = (k: string) => {
    setTab(k);
    remember("dt-phone-rec-tab", k);
  };
  return (
    <>
      <header className="p-head"><h1>기록</h1></header>
      <div className="p-chips" role="tablist" aria-label="모음">
        {[["diary", "다이어리"] as const, ...(date ? [["date", "데이트 일기"] as const] : []), ...schemas.map((s) => [s.key, s.label] as const)].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={cur === k} className={`chip${cur === k ? " on" : ""}`} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      <div className="p-body p-rec">
        {cur === "date" ? <PhoneDate /> : schema ? <CollectionView key={schema.key} s={schema} phone /> : <PhoneDiary />}
      </div>
    </>
  );
}
