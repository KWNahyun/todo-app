/** 내보내기 버튼 · 인쇄(PDF) 보기 — 저장은 platform.saveExport (Rust 가 저장 창을 염) */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { allSchemas, type Schema } from "../app/collections.ts";
import { addDays, dayOf, hhmm, longDay, toDate } from "../app/dates.ts";
import { allJson, collectionCsv, collectionMarkdown, diaryMarkdown, utf8 } from "../app/export.ts";
import { MOODS, journalOf, momentsOf, moodOf } from "../app/records.ts";
import { useApp, useToday } from "../app/store.tsx";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";

export function useSaver() {
  const { platform } = useApp();
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const h = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(h);
  }, [msg]);
  const save = async (name: string, ext: "md" | "csv" | "json", text: string) => {
    try {
      const path = await platform.saveExport(name, ext, utf8(text));
      if (path) setMsg(`저장했어요: ${path}`);
    } catch (e) {
      setMsg(`저장하지 못했어요: ${String(e)}`);
    }
  };
  return { save, msg };
}

/** 그달 경계 */
export function monthRange(day: string): [string, string] {
  const d = toDate(day);
  return [dayOf(new Date(d.getFullYear(), d.getMonth(), 1)), dayOf(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

/** 다이어리 내보내기 (이 달 · 올해 · 전체 Markdown, 이 달 인쇄 · PDF) */
export function DiaryExport({ day }: { day: string }) {
  const { rep } = useApp();
  const { save, msg } = useSaver();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [print, setPrint] = useState<[string, string] | null>(null);
  const [mf, mt] = monthRange(day);
  const y = day.slice(0, 4);
  const ym = `${y}년 ${Number(day.slice(5, 7))}월`;
  const items: MenuItem[] = [
    { label: `${ym} — Markdown`, onClick: () => void save(`다이어리 ${day.slice(0, 7)}`, "md", diaryMarkdown(rep, mf, mt, `${ym} 다이어리`)) },
    { label: `${y}년 전체 — Markdown`, onClick: () => void save(`다이어리 ${y}`, "md", diaryMarkdown(rep, `${y}-01-01`, `${y}-12-31`, `${y}년 다이어리`)) },
    { label: "모든 날 — Markdown", onClick: () => void save("다이어리 전체", "md", diaryMarkdown(rep, "0000-01-01", "9999-12-31")) },
    { label: "", separator: true },
    { label: `${ym} — 인쇄 · PDF로 저장`, onClick: () => setPrint([mf, mt]) },
  ];
  return (
    <>
      <button className="btn btn-ghost" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>내보내기</button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {msg && <span className="input-ok">{msg}</span>}
      {print && <PrintDiary from={print[0]} to={print[1]} title={`${ym} 다이어리`} onClose={() => setPrint(null)} />}
    </>
  );
}

export function CollectionExport({ s }: { s: Schema }) {
  const { rep } = useApp();
  const { save, msg } = useSaver();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button className="btn btn-ghost" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>내보내기</button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: "CSV (엑셀에서 열기)", onClick: () => void save(s.label, "csv", collectionCsv(rep, s)) },
          { label: "Markdown", onClick: () => void save(s.label, "md", collectionMarkdown(rep, s)) },
        ]} />
      )}
      {msg && <span className="input-ok">{msg}</span>}
    </>
  );
}

/** 설정 › 내보내기 */
export function ExportSection() {
  const { rep } = useApp();
  const today = useToday();
  const { save, msg } = useSaver();
  const [col, setCol] = useState("bucket");
  const schemas = allSchemas(rep);
  const s = schemas.find((x) => x.key === col) ?? schemas[0]!;
  const [mf, mt] = monthRange(today);
  return (
    <section>
      <h2>내보내기</h2>
      <p>기록을 파일로 꺼내 따로 보관하거나 다른 앱으로 옮겨요. 사진은 "사진 n장"으로 적혀요 (사진 파일은 보관함의 blobs 폴더에).</p>
      <div className="row">
        <span className="label" style={{ width: 90 }}>다이어리</span>
        <button className="btn" onClick={() => void save(`다이어리 ${today.slice(0, 7)}`, "md", diaryMarkdown(rep, mf, mt))}>이 달 Markdown</button>
        <button className="btn" onClick={() => void save("다이어리 전체", "md", diaryMarkdown(rep, "0000-01-01", "9999-12-31"))}>전체 Markdown</button>
      </div>
      <div className="row">
        <span className="label" style={{ width: 90 }}>기록장 모음</span>
        <select className="field" style={{ width: 160 }} value={s.key} onChange={(e) => setCol(e.target.value)} aria-label="모음">
          {schemas.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <button className="btn" onClick={() => void save(s.label, "csv", collectionCsv(rep, s))}>CSV</button>
        <button className="btn" onClick={() => void save(s.label, "md", collectionMarkdown(rep, s))}>Markdown</button>
      </div>
      <div className="row">
        <span className="label" style={{ width: 90 }}>모든 기록</span>
        <button className="btn" onClick={() => void save(`Daily Todo 기록 ${today}`, "json", allJson(rep))}>JSON 한 파일로</button>
      </div>
      {msg && <span className="input-ok">{msg}</span>}
    </section>
  );
}

/** 인쇄용 보기: 화면에는 미리보기, 인쇄하면 이것만 (인쇄 창에서 'PDF로 저장' 고르면 PDF) */
export function PrintDiary({ from, to, title, onClose }: { from: string; to: string; title: string; onClose: () => void }) {
  const { rep } = useApp();
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (journalOf(rep, d)?.text.trim() || momentsOf(rep, d).length || moodOf(rep, d)) days.push(d);
  }
  useEffect(() => {
    document.documentElement.classList.add("printing");
    return () => document.documentElement.classList.remove("printing");
  }, []);
  // body 바로 아래에 (인쇄할 때 나머지 화면을 통째로 숨기기 쉽게)
  return createPortal(
    <div className="print-view" role="dialog" aria-label="인쇄 미리보기">
      <div className="print-bar no-print">
        <span>인쇄 창에서 프린터를 'PDF로 저장'(Microsoft Print to PDF)으로 고르면 PDF 가 돼요.</span>
        <span className="row">
          <button className="btn btn-accent" onClick={() => window.print()}>인쇄 · PDF</button>
          <button className="btn" onClick={onClose}>닫기</button>
        </span>
      </div>
      <article className="paper">
        <h1>{title}</h1>
        {!days.length && <p>이 기간에 쓴 일기가 없어요.</p>}
        {days.map((d) => {
          const mood = moodOf(rep, d)?.level;
          const text = journalOf(rep, d)?.text.trim();
          const ms = momentsOf(rep, d);
          return (
            <section key={d} className="pday">
              <h2>{longDay(d)}{mood ? <small> · {MOODS[mood - 1]!.label}</small> : null}</h2>
              {text && <p className="ptext">{text}</p>}
              {ms.length > 0 && <ul>{ms.map((m) => <li key={m.id}><span className="num">{hhmm(m.at)}</span> {m.text}</li>)}</ul>}
            </section>
          );
        })}
      </article>
    </div>,
    document.body,
  );
}
