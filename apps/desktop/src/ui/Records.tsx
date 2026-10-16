/**
 * 기록장 (설계 4.3): [다이어리 | 데이트 일기]
 * - 다이어리: 왼쪽 달별 목록 · 검색, 오른쪽 그날 — 기분 · 요약 · [글 | 타임라인]
 * - 데이트 일기: 왼쪽 카드 목록, 오른쪽 상세 (장소 · 별점 · 쓴 돈 · 태그 · 이야기 · 사진 여러 장)
 */
import { useEffect, useRef, useState } from "react";
import type { Photo, RecordItem } from "@dailytodo/core";
import { addDays, dayOf, hhmm, longDay, shortDay, toDate } from "../app/dates.ts";
import {
  DATE, MOODS, dateRecords, daySummary, diaryDays, journalOf, momentsOf, moodOf, parseTags, promptOf,
} from "../app/records.ts";
import { featureOn } from "../app/appearance.ts";
import { timeline } from "../app/selectors.ts";
import { useApp, useData, useNow, useToday } from "../app/store.tsx";
import { allSchemas } from "../app/collections.ts";
import { CalendarPopup } from "./Calendar.tsx";
import { CollectionDesigner, CollectionView } from "./Collection.tsx";
import { DiaryExport } from "./Export.tsx";
import { PaperDiary } from "./Paper.tsx";
import { Close, Left, Right, Trash } from "./icons.tsx";
import { ConflictNotice, Lightbox, PhotoButton, PhotoField, Thumb } from "./photos.tsx";

// ---------- 공용 ----------

/** 기분 얼굴 (v1 draw_face 처럼 입 모양만 다름) */
export function Face({ level, on, size = 22 }: { level: number; on?: boolean; size?: number }) {
  const mouth = ["M6 12.8q3-2.4 6 0", "M6 12.4q3-1 6 0", "M6 12h6", "M6 11.3q3 1.6 6 0", "M5.6 10.8q3.4 3 6.8 0"][level - 1];
  return (
    <svg className={`face${on ? " on" : ""}`} viewBox="0 0 18 18" width={size} height={size} aria-hidden="true">
      <circle className="ring" cx="9" cy="9" r="7.6" />
      <circle className="eye" cx="6.5" cy="7.4" r="1" />
      <circle className="eye" cx="11.5" cy="7.4" r="1" />
      <path d={mouth} />
    </svg>
  );
}

export function MoodPicker({ day }: { day: string }) {
  const { rep, actions } = useApp();
  const cur = moodOf(rep, day)?.level;
  return (
    <div className="moods" role="group" aria-label="기분">
      {MOODS.map((m) => (
        <button key={m.level} className="mood-btn" title={m.label} aria-label={m.label} aria-pressed={cur === m.level}
          onClick={() => actions.setMood(day, m.level)}>
          <Face level={m.level} on={cur === m.level} />
        </button>
      ))}
    </div>
  );
}

/** 입력하는 동안 0.8초마다 · 나갈 때 저장 */
export function useAutosave(value: string, save: (v: string) => void): [string, (v: string) => void, () => void] {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (!dirty.current) setV(value);
  }, [value]);
  const flush = () => {
    clearTimeout(t.current);
    if (dirty.current) {
      dirty.current = false;
      save(v);
    }
  };
  const change = (x: string) => {
    setV(x);
    dirty.current = true;
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      dirty.current = false;
      save(x);
    }, 800);
  };
  useEffect(() => () => clearTimeout(t.current), []);
  return [v, change, flush];
}

// ---------- 다이어리 ----------

function DiaryList({ day, setDay }: { day: string; setDay: (d: string) => void }) {
  const { rep } = useApp();
  const [month, setMonth] = useState(day.slice(0, 7));
  const [q, setQ] = useState("");
  useEffect(() => setMonth(day.slice(0, 7)), [day]);
  const rows = diaryDays(rep, month, q);
  const m = toDate(`${month}-01`);
  const shift = (n: number) => setMonth(dayOf(new Date(m.getFullYear(), m.getMonth() + n, 1)).slice(0, 7));
  return (
    <div className="rec-list">
      <input className="field" placeholder="검색" aria-label="일기 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      {!q && (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="icon-btn" aria-label="이전 달" onClick={() => shift(-1)}><Left /></button>
          <b>{m.getFullYear()}년 {m.getMonth() + 1}월 · {rows.length}편</b>
          <button className="icon-btn" aria-label="다음 달" onClick={() => shift(1)}><Right /></button>
        </div>
      )}
      {q && <span className="label">검색 결과 {rows.length}개</span>}
      {rows.map((r) => (
        <button key={r.day} className={`rec-row${r.day === day ? " on" : ""}`} onClick={() => setDay(r.day)}>
          <b>{shortDay(r.day)} {r.mood && <Face level={r.mood} on size={15} />}</b>
          <span>{r.preview || "기분만 남김"}</span>
        </button>
      ))}
      {!rows.length && <div className="empty">{q ? "찾는 글이 없어요." : "이 달엔 아직 쓴 날이 없어요."}</div>}
    </div>
  );
}

