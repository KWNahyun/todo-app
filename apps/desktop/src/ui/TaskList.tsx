/**
 * 할 일 목록 (위젯 · 메인 창 같이 씀).
 * - 동그라미 = 완료, 오른쪽 버튼 = 타이머, 묶음은 접기 · 하위 합계
 * - 끌어서 순서 바꾸기: 같은 묶음 안에서만 (v1 과 같음). 버튼 위에서 누르면 끌지 않음.
 */
import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { isRunning, taskElapsedMs, type Task } from "@dailytodo/core";
import { featureOn } from "../app/appearance.ts";
import { addDays, clock, dayOf, daysBetween, ddayText } from "../app/dates.ts";
import { ContextMenu, type MenuItem } from "./ContextMenu.tsx";
import type { TaskNode } from "../app/selectors.ts";
import { useApp } from "../app/store.tsx";
import { Caret, Check, Pause, Play } from "./icons.tsx";

interface Props {
  tree: TaskNode[];
  now: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** 우클릭 '상세 편집' (메인 창은 상세 패널, 위젯은 메인 창을 열어서) */
  onDetail?: (id: string) => void;
  compact?: boolean;
  /** 휴대폰: 타이머 버튼 없음(첫 버전은 PC 에서만), 끌어서 정렬 대신 손가락 스크롤 — 길게 누르면 메뉴 */
  phone?: boolean;
}

interface Drag {
  id: string;
  parent: string;
  startY: number;
  active: boolean;
  index: number;
  lineY: number | null;
}

/** 묶음 아래 '하위 할 일 추가…' 한 줄 (+ 버튼 · 우클릭). Enter 로 계속 더하고, Esc · 빈 채로 나가면 닫힘 */
function ChildInput({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const { actions } = useApp();
  const [v, setV] = useState("");
  return (
    <div className="task child add-row">
      <span className="plus">+</span>
      <input autoFocus value={v} placeholder="하위 할 일 추가… (Enter)" aria-label="하위 할 일 추가"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => !v.trim() && onClose()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
            actions.addChild(parentId, v);
            setV("");
          }
        }} />
    </div>
  );
}

