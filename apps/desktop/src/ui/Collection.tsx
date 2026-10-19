/**
 * 기록장 모음 화면 (v1 ListView): 왼쪽 목록(상태 · 종류 · 태그 · 검색), 오른쪽 상세.
 * 모음마다 다른 칸은 Schema 를 보고 그림 — 기본 모음 넷과 사용자 정의 모음이 같은 화면.
 */
import { useEffect, useState } from "react";
import type { CollectionDef, RecordItem } from "@dailytodo/core";
import { fieldKey, isDone, items, splitTags, subtitle, tagsOf, type Field as F, type FieldKind, type ListFilter, type Schema } from "../app/collections.ts";
import { featureOn } from "../app/appearance.ts";
import { shortDay } from "../app/dates.ts";
import { parseTags } from "../app/records.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { CollectionExport } from "./Export.tsx";
import { Check, Close, Trash } from "./icons.tsx";
import { ConflictNotice, PhotoField, Thumb } from "./photos.tsx";
import { Sheet } from "./Sheet.tsx";
import { Field, Stars, useAutosave } from "./Records.tsx";

function Row({ s, r, on, onClick }: { s: Schema; r: RecordItem; on: boolean; onClick: () => void }) {
  const { actions } = useApp();
  const today = useToday();
  const done = isDone(s, r);
  const cover = r.f?.photos?.[0];
  return (
    <div className={`rec-row col-row${on ? " on" : ""}${done ? " done" : ""}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}>
      {s.mode === "done" && (
        <button className="check" role="checkbox" aria-checked={done} aria-label={`${r.title} ${s.doneWord}`}
          onClick={(e) => { e.stopPropagation(); actions.setRecordDone(r.id, !done, today); }}>
          <Check />
        </button>
      )}
      <span className="col-text">
        <b>{r.title}</b>
        <span>
          {[
            s.mode === "stages" ? s.stages![r.stage ?? 0] : "",
            s.mode === "log" && r.day ? shortDay(r.day) : "",
            subtitle(s, r) || (r.tags ?? []).map((t) => `#${t}`).join(" "),
          ].filter(Boolean).join(" · ")}
        </span>
      </span>
      {cover && <Thumb photo={cover} size={36} />}
    </div>
  );
}

function FieldInput({ f, r }: { f: F; r: RecordItem }) {
  const { actions } = useApp();
  const v = r.f?.[f.key];
  const save = (x: unknown) => actions.update(r.id, { f: { [f.key]: x } }, `${f.label} 고침`);
  switch (f.kind) {
    case "rating":
      return <div className="stack"><span className="label">{f.label}</span><Stars value={Number(v ?? 0)} onChange={save} /></div>;
    case "choice":
      return (
        <div className="stack"><span className="label">{f.label}</span>
          <div className="seg" role="group" aria-label={f.label}>
            {(f.options ?? []).map((o) => <button key={o} aria-pressed={v === o} onClick={() => save(v === o ? null : o)}>{o}</button>)}
          </div>
        </div>
      );
    case "date":
      return (
        <div className="stack"><label className="label" htmlFor={`f-${f.key}`}>{f.label}</label>
          <input id={`f-${f.key}`} type="date" className="field" value={String(v ?? "")} onChange={(e) => save(e.target.value || null)} />
        </div>
      );
    case "number":
      return <div className="stack"><Field label={f.label} value={v == null ? "" : String(v)} inputMode="numeric" onSave={(x) => save(x.trim() === "" ? null : Number(x.replace(/[^\d.-]/g, "")))} /></div>;
    case "photos":
      return null; // 아래 사진 칸에서
    default:
      return <div className="stack"><Field label={f.label} value={String(v ?? "")} onSave={save} /></div>;
  }
}