function Essay({ day }: { day: string }) {
  const { rep, actions } = useApp();
  const j = journalOf(rep, day);
  const [text, change, flush] = useAutosave(j?.text ?? "", (v) => actions.saveJournal(journalOf(rep, day)?.id, day, v));
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => flush(), [day]); // 날짜를 바꾸면 바로 저장
  const usePrompt = () => {
    change(`Q. ${promptOf(day)}\n`);
    setTimeout(() => box.current?.focus());
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {j && <ConflictNotice id={j.id} field="text" current={text} />}
      {!text.trim() && <button className="prompt" onClick={usePrompt}>오늘의 질문 · {promptOf(day)} <span className="faint">(누르면 질문과 함께 쓰기)</span></button>}
      <textarea ref={box} className="essay-box" value={text} placeholder="오늘 하루는 어땠나요?" aria-label="일기"
        onChange={(e) => change(e.target.value)} onBlur={flush} />
      <span className="faint" style={{ fontSize: 12, justifySelf: "end" }}>{text.replace(/\n/g, "").length ? `${text.replace(/\n/g, "").length}자` : ""}</span>
    </div>
  );
}

function Timeline({ day }: { day: string }) {
  const { rep, actions } = useApp();
  const now = useNow(true, 60_000);
  const today = useToday();
  const items = timeline(rep, day, now);
  const moments = new Map(momentsOf(rep, day).map((m) => [m.id, m]));
  const [text, setText] = useState("");
  const [time, setTime] = useState(hhmm(now));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lb, setLb] = useState<{ photos: Photo[]; i: number } | null>(null);
  useEffect(() => setTime(hhmm(Date.now())), [day]);
  const add = () => {
    if (!text.trim() && !photos.length) return;
    const [h, m] = time.split(":").map(Number) as [number, number];
    const at = toDate(day);
    at.setHours(h, m, 0, 0);
    actions.addMoment(at.getTime(), text.replace(/^-\s*/, "").trim(), photos);
    setText("");
    setPhotos([]);
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="timeline">
        {items.map((it) => {
          const m = it.kind === "moment" ? moments.get(it.id) : undefined;
          return (
            <div key={`${it.kind}-${it.id}`} className={`tl-row${it.auto ? " auto" : ""}`}>
              <span className="when num">{hhmm(it.at)}</span>
              <i className="pin" />
              <div className="what">
                {it.text}
                {it.auto && <small>{it.kind === "done" ? "할 일 · 자동" : "일정 · 자동"}</small>}
                {m?.photos?.length ? (
                  <div className="thumbs">{m.photos.map((p, i) => <Thumb key={p.id} photo={p} onClick={() => setLb({ photos: m.photos!, i })} />)}</div>
                ) : null}
              </div>
              {m && <button className="icon-btn row-del" aria-label="이 기록 지우기" onClick={() => actions.remove(m.id, "기록 지움")}><Trash /></button>}
            </div>
          );
        })}
        {!items.length && <div className="empty">완료한 할 일 · 일정이 자동으로 쌓이고, 아래에 직접 남길 수 있어요.</div>}
      </div>
      <div className="compose">
        <span className="kind">기록</span>
        <input type="time" className="time-in" value={time} onChange={(e) => setTime(e.target.value)} aria-label="시각" />
        <input value={text} placeholder={day === today ? "지금 남기기…" : `${shortDay(day)}에 남기기…`} aria-label="타임라인 기록"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
        <PhotoButton onAdd={(ps) => setPhotos((x) => [...x, ...ps])} />
        <button className="btn btn-accent" onClick={add}>남기기</button>
      </div>
      {photos.length > 0 && (
        <div className="thumbs">
          {photos.map((p) => (
            <span key={p.id} className="thumb-wrap">
              <Thumb photo={p} size={64} />
              <button className="x" aria-label="빼기" onClick={() => setPhotos((x) => x.filter((y) => y !== p))}><Close /></button>
            </span>
          ))}
        </div>
      )}
      {lb && <Lightbox photos={lb.photos} index={lb.i} onClose={() => setLb(null)} />}
    </div>
  );
}