export function TaskList({ tree, now, selected, onSelect, onDetail, compact, phone }: Props) {
  const { actions, rep } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; t: Task } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  // 묶음에 연결된 가장 가까운 마감 → 디데이 (v1 의 마감 ↔ 묶음 연결)
  const todayStr = dayOf(new Date(now));
  const ddays = new Map<string, number>();
  for (const d of featureOn(rep, "deadlines") ? rep.list("deadline", (x) => !!x.groupTitle && x.date >= todayStr) : []) {
    const n = daysBetween(todayStr, d.date);
    if (!ddays.has(d.groupTitle!) || n < ddays.get(d.groupTitle!)!) ddays.set(d.groupTitle!, n);
  }

  if (!tree.length) {
    return <div className="empty">오늘 할 일을 위에 적어 보세요. 예) 모델링 · KAMP &gt; 발표 자료 · 13:30 회의</div>;
  }

  const rowsOf = (parent: string) =>
    [...(box.current?.querySelectorAll<HTMLElement>(`[data-parent="${parent}"]`) ?? [])];

  const onDown = (e: RPointerEvent, t: Task, parent: string) => {
    if (phone || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
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

  /** 우클릭 메뉴 (v1 _context_menu + 완료 · 타이머 · 내일로) */
  const menuItems = (t: Task): MenuItem[] => {
    const kids = rep.list("task", (c) => c.parentId === t.id);
    const leaf = !kids.length;
    const top = !t.parentId || !rep.get(t.parentId);
    const items: MenuItem[] = [
      { label: t.done ? "완료 취소" : "완료", onClick: () => actions.toggleDone(t.id) },
      ...(leaf && !t.done && !phone ? [{ label: isRunning(rep, t.id) ? "타이머 정지" : "타이머 시작", onClick: () => actions.toggleTimer(t.id) }] : []),
      { label: "상세 편집 (메모 · 예상 시간)", onClick: () => (onDetail ?? onSelect)?.(t.id) },
      { label: "", separator: true },
    ];
    if (!top) {
      items.push({ label: "묶음에서 빼기", onClick: () => actions.setParent(t.id, null) });
    } else {
      items.push({ label: "하위 할 일 추가", onClick: () => setAdding(t.id) });
      const targets = tree.map((n) => n.task).filter((x) => x.id !== t.id);
      if (leaf && targets.length) {
        items.push({ label: "다른 할 일 아래로 묶기", sub: targets.map((x) => ({ label: x.title, onClick: () => actions.setParent(t.id, x.id) })) });
      }
      if (featureOn(rep, "deadlines")) {
        const dls = rep.list("deadline", (d) => d.date >= todayStr).sort((a, b) => (a.date < b.date ? -1 : 1));
        items.push({
          label: "마감 연결",
          sub: dls.length
            ? dls.map((d) => ({ label: `${ddayText(daysBetween(todayStr, d.date))}  ${d.title}`, checked: d.groupTitle === t.title, onClick: () => actions.linkDeadline(d.id, t.title) }))
            : [{ label: "다가오는 마감이 없어요 — '마감 10/20 …' 으로 추가", disabled: true }],
        });
      }
      if (featureOn(rep, "goals")) {
        const goals = rep.list("goal", (g) => !g.archived);
        items.push({
          label: "목표에 연결",
          sub: [
            ...goals.map((g) => ({ label: g.title, checked: g.title === t.title || (g.linkedTitles ?? []).includes(t.title), onClick: () => actions.linkGoal(g.id, t.title) })),
            { label: "+ 이 할 일로 새 목표 만들기", onClick: () => actions.toGoal(t.title) },
          ],
        });
      }
    }
    const undone = leaf ? (t.done ? [] : [t.id]) : kids.filter((k) => !k.done).map((k) => k.id);
    if (undone.length) items.push({ label: leaf ? "내일로 넘기기" : `남은 하위 ${undone.length}개 내일로 넘기기`, onClick: () => actions.carryTo(undone, addDays(t.day, 1)) });
    items.push({ label: "", separator: true }, { label: "지우기", danger: true, onClick: () => actions.removeTask(t.id) });
    return items;
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
        onContextMenu={(e) => {
          e.preventDefault();
          setDrag(null);
          setMenu({ x: e.clientX, y: e.clientY, t });
        }}
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
          {!opts.child && ddays.has(t.title) && (
            <span className={`tag ${ddays.get(t.title)! <= 3 ? "tag-danger" : ddays.get(t.title)! <= 7 ? "tag-sun" : "tag-accent"}`} style={{ marginLeft: 6 }}>
              {ddayText(ddays.get(t.title)!)}
            </span>
          )}
        </span>
        {ms > 0 && <span className="time num">{clock(ms)}</span>}
        {kids.length > 0 && (
          <button className="icon-btn add-child" title="하위 할 일 추가" aria-label={`${t.title} 아래에 하위 할 일 추가`} onClick={() => setAdding(t.id)}>+</button>
        )}
        {!phone && !kids.length && !t.done && (
          <button className={`btn${running ? " btn-active" : ""}`} onClick={() => actions.toggleTimer(t.id)}>
            {running ? <><Pause /> {compact ? "" : "정지"}</> : <><Play /> {compact ? "" : "시작"}</>}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`tasks${phone ? " phone-tasks" : ""}`} ref={box}>
      {tree.map((n) => [
        row(n.task, "", { group: n.children.length ? n : undefined }),
        ...(!n.task.collapsed || adding === n.task.id ? n.children.map((c) => row(c, n.task.id, { child: true })) : []),
        ...(adding === n.task.id ? [<ChildInput key={`add-${n.task.id}`} parentId={n.task.id} onClose={() => setAdding(null)} />] : []),
      ])}
      {drag?.active && drag.lineY != null && <div className="drop-line" style={{ top: drag.lineY }} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.t)} onClose={() => setMenu(null)} />}
    </div>
  );
}
