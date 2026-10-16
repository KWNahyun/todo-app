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

interface PanelProps {
  id: string;
  now: number;
  onClose: () => void;
}

/** 고른 항목의 종류에 맞는 상세 패널 */
export function Detail(p: PanelProps) {
  const { rep } = useApp();
  const type = rep.get(p.id)?.type;
  if (type === "event") return <EventDetail {...p} />;
  if (type === "deadline") return <DeadlineDetail {...p} />;
  if (type === "task") return <TaskDetail {...p} />;
  return null;
}

function PanelHead({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="panel-head">
      <span className="label">{label}</span>
      <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
    </div>
  );
}

function TitleInput({ id, value, label }: { id: string; value: string; label: string }) {
  const { actions } = useApp();
  const [title, setTitle] = useDraft(value);
  return (
    <input className="title-input" value={title} aria-label={label}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={() => title.trim() && title !== value && actions.update(id, { title: title.trim() }, "제목 고침")}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function EventDetail({ id, onClose }: PanelProps) {
  const { rep, actions, config } = useApp();
  const e = rep.get<"event">(id);
  const [remind, setRemind] = useDraft(e?.remindMin != null ? String(e.remindMin) : "");
  if (!e) return null;
  return (
    <aside className="panel" aria-label="일정 상세">
      <PanelHead label="일정" onClose={onClose} />
      <TitleInput id={id} value={e.title} label="일정 이름" />
      <label className="label" htmlFor="ev-day">날짜</label>
      <input id="ev-day" type="date" className="field" value={e.day} onChange={(x) => x.target.value && actions.moveToDay(id, x.target.value)} />
      <label className="label" htmlFor="ev-time">시각</label>
      <div className="row">
        <input id="ev-time" type="time" className="field" style={{ width: 140 }} value={e.time ?? ""} disabled={e.time == null}
          onChange={(x) => x.target.value && actions.update(id, { time: x.target.value }, "시각 고침")} />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={e.time == null}
            onChange={(x) => actions.update(id, { time: x.target.checked ? null : "09:00" }, x.target.checked ? "시간 미정으로" : "시각 정함")} />
          시간 미정
        </label>
      </div>
      {e.time != null && (
        <>
          <label className="label" htmlFor="ev-remind">알림 (분 전)</label>
          <input id="ev-remind" className="field" inputMode="numeric" style={{ width: 140 }} value={remind}
            placeholder={`기본 ${config.remindMin ?? 10}분`}
            onChange={(x) => setRemind(x.target.value.replace(/\D/g, ""))}
            onBlur={() => {
              const v = remind ? Number(remind) : null;
              if (v !== (e.remindMin ?? null)) actions.update(id, { remindMin: v }, "알림 고침");
            }} />
          <div className="faint" style={{ fontSize: 12 }}>0 이면 알리지 않아요.</div>
        </>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => { actions.remove(id, `일정 '${e.title}' 지움`); onClose(); }}><Trash /> 지우기</button>
      </div>
    </aside>
  );
}

function DeadlineDetail({ id, now, onClose }: PanelProps) {
  const { rep, actions } = useApp();
  const d = rep.get<"deadline">(id);
  const [group, setGroup] = useDraft(d?.groupTitle ?? "");
  if (!d) return null;
  const today = new Date(now);
  const groups = [...new Set(rep.list("task", (t) => !t.parentId && rep.list("task", (c) => c.parentId === t.id).length > 0).map((t) => t.title))];
  const n = Math.round((toDate(d.date).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  return (
    <aside className="panel" aria-label="마감 상세">
      <PanelHead label={`마감 · ${n === 0 ? "D-DAY" : n > 0 ? `D-${n}` : `D+${-n}`}`} onClose={onClose} />
      <TitleInput id={id} value={d.title} label="마감 이름" />
      <label className="label" htmlFor="dl-date">날짜</label>
      <input id="dl-date" type="date" className="field" value={d.date} onChange={(x) => x.target.value && actions.moveToDay(id, x.target.value)} />
      <label className="label" htmlFor="dl-group">연결한 묶음</label>
      <input id="dl-group" className="field" list="dl-groups" value={group} placeholder="예) KAMP 경진대회"
        onChange={(x) => setGroup(x.target.value)}
        onBlur={() => group !== (d.groupTitle ?? "") && actions.update(id, { groupTitle: group.trim() || null }, "연결 고침")} />
      <datalist id="dl-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <div className="faint" style={{ fontSize: 12 }}>같은 이름의 묶음에 이 마감의 디데이가 붙어요.</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" onClick={() => { actions.remove(id, `마감 '${d.title}' 지움`); onClose(); }}><Trash /> 지우기</button>
      </div>
    </aside>
  );
}

function TaskDetail({ id, now, onClose }: PanelProps) {
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
