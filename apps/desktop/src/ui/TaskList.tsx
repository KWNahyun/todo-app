/**
 * 할 일 목록 (위젯 · 메인 창 같이 씀).
 * - 동그라미 = 완료, 오른쪽 버튼 = 타이머, 묶음은 접기 · 하위 합계
 * - 끌어서 순서 바꾸기: 같은 묶음 안에서만 (v1 과 같음). 버튼 위에서 누르면 끌지 않음.
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { isRunning, taskElapsedMs, type Task } from "@dailytodo/core";
import { clock } from "../app/dates.ts";
import type { TaskNode } from "../app/selectors.ts";
import { useApp } from "../app/store.tsx";
import { Caret, Check, Pause, Play } from "./icons.tsx";

interface Props {
  tree: TaskNode[];
  now: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
  compact?: boolean;
}

interface Drag {
  id: string;
  parent: string;
  startY: number;
  active: boolean;
  index: number;
  lineY: number | null;
}

export function TaskList({ tree, now, selected, onSelect, compact }: Props) {
  const { actions, rep } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  if (!tree.length) {
    return <div className="empty">오늘 할 일을 위에 적어 보세요. 예) 모델링 · KAMP &gt; 발표 자료 · 13:30 회의</div>;
  }

  const rowsOf = (parent: string) =>
    [...(box.current?.querySelectorAll<HTMLElement>(`[data-parent="${parent}"]`) ?? [])];

  const onDown = (e: RPointerEvent, t: Task, parent: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setDrag({ id: t.id, parent, startY: e.clientY, active: false, index: -1, lineY: null });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    if (!drag.active && Math.abs(e.clientY - drag.startY) < 6) return;
    const rows = rowsOf(drag.parent).filter((r) => r.dataset.id !== drag.id);
    const top = box.current!.getBoundingClientRect().top;
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    const ref = rows[index] ?? rows[index - 1];
    let lineY: number | null = null;
    if (ref) {
      const r = ref.getBoundingClientRect();
      lineY = (rows[index] ? r.top - 3 : r.bottom + 2) - top;
    }
    setDrag({ ...drag, active: true, index, lineY });
  };

  const onUp = (e: RPointerEvent, t: Task) => {
    if (!drag) return;
    if (drag.active) actions.move(drag.id, drag.index);
    else if ((e.target as HTMLElement).closest("button") == null) onSelect?.(t.id);
    setDrag(null);
  };

  const row = (t: Task, parent: string, opts: { child?: boolean; group?: TaskNode }) => {
    const running = isRunning(rep, t.id);
    const ms = taskElapsedMs(rep, t.id, now, { children: !!opts.group });
    const kids = opts.group?.children ?? [];
    const cls = [
      "task",
      opts.child && "child",
      kids.length && "group",
      t.done && "done",
      running && "running",
      selected === t.id && "selected",
      drag?.active && drag.id === t.id && "dragging",
    ].filter(Boolean).join(" ");
    return (
      <div
        key={t.id}
        className={cls}
        data-id={t.id}
        data-parent={parent}
        onPointerDown={(e) => onDown(e, t, parent)}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e, t)}
        onPointerCancel={() => setDrag(null)}
      >
        {kids.length ? (
          <button
            className={`caret${t.collapsed ? " closed" : ""}`}
            aria-label={t.collapsed ? "펼치기" : "접기"}
            aria-expanded={!t.collapsed}
            onClick={() => actions.setCollapsed(t.id, !t.collapsed)}
          >
            <Caret />
          </button>
        ) : (
          !opts.child && tree.some((n) => n.children.length) && <span className="caret-space" />
        )}
        <button
          className="check"
          role="checkbox"
          aria-checked={!!t.done}
          aria-label={`${t.title}, ${t.done ? "완료" : "완료 안 함"}`}
          onClick={() => actions.toggleDone(t.id)}
        >
          <Check />
        </button>
        <span className="t-title" title={t.title}>
          {t.title}
          {kids.length > 0 && <span className="sub">{kids.filter((k) => k.done).length}/{kids.length}</span>}
        </span>
        {ms > 0 && <span className="time num">{clock(ms)}</span>}
        {!kids.length && !t.done && (
          <button className={`btn${running ? " btn-active" : ""}`} onClick={() => actions.toggleTimer(t.id)}>
            {running ? <><Pause /> {compact ? "" : "정지"}</> : <><Play /> {compact ? "" : "시작"}</>}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="tasks" ref={box}>
      {tree.map((n) => [
        row(n.task, "", { group: n.children.length ? n : undefined }),
        ...(!n.task.collapsed ? n.children.map((c) => row(c, n.task.id, { child: true })) : []),
      ])}
      {drag?.active && drag.lineY != null && <div className="drop-line" style={{ top: drag.lineY }} />}
    </div>
  );
}
