/**
 * 통계 (설계 4.4): v1 주간 통계 + 기간(주 · 달 · 연) + 시간/완료 기준. 그래프는 SVG (테마 색을 따라감).
 * 차트 규칙: 한 계열(단색, 범례 없음 — 제목이 이름), 막대 ≤24px · 끝 4px 둥글게 · 바닥은 각지게,
 * 숫자는 가장 큰 막대에만, 나머지는 마우스를 올리면 · '표로 보기'.
 */
import { useState } from "react";
import { clock } from "../app/dates.ts";
import { computeStats, hoursText, hm, periodLabel, shiftEnd, type Basis, type Period, type Stats as S } from "../app/stats.ts";
import { useApp, useData, useToday } from "../app/store.tsx";
import { Left, Right } from "./icons.tsx";
import { Face } from "./Records.tsx";

const fmt = (basis: Basis, v: number) => (basis === "time" ? (v >= 3_600_000 ? hoursText(v) : `${Math.round(v / 60_000)}분`) : `${v}개`);

/** 깔끔한 눈금 (0 · 1 · 2 시간 / 0 · 5 · 10 개) */
function ticks(max: number, basis: Basis): number[] {
  const unit = basis === "time" ? 3_600_000 : 1;
  const top = Math.max(max / unit, 1);
  const raw = top / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((k) => k * pow).find((k) => k >= raw)!;
  const out: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) out.push(v * unit);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step * unit);
  return out;
}