function Editor({ s, r, onClose }: { s: Schema; r: RecordItem; onClose: () => void }) {
  const { rep, actions, platform } = useApp();
  const today = useToday();
  const [note, change, flush] = useAutosave(r.note ?? "", (v) => actions.update(r.id, { note: v }, "메모 고침"));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => () => flush(), [r.id]);
  useEffect(() => setMsg(null), [r.id]);
  const done = isDone(s, r);
  const photos = s.fields.find((f) => f.kind === "photos");
  return (
    <div className="rec-main">
      <div className="panel-head">
        <span className="label">{s.label}</span>
        <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
      </div>
      <Field label="제목" value={r.title} onSave={(v) => v.trim() && actions.update(r.id, { title: v.trim() }, "제목 고침")} />

      {s.mode === "done" && (
        <label className="row" style={{ gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={done} onChange={(e) => {
            actions.setRecordDone(r.id, e.target.checked, today);
            if (e.target.checked && s.celebrate) void platform.notify(s.celebrate.replace("{title}", r.title), s.label);
          }} />
          {s.doneWord}{r.doneOn ? ` · ${shortDay(r.doneOn)}` : ""}
        </label>
      )}
      {s.mode === "stages" && (
        <div className="row">
          <div className="seg" role="group" aria-label="단계">
            {s.stages!.map((st, i) => <button key={st} aria-pressed={(r.stage ?? 0) === i} onClick={() => actions.setRecordStage(s, r.id, i, today)}>{st}</button>)}
          </div>
          {done && r.doneOn && <span className="muted" style={{ fontSize: 13 }}>{shortDay(r.doneOn)}</span>}
        </div>
      )}
      {s.mode === "log" && (
        <div className="stack" style={{ maxWidth: 200 }}>
          <label className="label" htmlFor="c-day">날짜</label>
          <input id="c-day" type="date" className="field" value={r.day ?? ""} onChange={(e) => e.target.value && actions.update(r.id, { day: e.target.value }, "날짜 고침")} />
        </div>
      )}

      {s.fields.some((f) => f.kind !== "photos") && (
        <div className="form-grid">{s.fields.map((f) => <FieldInput key={f.key} f={f} r={r} />)}</div>
      )}
      <Field label="태그" value={(r.tags ?? []).map((t) => `#${t}`).join(" ")} onSave={(v) => actions.update(r.id, { tags: parseTags(v) }, "태그 고침")} placeholder="#여행 #겨울" />
      {photos && <PhotoField r={r} label={photos.label} />}

      <span className="label">{s.noteLabel}</span>
      <ConflictNotice id={r.id} field="note" current={note} />
      <textarea className="essay-box" style={{ minHeight: 140 }} value={note} aria-label={s.noteLabel} onChange={(e) => change(e.target.value)} onBlur={flush} />

      <div className="row">
        {s.taskGroup && (
          <button className="btn" onClick={() => setMsg(actions.recordToToday(r.id, s.taskGroup!, today) ? "오늘 할 일에 넣었어요" : "이미 오늘 할 일에 있어요")}>오늘 할 일로 보내기</button>
        )}
        {s.toGoal && featureOn(rep, "goals") && (
          <button className="btn" onClick={() => setMsg(actions.toGoal(r.title) ? "큰 목표로 등록했어요 (같은 이름 할 일의 시간이 쌓여요)" : "이미 큰 목표에 있어요")}>큰 목표로 등록</button>
        )}
        {s.mapField && (
          <button className="btn" onClick={() => void platform.openUrl(`https://map.naver.com/p/search/${encodeURIComponent(String(r.f?.[s.mapField!] ?? "").trim() || r.title)}`)}>지도에서 찾기</button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => { actions.remove(r.id, `'${r.title}' 지움`); onClose(); }}><Trash /> 지우기</button>
      </div>
      {msg && <span className="input-ok">{msg}</span>}
    </div>
  );
}

/** phone: 목록만, 고르면 아래에서 올라오는 시트로 자세히 */
export function CollectionView({ s, phone }: { s: Schema; phone?: boolean }) {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const [filter, setFilter] = useState<ListFilter>({ status: "all" });
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    setFilter({ status: "all" });
    setSel(null);
  }, [s.key]);
  const list = items(rep, s, filter);
  const tags = tagsOf(rep, s);
  const choice = s.fields.find((f) => f.key === s.filterField);
  const r = sel ? rep.get<"record">(sel) : undefined;
  const add = () => {
    const { title, tags } = splitTags(text);
    if (!title) return;
    const fields: Record<string, unknown> = { title, tags, createdDay: today };
    if (s.mode === "done") fields.done = false;
    if (s.mode === "stages") fields.stage = 0;
    if (s.mode === "log") fields.day = today;
    if (choice && filter.choice) fields.f = { [choice.key]: filter.choice };
    const id = actions.addRecord(s.key, fields);
    if (!phone) setSel(id); // 휴대폰은 여러 개 이어서 적기 좋게 목록에 머묾
    setText("");
  };
  const statusTabs: [ListFilter["status"], string][] =
    s.mode === "done" ? [["all", "전체"], ["todo", s.tabs![0]], ["done", s.tabs![1]]]
      : s.mode === "stages" ? [["all", "전체"], ...s.stages!.map((st, i) => [i, st] as [number, string])] : [];
  return (
    <div className="records">
      <div className="rec-list">
        <div className="input">
          <input value={text} placeholder={s.addHint} aria-label={`${s.label} 추가`} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
          <button className="btn btn-accent" onClick={add}>추가</button>
        </div>
        {statusTabs.length > 0 && (
          <div className="seg wrap" role="group" aria-label="상태">
            {statusTabs.map(([k, l]) => <button key={String(k)} aria-pressed={filter.status === k} onClick={() => setFilter({ ...filter, status: k })}>{l}</button>)}
          </div>
        )}
        {choice && (
          <div className="w-chips">
            {[null, ...(choice.options ?? [])].map((o) => (
              <button key={o ?? "all"} className={`chip habit${filter.choice === o ? " on" : ""}`} onClick={() => setFilter({ ...filter, choice: o })}>{o ?? `모든 ${choice.label}`}</button>
            ))}
          </div>
        )}
        {tags.length > 0 && (
          <div className="w-chips">
            {tags.slice(0, 12).map((t) => (
              <button key={t} className={`chip habit${filter.tag === t ? " on" : ""}`} onClick={() => setFilter({ ...filter, tag: filter.tag === t ? null : t })}>#{t}</button>
            ))}
          </div>
        )}
        <input className="field" placeholder="검색" aria-label={`${s.label} 검색`} value={filter.q ?? ""} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="label">{list.length}개</span>
          <CollectionExport s={s} />
        </div>
        {list.map((x) => <Row key={x.id} s={s} r={x} on={x.id === sel} onClick={() => setSel(x.id)} />)}
        {!list.length && <div className="empty">{s.empty}</div>}
      </div>
      {phone ? r && (
        <Sheet title={r.title} onClose={() => setSel(null)} full>
          <Editor key={r.id} s={s} r={r} onClose={() => setSel(null)} />
        </Sheet>
      ) : r ? <Editor key={r.id} s={s} r={r} onClose={() => setSel(null)} /> : (
        <div className="rec-main"><div className="empty">왼쪽에서 하나를 고르면 자세히 적을 수 있어요.</div></div>
      )}
    </div>
  );
}

