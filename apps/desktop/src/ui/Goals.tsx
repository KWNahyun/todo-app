/** 목표: 큰 목표(쌓인 시간 · 목표 시간) · 습관 관리 · 만다라트 (v1 GoalDialog · HabitDialog · mandala.py) */
import { useEffect, useState } from "react";
import { keyBetween, mandalaGrid, sortByOrder, type Goal } from "@dailytodo/core";
import { addDays, toDate } from "../app/dates.ts";
import { goalMs, hoursText, periodDays } from "../app/stats.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { Trash } from "./icons.tsx";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function AddLine({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const add = () => {
    if (!v.trim()) return;
    onAdd(v.trim());
    setV("");
  };
  return (
    <div className="input">
      <input value={v} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && add()} />
      <button className="btn btn-accent" onClick={add}>추가</button>
    </div>
  );
}

function Inline({ value, onSave, label, className = "inline", inputMode, placeholder }: { value: string; onSave: (v: string) => void; label: string; className?: string; inputMode?: "numeric"; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input className={className} value={v} aria-label={label} inputMode={inputMode} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
  );
}

function GoalRow({ g, week }: { g: Goal; week: Set<string> }) {
  const { rep, actions } = useApp();
  const now = Date.now();
  const total = goalMs(rep, g, null, now);
  const recent = goalMs(rep, g, week, now);
  const target = g.targetHours ? g.targetHours * 3_600_000 : null;
  return (
    <div className="goal">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <Inline value={g.title} label="목표 이름" className="inline strong" onSave={(v) => v.trim() && actions.update(g.id, { title: v.trim() }, "목표 이름 고침")} />
        <button className="icon-btn" aria-label="목표 지우기" onClick={() => actions.remove(g.id, `목표 '${g.title}' 지움`)}><Trash /></button>
      </div>
      <div className="muted num" style={{ fontSize: 13 }}>
        누적 {hoursText(total)}{target ? ` / ${hoursText(target)}` : ""} · 최근 7일 +{hoursText(recent)}
      </div>
      {target && <div className="meter"><i style={{ width: `${Math.min(100, (total / target) * 100)}%` }} /></div>}
      <div className="form-grid">
        <label className="stack"><span className="label">목표 시간</span>
          <Inline value={g.targetHours ? String(g.targetHours) : ""} label="목표 시간" inputMode="numeric" className="field" placeholder="예) 100 (시간, 비우면 없음)"
            onSave={(v) => actions.update(g.id, { targetHours: v.trim() ? Number(v.replace(/[^\d.]/g, "")) || null : null }, "목표 시간 고침")} />
        </label>
        <label className="stack"><span className="label">함께 셀 할 일 · 묶음 이름</span>
          <Inline value={(g.linkedTitles ?? []).join(", ")} label="연결한 이름" className="field" placeholder="예) 영어 단어, 토익 RC"
            onSave={(v) => actions.update(g.id, { linkedTitles: v.split(",").map((x) => x.trim()).filter(Boolean) }, "연결 고침")} />
        </label>
      </div>
    </div>
  );
}

function Habits({ today }: { today: string }) {
  const { rep, actions } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const habits = sortByOrder(rep.list("habit"));
  const checked = new Set(rep.list("habitCheck", (c) => days.includes(c.day)).map((c) => `${c.habitId}|${c.day}`));
  return (
    <section className="card">
      <span className="label">습관 · 최근 7일 (칸을 눌러 체크)</span>
      {habits.length > 0 && (
        <div className="habit-row head"><span className="name" />
          <span className="cells">{days.map((d) => <i key={d} className="wd">{WEEK[toDate(d).getDay()]}</i>)}</span><span />
        </div>
      )}
      {habits.map((h) => (
        <div key={h.id} className="habit-row">
          <Inline value={h.name} label="습관 이름" className="inline name" onSave={(v) => v.trim() && actions.update(h.id, { name: v.trim() }, "습관 이름 고침")} />
          <span className="cells">
            {days.map((d) => {
              const on = checked.has(`${h.id}|${d}`);
              return <button key={d} className={on ? "on" : ""} aria-pressed={on} aria-label={`${h.name} ${d}`} onClick={() => actions.toggleHabit(h.id, d)} />;
            })}
          </span>
          <button className="icon-btn" aria-label="습관 지우기" onClick={() => actions.removeHabit(h.id)}><Trash /></button>
        </div>
      ))}
      {!habits.length && <div className="empty">매일 하고 싶은 것을 더해 보세요. 예) 운동, 독서 20쪽, 물 2L</div>}
      <AddLine placeholder="새 습관" onAdd={(name) => {
        const last = habits[habits.length - 1]?.order;
        actions.create("habit", { name, order: keyBetween(typeof last === "string" ? last : null, null) }, `습관 '${name}' 추가`);
      }} />
    </section>
  );
}