function BarChart({ s, basis, today, period }: { s: S; basis: Basis; today: string; period: Period }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = s.buckets.length;
  const W = 640;
  const padL = 44;
  const plotW = W - padL - 8;
  const top = 18;
  const H = 180;
  const showMood = period === "week";
  const max = Math.max(...s.buckets.map((b) => b.value), 0);
  const tk = ticks(max, basis);
  const yMax = tk[tk.length - 1]!;
  const slot = plotW / n;
  const bw = Math.min(24, slot * 0.56);
  const y = (v: number) => top + H - (H * v) / yMax;
  const peak = max > 0 ? s.buckets.findIndex((b) => b.value === max) : -1;
  const labelEvery = n > 14 ? Math.ceil(n / 10) : 1;
  const totalH = top + H + (showMood ? 72 : 34);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${totalH}`} role="img" aria-label={`${basis === "time" ? "날짜별 시간" : "날짜별 완료한 일"} 막대그래프`}
        onMouseLeave={() => setHover(null)}>
        {tk.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="tick">{basis === "time" ? `${v / 3_600_000}시간` : v}</text>
          </g>
        ))}
        {s.buckets.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = b.value > 0 ? Math.max(2, (H * b.value) / yMax) : 0;
          const r = Math.min(4, h, bw / 2);
          const x0 = cx - bw / 2;
          const yTop = top + H - h;
          const isToday = b.key === today || (period === "year" && today.startsWith(b.key));
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)}>
              <rect x={cx - slot / 2} y={top} width={slot} height={H + 34} fill="transparent" />
              {h > 0 && (
                <path className={`bar${isToday ? " now" : ""}${hover === i ? " hot" : ""}`}
                  d={`M${x0},${top + H} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + bw - r} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + r} V${top + H} Z`} />
              )}
              {i === peak && <text x={cx} y={yTop - 6} textAnchor="middle" className="val">{fmt(basis, b.value)}</text>}
              {(i % labelEvery === 0 || isToday) && (
                <text x={cx} y={top + H + 16} textAnchor="middle" className={`xl${isToday ? " now" : ""}`}>{b.label}</text>
              )}
              {b.sub && <text x={cx} y={top + H + 30} textAnchor="middle" className="xs">{b.sub}</text>}
              {showMood && b.mood && (
                <foreignObject x={cx - 11} y={top + H + 40} width={22} height={22}><Face level={b.mood} on /></foreignObject>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={W - 8} y1={top + H} y2={top + H} className="axis" />
      </svg>
      {hover != null && (
        <div className="tip" style={{ left: `${((padL + slot * hover + slot / 2) / W) * 100}%` }}>
          <b>{period === "year" ? s.buckets[hover]!.key.replace("-", ".") : s.buckets[hover]!.key.slice(5).replace("-", "/")}</b> {fmt(basis, s.buckets[hover]!.value)}
        </div>
      )}
    </div>
  );
}

export function Stats() {
  const { rep } = useApp();
  useData();
  const today = useToday();
  const [period, setPeriod] = useState<Period>("week");
  const [basis, setBasis] = useState<Basis>("time");
  const [end, setEnd] = useState(today);
  const [table, setTable] = useState(false);
  const s = computeStats(rep, period, end, basis, Date.now());
  const atEnd = s.days[s.days.length - 1]! >= today;

  return (
    <>
      <div className="center-head">
        <button className="icon-btn" aria-label="이전" onClick={() => setEnd(shiftEnd(period, end, -1))}><Left /></button>
        <h1>{periodLabel(period, end)}</h1>
        <button className="icon-btn" aria-label="다음" disabled={atEnd} onClick={() => setEnd(shiftEnd(period, end, 1))}><Right /></button>
        {!atEnd && <button className="btn" onClick={() => setEnd(today)}>지금으로</button>}
        <div className="row" style={{ marginLeft: "auto" }}>
          <div className="seg" role="group" aria-label="기간">
            {([["week", "주"], ["month", "달"], ["year", "연"]] as const).map(([k, l]) => (
              <button key={k} aria-pressed={period === k} onClick={() => { setPeriod(k); setEnd(today); }}>{l}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="기준">
            <button aria-pressed={basis === "time"} onClick={() => setBasis("time")}>시간</button>
            <button aria-pressed={basis === "done"} onClick={() => setBasis("done")}>완료한 일</button>
          </div>
        </div>
      </div>

      <div className="tiles">
        {s.tiles.map((t) => (
          <div key={t.label} className="tile"><span className="label">{t.label}</span><b className="num">{t.value}</b></div>
        ))}
      </div>

      <div className="stats-cols">
        <div className="stack" style={{ gap: 14 }}>
          <section className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="label">{basis === "time" ? "날짜별 시간" : "날짜별 완료한 일"}{period === "week" ? " · 기분" : ""}{period === "year" ? " (달별)" : ""}</span>
              <button className="btn btn-ghost" onClick={() => setTable(!table)}>{table ? "그래프로" : "표로 보기"}</button>
            </div>
            {table ? (
              <table className="cmp">
                <tbody>
                  {s.buckets.map((b) => <tr key={b.key}><td className="num">{b.key}</td><td className="n">{basis === "time" ? clock(b.value) : b.value}</td></tr>)}
                </tbody>
              </table>
            ) : (
              <BarChart s={s} basis={basis} today={today} period={period} />
            )}
          </section>

          <section className="card">
            <span className="label">{basis === "time" ? "가장 오래 한 일" : "가장 많이 끝낸 일"}</span>
            {!s.top.length && <div className="empty">{basis === "time" ? "아직 기록된 시간이 없어요" : "이 기간에 끝낸 일이 없어요"}</div>}
            {s.top.map((t) => (
              <div key={t.name} className="rank">
                <div className="row" style={{ justifyContent: "space-between" }}><span>{t.name}</span><span className="muted num">{basis === "time" ? hm(t.value) : `${t.value}개`}</span></div>
                <div className="meter"><i style={{ width: `${(t.value / s.top[0]!.value) * 100}%` }} /></div>
              </div>
            ))}
          </section>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          {s.habits.length > 0 && (
            <section className="card">
              <span className="label">습관</span>
              {s.habits.map((h) => (
                <div key={h.id} className="habit-row">
                  <span className="name">{h.name}</span>
                  <span className={`cells${period !== "week" ? " dense" : ""}`} aria-label={`${s.days.length}일 중 ${h.count}일`}>
                    {h.cells.map((on, i) => <i key={i} className={on ? "on" : ""} title={s.days[i]} />)}
                  </span>
                  <span className="muted num">{h.count}/{s.days.length}</span>
                </div>
              ))}
            </section>
          )}
          {s.goals.length > 0 && (
            <section className="card">
              <span className="label">큰 목표</span>
              {s.goals.map((g) => (
                <div key={g.id} className="rank">
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>{g.title}</span>
                    <span className="muted num">+{hoursText(g.period)} · 누적 {hoursText(g.total)}{g.targetMs ? ` / ${hoursText(g.targetMs)}` : ""}</span>
                  </div>
                  {g.targetMs && <div className="meter"><i style={{ width: `${Math.min(100, (g.total / g.targetMs) * 100)}%` }} /></div>}
                </div>
              ))}
            </section>
          )}
          {s.estimate && (
            <section className="card">
              <span className="label">예상 시간</span>
              <span>예상 안에 끝낸 일 <b className="num">{s.estimate.within} / {s.estimate.count}</b> ({Math.floor((s.estimate.within * 100) / s.estimate.count)}%)</span>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
