/**
 * 명령 팔레트 (Ctrl+K, 설계 4장): 이름으로 이동 · 실행. 맞는 게 없으면 입력 한 줄 문법으로 바로 추가.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FEATURES, THEMES, featureOn } from "../app/appearance.ts";
import { DATE } from "../app/records.ts";
import { allSchemas } from "../app/collections.ts";
import { previewKind } from "../app/parse.ts";
import { useApp, useToday } from "../app/store.tsx";
import type { Screen } from "../platform/index.ts";

export interface Go {
  screen: Screen;
  select?: string | null;
  recordsTab?: string;
  dateId?: string;
}

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export function Palette({ onClose, go }: { onClose: () => void; go: (g: Go) => void }) {
  const { rep, actions, platform, saveConfig } = useApp();
  const today = useToday();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const on = (f: (typeof FEATURES)[number]["id"]) => featureOn(rep, f);
    const list: Cmd[] = [
      { id: "s-today", label: "오늘", hint: "화면", run: () => go({ screen: "today" }) },
      ...(on("events") || on("deadlines") ? [{ id: "s-sch", label: "일정표", hint: "화면", run: () => go({ screen: "schedule" }) }] : []),
      { id: "s-diary", label: "다이어리", hint: "기록장", run: () => go({ screen: "records", recordsTab: "diary" }) },
      ...(on("date")
        ? [
            { id: "s-date", label: "데이트 일기", hint: "기록장", run: () => go({ screen: "records", recordsTab: "date" }) },
            { id: "new-date", label: "데이트 일기 쓰기", hint: "새로", run: () => go({ screen: "records", recordsTab: "date", dateId: actions.addRecord(DATE, { title: "새 데이트", day: today }) }) },
          ]
        : []),
      ...allSchemas(rep)
        .filter((s) => !s.feature || on(s.feature))
        .map((s) => ({ id: `col-${s.key}`, label: s.label, hint: "기록장", run: () => go({ screen: "records", recordsTab: s.key }) })),
      ...(on("stats") ? [{ id: "s-stats", label: "통계", hint: "화면", run: () => go({ screen: "stats" }) }] : []),
      ...(on("goals") || on("habits") || on("mandala") ? [{ id: "s-goals", label: "목표 · 습관 · 만다라트", hint: "화면", run: () => go({ screen: "goals" }) }] : []),
      { id: "s-set", label: "설정", hint: "화면", run: () => go({ screen: "settings" }) },
      { id: "widget", label: "위젯 보이기", hint: "창", run: () => void platform.showWidget() },
      ...(on("review") ? [{ id: "review", label: "오늘 정리하기", hint: "위젯", run: () => { void platform.showWidget(); platform.emit("open-review"); } }] : []),
      ...THEMES.map((t) => ({ id: `t-${t.id}`, label: `테마 바꾸기 · ${t.label}`, hint: "모양", run: () => { actions.setShared({ theme: t.id }, `테마: ${t.label}`); void saveConfig({ theme: t.id }); } })),
      ...rep.list("task", (t) => t.day === today).map((t) => ({ id: `task-${t.id}`, label: t.title, hint: t.done ? "오늘 할 일 · 완료" : "오늘 할 일", run: () => go({ screen: "today", select: t.id }) })),
    ];
    return list;
  }, [rep, actions, platform, saveConfig, today, go]);

  const query = q.trim().toLowerCase();
  const shown = query ? cmds.filter((c) => `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(query)) : cmds.filter((c) => !c.id.startsWith("task-"));
  const addCmd: Cmd | null = query
    ? { id: "add", label: `${previewKind(q, today, today).label}로 추가 · ${q.trim()}`, hint: "Enter", run: () => { const r = actions.add(q, today); if (r.ok) go({ screen: "today" }); } }
    : null;
  const all = addCmd ? [...shown, addCmd] : shown;
  const cur = Math.min(i, Math.max(0, all.length - 1));

  useEffect(() => setI(0), [q]);
  useEffect(() => {
    box.current?.querySelector(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    c.run();
    onClose();
  };

  return (
    <div className="overlay palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="명령 팔레트">
        <input autoFocus value={q} placeholder="이동 · 실행 · 할 일 찾기 — 또는 바로 적어서 추가" aria-label="명령"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(cur + 1, all.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(cur - 1, 0)); }
            else if (e.key === "Enter" && !e.nativeEvent.isComposing) run(all[cur]);
          }} />
        <div className="palette-list" ref={box} role="listbox">
          {all.map((c, n) => (
            <button key={c.id} data-i={n} role="option" aria-selected={n === cur} className={n === cur ? "on" : ""}
              onMouseEnter={() => setI(n)} onClick={() => run(c)}>
              <span>{c.label}</span>{c.hint && <small>{c.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