/** 3×3 블록 번호(가운데 4 제외) → 0~7 (v1 sub_index) */
const sub = (k: number) => (k < 4 ? k : k - 1);

function Mandala({ today }: { today: string }) {
  const { rep, actions } = useApp();
  const m = rep.get<"mandala">(actions.mandalaId());
  const g = mandalaGrid(m ?? { id: "", type: "mandala", createdAt: "", updatedAt: "" });
  const [sel, setSel] = useState<{ s: number; a: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const filled = g.actions.flat().filter(Boolean).length;
  const done = g.actions.flat().filter((x, i) => x && g.done.flat()[i]).length;

  const cell = (block: number, pos: number) => {
    if (block === 4 && pos === 4) {
      return <Inline key="c" value={g.center} label="핵심 목표" className="mcell core" placeholder="핵심 목표" onSave={(v) => actions.setMandalaCell("center", v)} />;
    }
    if (block === 4 || pos === 4) {
      const s = block === 4 ? sub(pos) : sub(block);
      return <Inline key={`s${block}${pos}`} value={g.subs[s]!} label={`세부 목표 ${s + 1}`} className={`mcell subgoal${block === 4 ? "" : " mirror"}`}
        placeholder={block === 4 ? `세부 ${s + 1}` : ""} onSave={(v) => actions.setMandalaCell(`subs.${s}`, v)} />;
    }
    const s = sub(block);
    const a = sub(pos);
    const isDone = g.done[s]![a]!;
    return (
      <span key={`a${block}${pos}`} className={`mcell-wrap${isDone ? " done" : ""}${sel?.s === s && sel.a === a ? " sel" : ""}`} onFocus={() => setSel({ s, a })}>
        <Inline value={g.actions[s]![a]!} label={`${g.subs[s] || `세부 ${s + 1}`} 실천 ${a + 1}`} className="mcell" onSave={(v) => actions.setMandalaCell(`actions.${s}.${a}`, v)} />
      </span>
    );
  };

  const selText = sel ? g.actions[sel.s]![sel.a]! : "";
  return (
    <section className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">만다라트 · 실천 {done}/{filled} 완료</span>
        {sel && selText && (
          <div className="row">
            <span className="muted" style={{ fontSize: 13 }}>{selText}</span>
            <button className="btn" onClick={() => actions.setMandalaCell(`done.${sel.s}.${sel.a}`, !g.done[sel.s]![sel.a], "실천 칸 완료 표시")}>
              {g.done[sel.s]![sel.a] ? "완료 취소" : "완료 표시"}
            </button>
            <button className="btn btn-accent" onClick={() => setMsg(actions.mandalaToTask(sel.s, sel.a, g.subs[sel.s]!, selText, today) ? "오늘 할 일에 넣었어요" : "이미 오늘 할 일에 있어요")}>오늘 할 일로</button>
          </div>
        )}
      </div>
      {msg && <span className="input-ok">{msg}</span>}
      <div className="mandala">
        {Array.from({ length: 9 }, (_, b) => (
          <div key={b} className={`mblock${b === 4 ? " center" : ""}`}>{Array.from({ length: 9 }, (_, p) => cell(b, p))}</div>
        ))}
      </div>
      <span className="faint" style={{ fontSize: 12 }}>가운데에 핵심 목표, 둘레에 세부 목표 8개, 바깥 칸에 실천 64개. 실천 칸을 고르면 완료 표시 · 오늘 할 일로 보내기.</span>
    </section>
  );
}

export function Goals() {
  const { rep, actions } = useApp();
  useData();
  const today = useToday();
  const week = new Set(periodDays("week", today));
  const goals = rep.list("goal").sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return (
    <>
      <div className="center-head"><h1>목표</h1></div>
      <div className="stats-cols">
        <section className="card">
          <span className="label">큰 목표 · 마감 없이 시간을 쌓는 목표 (이름이 같은 할 일 · 묶음의 시간이 쌓여요)</span>
          {goals.map((g) => <GoalRow key={g.id} g={g} week={week} />)}
          {!goals.length && <div className="empty">예) 영어 100시간 — 목표를 만들고 같은 이름의 할 일에 타이머를 쓰면 쌓여요.</div>}
          <AddLine placeholder="새 목표 이름" onAdd={(title) => actions.create("goal", { title, linkedTitles: [], createdDay: today }, `목표 '${title}' 추가`)} />
        </section>
        <Habits today={today} />
      </div>
      <Mandala today={today} />
    </>
  );
}