// ---------- 사용자 정의 모음 만들기 · 고치기 ----------

const KINDS: [FieldKind, string][] = [["text", "짧은 글"], ["choice", "선택지"], ["rating", "별점"], ["number", "숫자"], ["date", "날짜"], ["photos", "사진"]];

export function CollectionDesigner({ def, onClose, onSaved }: { def?: CollectionDef; onClose: () => void; onSaved: (id: string) => void }) {
  const { actions } = useApp();
  const [label, setLabel] = useState(def?.label ?? "");
  const [mode, setMode] = useState<CollectionDef["mode"]>(def?.mode ?? "done");
  const [stages, setStages] = useState((def?.stages ?? ["시작 전", "하는 중", "끝"]).join(", "));
  const [fields, setFields] = useState<F[]>(def?.fields ?? []);
  const [confirm, setConfirm] = useState(false);
  const save = () => {
    if (!label.trim()) return;
    const clean = fields.filter((f) => f.label.trim()).map((f) => ({ ...f, label: f.label.trim(), options: f.kind === "choice" ? (f.options ?? []).filter(Boolean) : undefined }));
    const data = { label: label.trim(), mode, stages: mode === "stages" ? stages.split(",").map((x) => x.trim()).filter(Boolean) : null, fields: clean };
    if (def) {
      actions.update(def.id, data, `모음 '${data.label}' 고침`);
      onSaved(def.id);
    } else onSaved(actions.create("collection", data, `모음 '${data.label}' 만듦`));
  };
  const nextKey = () => {
    const used = new Set(fields.map((f) => f.key));
    for (let i = 0; ; i++) if (!used.has(fieldKey(i))) return fieldKey(i);
  };
  return (
    <div className="overlay" role="dialog" aria-label="모음 만들기">
      <div className="sheet" style={{ width: "min(560px, 100%)" }}>
        <h2>{def ? "모음 고치기" : "새 모음 만들기"}</h2>
        <Field label="이름" value={label} onSave={setLabel} placeholder="예) 와인 노트, 운동 기록, 읽은 논문" />
        <span className="label">진행 방식</span>
        <div className="seg" role="group" aria-label="진행 방식">
          <button aria-pressed={mode === "done"} onClick={() => setMode("done")}>완료 체크</button>
          <button aria-pressed={mode === "stages"} onClick={() => setMode("stages")}>단계</button>
          <button aria-pressed={mode === "log"} onClick={() => setMode("log")}>날짜별 기록</button>
        </div>
        {mode === "stages" && <Field label="단계 (쉼표로)" value={stages} onSave={setStages} />}
        <span className="label">칸 (제목 · 태그 · 메모는 늘 있어요)</span>
        {fields.map((f, i) => (
          <div key={f.key} className="row" style={{ flexWrap: "nowrap" }}>
            <input className="field" style={{ flex: 1 }} value={f.label} placeholder="칸 이름" aria-label="칸 이름"
              onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <select className="field" style={{ width: 110 }} value={f.kind} aria-label="칸 종류"
              onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, kind: e.target.value as FieldKind } : x)))}>
              {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {f.kind === "choice" && (
              <input className="field" style={{ width: 160 }} value={(f.options ?? []).join(", ")} placeholder="선택지 (쉼표로)" aria-label="선택지"
                onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()) } : x)))} />
            )}
            <button className="icon-btn" aria-label="칸 빼기" onClick={() => setFields(fields.filter((_, j) => j !== i))}><Trash /></button>
          </div>
        ))}
        <div className="row"><button className="btn" onClick={() => setFields([...fields, { key: nextKey(), label: "", kind: "text" }])}>+ 칸 더하기</button></div>
        <div className="row" style={{ justifyContent: "space-between" }}>
          {def ? (
            confirm ? (
              <span className="row"><span className="muted" style={{ fontSize: 13 }}>모음과 그 안의 기록을 모두 지울까요? (되돌리기 가능)</span>
                <button className="btn" onClick={() => { actions.removeCollection(def.id); onClose(); }}>지우기</button></span>
            ) : <button className="btn btn-ghost" onClick={() => setConfirm(true)}><Trash /> 모음 지우기</button>
          ) : <span />}
          <span className="row">
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn btn-accent" disabled={!label.trim()} onClick={save}>{def ? "저장" : "만들기"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
