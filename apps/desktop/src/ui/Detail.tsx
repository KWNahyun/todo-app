/** 오른쪽 상세 패널: 고른 할 일을 목록을 보면서 바로 고침 (설계 4장 — 대화상자 대신) */
import { useEffect, useState } from "react";
import { sessionsOf, taskElapsedMs, type Session } from "@dailytodo/core";
import { clock, hhmm, toDate } from "../app/dates.ts";
import { useApp } from "../app/store.tsx";
import { Close, Trash } from "./icons.tsx";

/** 입력칸: 고치는 동안은 내 글, 빠져나갈 때 저장 */
function useDraft(value: string): [string, (v: string) => void] {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return [v, setV];
}

function SessionRow({ s, now }: { s: Session; now: number }) {
  const { actions } = useApp();
  // "HH:MM" 를 그 세션 시작 날짜의 시각으로
  const toMs = (base: number, hm: string) => {
    const [h, m] = hm.split(":").map(Number) as [number, number];
    const d = new Date(base);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  return (
    <div className="session num">
      <input type="time" aria-label="시작" defaultValue={hhmm(s.start)} key={`s${s.start}`}
        onBlur={(e) => e.target.value && e.target.value !== hhmm(s.start) && actions.updateSession(s.id, { start: toMs(s.start, e.target.value) })} />
      –
      {s.end == null ? <span style={{ color: "var(--active-text)" }}>재는 중</span> : (
        <input type="time" aria-label="끝" defaultValue={hhmm(s.end)} key={`e${s.end}`}
          onBlur={(e) => e.target.value && e.target.value !== hhmm(s.end!) && actions.updateSession(s.id, { end: toMs(s.start, e.target.value) })} />
      )}
      <span className="dur">{s.kind === "imported" ? "v1 기록 " : ""}{clock((s.end ?? now) - s.start)}</span>
      <button className="icon-btn" aria-label="이 측정 기록 지우기" onClick={() => actions.remove(s.id, "측정 기록 지움")}><Trash /></button>
    </div>
  );
}

export function Detail({ id, now, onClose }: { id: string; now: number; onClose: () => void }) {
  const { rep, actions } = useApp();
  const t = rep.get<"task">(id);
  const [title, setTitle] = useDraft(t?.title ?? "");
  const [note, setNote] = useDraft(t?.note ?? "");
  const [est, setEst] = useDraft(t?.estimateMin ? String(t.estimateMin) : "");
  if (!t) return null;
  const parent = t.parentId ? rep.get<"task">(t.parentId) : undefined;
  const kids = rep.list("task", (c) => c.parentId === id);
  const sessions = sessionsOf(rep, id);
  const total = taskElapsedMs(rep, id, now, { children: kids.length > 0 });
  const created = toDate(t.day);

  return (
    <aside className="panel" aria-label="할 일 상세">
      <div className="panel-head">
        <span className="label">할 일 상세 · {created.getMonth() + 1}월 {created.getDate()}일</span>
        <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
      </div>
      <input className="title-input" value={title} aria-label="제목"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== t.title && actions.update(id, { title: title.trim() }, "제목 고침")}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <div className="muted" style={{ fontSize: 12.5 }}>
        {parent ? <>{parent.title} › 하위 할 일</> : kids.length ? <>묶음 · 하위 {kids.length}개</> : "할 일"}
        {" · "}잰 시간 <span className="num">{clock(total)}</span>
      </div>

      <label className="label" htmlFor="note">메모</label>
      <textarea id="note" className="field" rows={3} value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (t.note ?? "") && actions.update(id, { note }, "메모 고침")} />

      <label className="label" htmlFor="est">예상 시간 (분)</label>
      <input id="est" className="field" inputMode="numeric" value={est} placeholder="예) 90"
        onChange={(e) => setEst(e.target.value.replace(/\D/g, ""))}
        onBlur={() => {
          const v = est ? Number(est) : null;
          if (v !== (t.estimateMin ?? null)) actions.update(id, { estimateMin: v }, "예상 시간 고침");
        }} />

      <span className="label">측정 기록 (구간)</span>
      {sessions.length ? (
        <div className="sessions">{sessions.map((s) => <SessionRow key={s.id} s={s} now={now} />)}</div>
      ) : (
        <div className="empty">타이머를 켜면 언제부터 언제까지 쟀는지 여기에 쌓여요.</div>
      )}
      <div className="faint" style={{ fontSize: 12 }}>시각을 눌러 고칠 수 있어요 (자리를 비운 시간 빼기 등).</div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => { actions.removeTask(id); onClose(); }}><Trash /> 지우기</button>
      </div>
    </aside>
  );
}