function Diary() {
  const { rep } = useApp();
  useData();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [view, setView] = useState<"essay" | "tl" | "paper">("tl");
  const [cal, setCal] = useState(false);
  return (
    <div className="records">
      <DiaryList day={day} setDay={setDay} />
      <div className="rec-main">
        <div className="center-head">
          <button className="icon-btn" aria-label="전날" onClick={() => setDay(addDays(day, -1))}><Left /></button>
          <span className="pop-anchor">
            <h1 className="clickable" onClick={() => setCal(!cal)}>{longDay(day)}</h1>
            {cal && <CalendarPopup value={day} today={today} onPick={setDay} onClose={() => setCal(false)} />}
          </span>
          <button className="icon-btn" aria-label="다음 날" onClick={() => setDay(addDays(day, 1))}><Right /></button>
          {day !== today && <button className="btn" onClick={() => setDay(today)}>오늘로</button>}
          {featureOn(rep, "mood") && <span style={{ marginLeft: "auto" }}><MoodPicker day={day} /></span>}
        </div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 13 }}>{daySummary(rep, day, Date.now())}</span>
          <span style={{ flex: 1 }} />
          <DiaryExport day={day} />
          <div className="seg" role="group" aria-label="보기">
            <button aria-pressed={view === "essay"} onClick={() => setView("essay")}>글</button>
            <button aria-pressed={view === "tl"} onClick={() => setView("tl")}>타임라인</button>
            <button aria-pressed={view === "paper"} onClick={() => setView("paper")}>꾸미기</button>
          </div>
        </div>
        {view === "essay" ? <Essay key={day} day={day} /> : view === "paper" ? <PaperDiary day={day} /> : <Timeline day={day} />}
      </div>
    </div>
  );
}

// ---------- 데이트 일기 ----------

export function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className="stars" role={onChange ? "radiogroup" : undefined} aria-label={`별점 ${value}`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onChange ? (
          <button key={n} role="radio" aria-checked={value === n} aria-label={`${n}점`} onClick={() => onChange(value === n ? 0 : n)}>{n <= value ? "★" : "☆"}</button>
        ) : (
          <span key={n}>{n <= value ? "★" : "☆"}</span>
        ),
      )}
    </span>
  );
}

function DateCard({ r, on, onClick }: { r: RecordItem; on: boolean; onClick: () => void }) {
  const cover = r.f?.photos?.[0];
  return (
    <button className={`date-card${on ? " on" : ""}`} onClick={onClick}>
      <span className="cover">{cover ? <Thumb photo={cover} size={56} /> : <span className="no-photo" />}</span>
      <span className="info">
        <b>{r.title}</b>
        <span className="muted">{r.day ? shortDay(r.day) : ""}{r.f?.where ? ` · ${String(r.f.where)}` : ""}</span>
        {Number(r.f?.rating) > 0 && <Stars value={Number(r.f!.rating)} />}
      </span>
    </button>
  );
}

export function Field({ label, value, onSave, placeholder, inputMode }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string; inputMode?: "numeric" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const id = `f-${label}`;
  return (
    <>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="field" value={v} placeholder={placeholder} inputMode={inputMode}
        onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
    </>
  );
}

