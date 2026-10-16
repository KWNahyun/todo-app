/**
 * 위젯이 뒤에서 지키는 것 (v1 _guard_timers · 뽀모도로 · 정리 알림) + 그 화면들.
 * 위젯 창에서만 돌림 (메인 창까지 돌리면 두 번 묻고 두 번 울림).
 */
import { useEffect, useRef, useState } from "react";
import { runningSessions, type Session } from "@dailytodo/core";
import { addDays, clock, dayOf, hhmm, hoursMinutes, longDay, shortDay } from "../app/dates.ts";
import { POMO_DEFAULTS, pomoTick, reviewData, sleepGap, type Pomo } from "../app/guard.ts";
import { journalOf } from "../app/records.ts";
import { useApp, useData } from "../app/store.tsx";
import { MoodPicker } from "./Records.tsx";

export interface Away {
  since: number;
  reason: string;
  sessionIds: string[];
}

const LS = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`dt-guard:${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`dt-guard:${k}`, v);
    } catch {
      // 저장 못 해도 다음에 한 번 더 물을 뿐
    }
  },
};

export function useGuard() {
  const { rep, actions, platform, config } = useApp();
  const [away, setAway] = useState<Away | null>(null);
  const [pomo, setPomo] = useState<Pomo | null>(null);
  const awayRef = useRef<Away | null>(null);
  awayRef.current = away;
  const pomoRef = useRef<Pomo | null>(null);
  pomoRef.current = pomo;

  useEffect(() => {
    const pc = actions.pcId;
    const mine = () => runningSessions(rep).filter((s) => s.deviceId === pc);
    const ask = (since: number, reason: string) => {
      const run = mine().filter((s) => s.start < since); // 비우기 전부터 켜져 있던 타이머만
      if (awayRef.current || !run.length || Date.now() - since < 60_000) return false;
      setAway({ since, reason, sessionIds: run.map((s) => s.id) });
      void platform.showWidget();
      void platform.notify("타이머가 켜져 있었어요", `${hhmm(since)}부터 ${hoursMinutes(Date.now() - since)} — ${reason}`);
      return true;
    };

    // 앱이 꺼져 있던 동안 (강제 종료 · 재부팅): 마지막 심장 박동 이후
    const hb = Number(LS.get("heartbeat") || 0);
    if (hb && Date.now() - hb > 120_000) ask(hb, "앱이 꺼져 있던 동안");

    let lastTick = Date.now();
    let idleSince: number | null = null;
    let n = 0;
    const longDone = new Set<string>();
    const h = setInterval(async () => {
      const now = Date.now();
      const gap = sleepGap(lastTick, now);
      lastTick = now;
      n++;
      if (n % 30 === 0) LS.set("heartbeat", String(now));
      if (gap != null && ask(gap, "절전 모드였던 동안")) return;
      if (awayRef.current) return;

      // 자리 비움: 입력이 idleMin 분 없다가 돌아오면 물어봄
      const idleMin = config.idleMin ?? 10;
      if (idleMin > 0 && n % 5 === 0 && mine().length) {
        const idle = await platform.idleSeconds();
        if (idleSince == null && idle >= idleMin * 60) idleSince = now - idle * 1000;
        else if (idleSince != null && idle < 5) {
          const since = idleSince;
          idleSince = null;
          if (ask(since, "입력이 없던 동안")) return;
        }
      }

      if (n % 60 === 1) actions.splitAtMidnight();

      // 너무 오래 켜진 타이머
      const longH = config.longHours ?? 2;
      if (longH > 0) {
        for (const s of mine()) {
          if (now - s.start >= longH * 3_600_000 && !longDone.has(s.id)) {
            longDone.add(s.id);
            const t = rep.get<"task">(s.taskId);
            void platform.notify(`'${t?.title ?? ""}' 타이머가 ${hoursMinutes(now - s.start)}째 켜져 있어요`, "계속하는 중이 아니라면 정지해 주세요");
          }
        }
      }

      // 오늘 정리하기 알림 (하루 한 번)
      const rt = config.reviewTime ?? "22:00";
      const today = dayOf(new Date(now));
      if (rt && hhmm(now) >= rt && LS.get("nudged") !== today && LS.get("reviewed") !== today) {
        LS.set("nudged", today);
        void platform.notify("오늘 하루를 정리해 볼까요?", "한 일 · 내일로 넘길 일 · 습관 · 기분 · 한 줄 회고");
      }

      // 뽀모도로
      if (config.pomo?.on) {
        const cfg = { ...POMO_DEFAULTS, ...config.pomo };
        const r = pomoTick(pomoRef.current, mine(), now, cfg);
        if (r.event?.type === "focusDone") {
          actions.finishPomodoro(r.event.sessionId, r.event.end);
          const t = rep.get<"task">(r.event.taskId);
          void platform.notify(`집중 ${cfg.focus}분 끝!`, `'${t?.title ?? ""}' 뽀모도로 ${r.event.count}회째 · ${r.event.breakMin}분 쉬어요`);
        } else if (r.event?.type === "breakDone") {
          void platform.notify("휴식 끝!", "다시 집중해 볼까요?");
        }
        if (r.next !== pomoRef.current) setPomo(r.next);
      } else if (pomoRef.current) setPomo(null);
    }, 1000);
    return () => clearInterval(h);
  }, [rep, actions, platform, config]);

  return {
    away,
    resolveAway(choice: "cut" | "cut_stop" | "keep") {
      if (away && choice !== "keep") actions.cutAway(away.sessionIds, away.since, choice === "cut");
      setAway(null);
      setPomo(null);
      actions.splitAtMidnight();
    },
    pomo,
    setPomo,
    markReviewed(day: string) {
      LS.set("reviewed", day);
    },
  };
}

export function AwayOverlay({ away, onPick }: { away: Away; onPick: (c: "cut" | "cut_stop" | "keep") => void }) {
  const { rep } = useApp();
  const now = Date.now();
  const since = new Date(away.since);
  const when = dayOf(since) === dayOf(new Date(now)) ? hhmm(away.since) : `${shortDay(dayOf(since))} ${hhmm(away.since)}`;
  const sessions = away.sessionIds.map((id) => rep.get<"session">(id)).filter((s): s is Session => !!s);
  return (
    <div className="overlay" role="alertdialog" aria-label="타이머 확인">
      <div className="sheet">
        <h2>타이머가 켜져 있었어요</h2>
        <p className="muted">{when}부터 {hoursMinutes(now - away.since)} — {away.reason}</p>
        <div className="stack">
          {sessions.map((s) => (
            <div key={s.id} className="task running"><span className="t-title">{rep.get<"task">(s.taskId)?.title}</span><span className="time num">{clock(now - s.start)}</span></div>
          ))}
        </div>
        <p className="faint" style={{ fontSize: 12 }}>빼면 {when}에 멈춘 것으로 기록돼요.</p>
        <div className="row">
          <button className="btn btn-accent" autoFocus onClick={() => onPick("cut")}>그 시간 빼고 계속</button>
          <button className="btn" onClick={() => onPick("cut_stop")}>빼고 멈추기</button>
          <button className="btn" onClick={() => onPick("keep")}>모두 포함</button>
        </div>
      </div>
    </div>
  );
}

export function PomoBar({ pomo, setPomo }: { pomo: Pomo; setPomo: (p: Pomo | null) => void }) {
  const { rep, actions, config } = useApp();
  const cfg = { ...POMO_DEFAULTS, ...config.pomo };
  const t = rep.get<"task">(pomo.taskId);
  const left = "ends" in pomo ? Math.max(0, Math.ceil((pomo.ends - Date.now()) / 1000)) : 0;
  const focus = pomo.phase === "focus";
  const cycle = pomo.count % cfg.every;
  return (
    <div className={`pomo${focus ? " focus" : ""}`}>
      <b>{{ focus: "집중", break: "휴식", ready: "휴식 끝" }[pomo.phase]}</b>
      <span className="dots" aria-label={`${pomo.count}회`}>{"●".repeat(cycle)}{"○".repeat(cfg.every - cycle)}</span>
      <span className="t-title">{t?.title}</span>
      {pomo.phase !== "ready" && <span className="num clock">{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</span>}
      {focus && <button className="btn" onClick={() => { actions.toggleTimer(pomo.taskId); setPomo(null); }}>그만</button>}
      {pomo.phase === "break" && <button className="btn" onClick={() => setPomo({ phase: "ready", taskId: pomo.taskId, count: pomo.count })}>건너뛰기</button>}
      {pomo.phase === "ready" && (
        <>
          <button className="btn btn-accent" disabled={!t || t.done} onClick={() => actions.toggleTimer(pomo.taskId)}>▶ 집중 시작</button>
          <button className="btn" onClick={() => setPomo(null)}>끝내기</button>
        </>
      )}
    </div>
  );
}

/** 습관 칩: 누르면 오늘 체크 (연속 일수 표시) — v1 HabitBar */
export function HabitChips({ day }: { day: string }) {
  const { rep, actions } = useApp();
  useData();
  const habits = rep.list("habit").sort((a, b) => ((a.order ?? "") < (b.order ?? "") ? -1 : 1));
  if (!habits.length) return null;
  const checks = new Set(rep.list("habitCheck").map((c) => `${c.habitId}|${c.day}`));
  const streak = (id: string) => {
    let n = 0;
    for (let d = day; checks.has(`${id}|${d}`); d = addDays(d, -1)) n++;
    return n;
  };
  return (
    <div className="w-chips">
      {habits.map((h) => {
        const on = checks.has(`${h.id}|${day}`);
        const s = streak(h.id);
        return (
          <button key={h.id} className={`chip habit${on ? " on" : ""}`} aria-pressed={on} onClick={() => actions.toggleHabit(h.id, day)}>
            {on ? "✓ " : ""}{h.name}{s >= 2 ? ` · ${s}일` : ""}
          </button>
        );
      })}
    </div>
  );
}

/** 오늘 정리하기 (v1 ReviewDialog): 한 일 → 내일로 넘길 일 → 습관 · 기분 → 한 줄 회고 */
export function ReviewSheet({ day, onClose, onDone }: { day: string; onClose: () => void; onDone: (msg: string) => void }) {
  const { rep, actions } = useApp();
  const now = Date.now();
  const [d] = useState(() => reviewData(rep, day, now));
  const [carry, setCarry] = useState(() => new Set(d.undone.slice(0, 8).map((u) => u.id)));
  const [text, setText] = useState(journalOf(rep, day)?.text ?? "");
  const finish = () => {
    if (text !== (journalOf(rep, day)?.text ?? "")) actions.saveJournal(journalOf(rep, day)?.id, day, text);
    const moved = actions.carryTo([...carry], addDays(day, 1));
    onDone(moved ? `오늘 정리 완료 · 내일로 ${moved}개 넘겼어요. 수고했어요!` : "오늘 정리 완료 · 수고했어요!");
  };
  return (
    <div className="overlay" role="dialog" aria-label="오늘 정리하기">
      <div className="sheet">
        <h2>{longDay(day)} 정리</h2>
        <p className="muted">완료 {d.done}/{d.total} · {hoursMinutes(d.ms)} 기록{d.pomos ? ` · 뽀모도로 ${d.pomos}회` : ""}</p>
        <span className="label">한 일</span>
        {d.worked.length ? d.worked.slice(0, 6).map((w) => (
          <div key={w.label} className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span>{w.label}</span><span className="muted">{w.detail}</span></div>
        )) : <div className="empty">기록된 일이 없어요</div>}
        {d.undone.length > 0 && (
          <>
            <span className="label">내일로 넘길 일</span>
            {d.undone.slice(0, 8).map((u) => (
              <label key={u.id} className="row" style={{ gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={carry.has(u.id)} onChange={(e) => {
                  const next = new Set(carry);
                  if (e.target.checked) next.add(u.id);
                  else next.delete(u.id);
                  setCarry(next);
                }} />
                {u.label}
              </label>
            ))}
            {d.undone.length > 8 && <span className="faint" style={{ fontSize: 12 }}>외 {d.undone.length - 8}개는 그대로 둬요</span>}
          </>
        )}
        <span className="label">습관</span>
        <HabitChips day={day} />
        <span className="label">기분</span>
        <MoodPicker day={day} />
        <label className="label" htmlFor="review-text">한 줄 회고</label>
        <textarea id="review-text" className="field" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>나중에</button>
          <button className="btn btn-accent" onClick={finish}>정리 완료</button>
        </div>
      </div>
    </div>
  );
}