function DateEditor({ r, onClose }: { r: RecordItem; onClose: () => void }) {
  const { actions } = useApp();
  const [note, change, flush] = useAutosave(r.note ?? "", (v) => actions.update(r.id, { note: v }, "이야기 고침"));
  useEffect(() => () => flush(), [r.id]);
  return (
    <div className="rec-main">
      <div className="panel-head">
        <span className="label">데이트 일기</span>
        <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
      </div>
      <Field label="제목" value={r.title} onSave={(v) => v.trim() && actions.update(r.id, { title: v.trim() }, "제목 고침")} />
      <div className="form-grid">
        <div className="stack">
          <label className="label" htmlFor="d-day">날짜</label>
          <input id="d-day" type="date" className="field" value={r.day ?? ""} onChange={(e) => e.target.value && actions.update(r.id, { day: e.target.value }, "날짜 고침")} />
        </div>
        <div className="stack"><Field label="장소 · 코스" value={String(r.f?.where ?? "")} onSave={(v) => actions.update(r.id, { f: { where: v } }, "장소 고침")} placeholder="성수 카페거리 → 서울숲" /></div>
        <div className="stack"><Field label="쓴 돈" value={String(r.f?.cost ?? "")} onSave={(v) => actions.update(r.id, { f: { cost: v } }, "쓴 돈 고침")} placeholder="52000" /></div>
        <div className="stack">
          <span className="label">오늘의 별점</span>
          <Stars value={Number(r.f?.rating ?? 0)} onChange={(n) => actions.update(r.id, { f: { rating: n } }, "별점 고침")} />
        </div>
      </div>
      <Field label="태그" value={(r.tags ?? []).map((t) => `#${t}`).join(" ")} onSave={(v) => actions.update(r.id, { tags: parseTags(v) }, "태그 고침")} placeholder="#기념일 #맛집" />

      <PhotoField r={r} />

      <span className="label">무엇을 했는지 · 좋았던 순간 · 다음에 하고 싶은 것</span>
      <ConflictNotice id={r.id} field="note" current={note} />
      <textarea className="essay-box" style={{ minHeight: 160 }} value={note} aria-label="이야기" onChange={(e) => change(e.target.value)} onBlur={flush} />
      <div className="row">
        <button className="btn" onClick={() => { actions.remove(r.id, `'${r.title}' 지움`); onClose(); }}><Trash /> 지우기</button>
      </div>
    </div>
  );
}

function DateDiary({ select }: { select?: string }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(select ?? null);
  const list = dateRecords(rep, q);
  const r = sel ? rep.get<"record">(sel) : undefined;
  return (
    <div className="records">
      <div className="rec-list">
        <button className="btn btn-accent" onClick={() => setSel(actions.addRecord(DATE, { title: "새 데이트", day: today }))}>+ 새 데이트</button>
        <input className="field" placeholder="검색 (제목 · 장소 · 태그)" aria-label="데이트 일기 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="label">{list.length}개</span>
        {list.map((x) => <DateCard key={x.id} r={x} on={x.id === sel} onClick={() => setSel(x.id)} />)}
        {!list.length && <div className="empty">함께한 날을 남겨 보세요. 어디서 무엇을 했는지, 좋았던 순간 하나만 적어도 충분해요.</div>}
      </div>
      {r ? <DateEditor key={r.id} r={r} onClose={() => setSel(null)} /> : (
        <div className="rec-main"><div className="empty">왼쪽에서 하루를 고르면 장소 · 사진 · 그날 이야기를 적을 수 있어요.</div></div>
      )}
    </div>
  );
}

/** 기록장: 다이어리 · 데이트 일기 · 모음들(기본 넷 + 사용자 정의) — 꺼 둔 기능의 모음은 숨김 */
export function Records({ initial = "diary", select }: { initial?: string; select?: string }) {
  const { rep } = useApp();
  useData();
  const [tab, setTab] = useState<string>(initial);
  const [design, setDesign] = useState<"new" | string | null>(null);
  useEffect(() => setTab(initial), [initial]);
  const schemas = allSchemas(rep).filter((s) => !s.feature || featureOn(rep, s.feature));
  const tabs: [string, string][] = [
    ["diary", "다이어리"],
    ...(featureOn(rep, "date") ? [["date", "데이트 일기"] as [string, string]] : []),
    ...schemas.map((s) => [s.key, s.label] as [string, string]),
  ];
  const cur = tabs.some(([k]) => k === tab) ? tab : "diary";
  const schema = schemas.find((s) => s.key === cur);
  const def = schema?.custom ? rep.get<"collection">(schema.key) : undefined;
  return (
    <>
      <div className="center-head">
        <h1>기록장</h1>
        <div className="rec-tabs" role="tablist" aria-label="모음">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={cur === k} className={cur === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
          <button className="add" title="새 모음 만들기" onClick={() => setDesign("new")}>+ 모음</button>
        </div>
        {def && <button className="btn btn-ghost" onClick={() => setDesign(def.id)}>모음 고치기</button>}
      </div>
      {cur === "date" ? <DateDiary select={select} /> : schema ? <CollectionView s={schema} /> : <Diary />}
      {design && (
        <CollectionDesigner def={design === "new" ? undefined : rep.get<"collection">(design)} onClose={() => setDesign(null)}
          onSaved={(id) => { setDesign(null); setTab(id); }} />
      )}
    </>
  );
}
