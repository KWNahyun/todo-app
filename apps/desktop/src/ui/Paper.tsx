/**
 * 종이 다이어리 꾸미기 (로드맵): 펜(필압) · 형광펜 · 지우개 · 스티커 · 사진 · 글, 고르기(옮기기 · 키우기 · 돌리기).
 * 하나 = pageItem 항목 하나 (두 기기에서 같은 장을 꾸며도 합쳐짐). 되돌리기는 Ctrl+Z.
 * 그림(PNG)으로 저장 · 인쇄(PDF).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import type { Page, PageItem, Photo } from "@dailytodo/core";
import { longDay } from "../app/dates.ts";
import {
  MARKER_COLORS, PAPER_H, PAPER_W, PEN_COLORS, baseSize, decodePts, hitTest, itemBox, strokeFields, strokePath, transformOf, type Pt,
} from "../app/paper.ts";
import { momentsOf } from "../app/records.ts";
import { useApp, useData } from "../app/store.tsx";
import { toBase64 } from "../platform/base64.ts";
import { PhotoButton, Thumb, usePhotoUrl } from "./photos.tsx";
import { STICKERS, stickerById } from "./stickers.tsx";

type Tool = "select" | "pen" | "marker" | "eraser" | "text";
type Drag = { kind: "move" | "scale" | "rotate"; id: string; sx: number; sy: number; base: PageItem; dx?: number; dy?: number; s?: number; r?: number };

const FONT_FAMILY = { hand: "Gaegu, cursive", serif: "'Gowun Batang', serif", sans: "'Pretendard Variable', sans-serif" } as const;

/** 글 상자 크기 (자동 줄바꿈 없음 — 줄은 Enter 로): 한글 폭 ≈ 글자 크기 */
function textSize(text: string, size: number) {
  const lines = (text || " ").split("\n");
  return { w: Math.max(40, Math.max(...lines.map((l) => l.length)) * size * 0.92 + 8), h: lines.length * size * 1.35 + 6 };
}

function Paper({ paper }: { paper: Page["paper"] }) {
  return (
    <g className="paper-bg">
      <rect width={PAPER_W} height={PAPER_H} fill="#fffdf8" />
      {paper === "lined" && Array.from({ length: 24 }, (_, i) => <line key={i} x1="36" x2={PAPER_W - 36} y1={96 + i * 31} y2={96 + i * 31} stroke="#d7e3ef" strokeWidth="1" />)}
      {paper === "grid" && (
        <>
          {Array.from({ length: 25 }, (_, i) => <line key={`v${i}`} x1={i * 25} x2={i * 25} y1="0" y2={PAPER_H} stroke="#e4ece4" strokeWidth="1" />)}
          {Array.from({ length: 34 }, (_, i) => <line key={`h${i}`} y1={i * 25} y2={i * 25} x1="0" x2={PAPER_W} stroke="#e4ece4" strokeWidth="1" />)}
        </>
      )}
      {paper === "dot" && Array.from({ length: 23 * 33 }, (_, i) => <circle key={i} cx={25 + (i % 23) * 25} cy={25 + Math.floor(i / 23) * 25} r="1.3" fill="#cfd6cf" />)}
    </g>
  );
}

function PhotoImage({ photo, w, h }: { photo: Photo; w: number; h: number }) {
  const url = usePhotoUrl(photo.id);
  return url ? <image href={url} width={w} height={h} preserveAspectRatio="xMidYMid slice" /> : <rect width={w} height={h} fill="#eee" />;
}

function ItemView({ it }: { it: PageItem }) {
  const { w, h } = baseSize(it);
  let body: React.ReactNode = null;
  if (it.kind === "stroke") {
    body = <path d={strokePath(decodePts(it.pts), it.width ?? 3, !it.marker)} fill={it.color ?? "#1d1d1b"} opacity={it.marker ? 0.45 : 1} />;
  } else if (it.kind === "sticker") {
    body = <svg width={w} height={h} viewBox="0 0 100 100">{stickerById(it.sticker)?.svg}</svg>;
  } else if (it.kind === "photo" && it.photo) {
    body = (
      <g>
        <rect x="-6" y="-6" width={w + 12} height={h + 26} fill="#fff" stroke="#e2ded6" strokeWidth="1" />
        <PhotoImage photo={it.photo} w={w} h={h} />
      </g>
    );
  } else if (it.kind === "text") {
    const size = it.size ?? 22;
    body = (
      <text x="4" y={size} fill={it.color ?? "#1d1d1b"} fontSize={size} fontFamily={FONT_FAMILY[it.font ?? "hand"]}>
        {(it.text ?? "").split("\n").map((l, i) => <tspan key={i} x="4" dy={i ? size * 1.35 : 0}>{l || " "}</tspan>)}
      </text>
    );
  }
  return <g transform={transformOf(it)} data-id={it.id}>{body}</g>;
}

export function PaperDiary({ day }: { day: string }) {
  const { rep, actions, platform } = useApp();
  const ver = useData();
  const svg = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(PEN_COLORS[0]!);
  const [mcolor, setMcolor] = useState(MARKER_COLORS[0]!);
  const [width, setWidth] = useState(3);
  // 그리는 중인 점: 이벤트가 몰려 와도 놓치지 않게 ref 에 모으고, 화면엔 state 로
  const [live, setLiveState] = useState<Pt[] | null>(null);
  const liveRef = useRef<Pt[] | null>(null);
  const setLive = (v: Pt[] | null) => {
    liveRef.current = v;
    setLiveState(v);
  };
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [panel, setPanel] = useState<"sticker" | "photo" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [print, setPrint] = useState<string | null>(null);
  const erased = useRef<Set<string>>(new Set());

  const pageId = `page-${day}`;
  const page = rep.get<"page">(pageId);
  const items = useMemo(
    () => rep.list("pageItem", (x) => x.day === day).sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (a.createdAt < b.createdAt ? -1 : 1)),
    [rep, day, ver],
  );
  const topZ = items.reduce((m, x) => Math.max(m, x.z ?? 0), 0);
  const selected = items.find((x) => x.id === sel);
  const dayPhotos = momentsOf(rep, day).flatMap((m) => m.photos ?? []);

  useEffect(() => {
    setSel(null);
    setEditing(null);
  }, [day]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea")) return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) {
        actions.removeMany([sel], "꾸미기 지움");
        setSel(null);
      }
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sel, actions]);

  /** 화면 좌표 → 종이 좌표 */
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const m = svg.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return [p.x, p.y];
  };
  /** 펜을 종이 밖으로 끌어도 계속 받게 (못 잡아도 그리기는 됨) */
  const capture = (e: RPE<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 이미 떨어진 포인터 등
    }
  };
  const pressureOf = (e: PointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 0.5);
  const create = (fields: Partial<PageItem>, label: string) =>
    actions.create("pageItem", { day, z: topZ + 1, ...fields }, label);

  const down = (e: RPE<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const [x, y] = at(e);
    const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle") as Drag["kind"] | null;
    if (tool === "select" || handle) {
      if (handle && selected) {
        capture(e);
        return setDrag({ kind: handle, id: selected.id, sx: x, sy: y, base: selected });
      }
      const hit = [...items].reverse().find((it) => hitTest(it, x, y));
      setSel(hit?.id ?? null);
      if (hit) {
        capture(e);
        setDrag({ kind: "move", id: hit.id, sx: x, sy: y, base: hit, dx: 0, dy: 0 });
      }
      return;
    }
    if (tool === "text") {
      // 이 누름이 끝나며 초점을 종이로 가져가면 막 연 입력 칸이 바로 닫힘 → 기본 동작 막기
      e.preventDefault();
      const size = 24;
      const id = create({ kind: "text", x: x - 4, y: y - size, text: "", size, font: "hand", color, ...textSize("", size) }, "글 추가");
      setTool("select");
      setSel(id);
      setEditing(id);
      return;
    }
    capture(e);
    if (tool === "eraser") {
      erased.current = new Set();
      erase(x, y);
      setLive([[x, y, 0.5]]);
      return;
    }
    setSel(null);
    setLive([[x, y, pressureOf(e.nativeEvent)]]);
  };

  const erase = (x: number, y: number) => {
    for (const it of items) if (it.kind === "stroke" && !erased.current.has(it.id) && hitTest(it, x, y, 8)) erased.current.add(it.id);
  };

  const move = (e: RPE<SVGSVGElement>) => {
    if (drag) {
      const [x, y] = at(e);
      const b = itemBox(drag.base);
      if (drag.kind === "move") setDrag({ ...drag, dx: x - drag.sx, dy: y - drag.sy });
      else if (drag.kind === "scale") {
        const cx = drag.base.x + b.w / 2;
        const cy = drag.base.y + b.h / 2;
        const k = Math.hypot(x - cx, y - cy) / Math.max(1, Math.hypot(drag.sx - cx, drag.sy - cy));
        setDrag({ ...drag, s: Math.min(8, Math.max(0.15, (drag.base.s ?? 1) * k)) });
      } else {
        const cx = drag.base.x + b.w / 2;
        const cy = drag.base.y + b.h / 2;
        const a = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
        setDrag({ ...drag, r: Math.round(a / 5) * 5 });
      }
      return;
    }
    if (!liveRef.current) return;
    // 펜은 한 프레임에 여러 점(coalesced)을 줌 — 비어 있으면 이 이벤트 하나
    const co = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const evs = co.length ? co : [e.nativeEvent];
    const add: Pt[] = evs.map((ev) => {
      const [x, y] = at(ev);
      if (tool === "eraser") erase(x, y);
      return [x, y, pressureOf(ev)];
    });
    setLive([...liveRef.current, ...add]);
  };

  const up = () => {
    if (drag) {
      const d = drag;
      setDrag(null);
      if (d.kind === "move" && (d.dx || d.dy)) actions.update(d.id, { x: d.base.x + (d.dx ?? 0), y: d.base.y + (d.dy ?? 0) }, "옮김");
      if (d.kind === "scale" && d.s) actions.update(d.id, { s: d.s }, "크기 바꿈");
      if (d.kind === "rotate" && d.r != null) actions.update(d.id, { r: d.r }, "돌림");
      return;
    }
    if (!liveRef.current) return;
    const pts = liveRef.current;
    setLive(null);
    if (tool === "eraser") {
      actions.removeMany([...erased.current], `획 ${erased.current.size}개 지움`);
      erased.current = new Set();
      return;
    }
    const marker = tool === "marker";
    create(strokeFields(pts, marker ? mcolor : color, marker ? width * 4 : width, marker), marker ? "형광펜" : "펜");
  };

  /** 끄는 중이면 그만큼 옮기거나 돌린 모양으로 보여 줌 */
  const shown = (it: PageItem): PageItem => {
    if (!drag || drag.id !== it.id) return it;
    return { ...it, x: it.x + (drag.dx ?? 0), y: it.y + (drag.dy ?? 0), s: drag.s ?? it.s, r: drag.r ?? it.r };
  };

  const addSticker = (id: string) => {
    const made = create({ kind: "sticker", sticker: id, x: PAPER_W / 2 - 50, y: PAPER_H / 3, w: 100, h: 100, r: Math.round((Math.random() - 0.5) * 16) }, "스티커");
    setTool("select");
    setSel(made);
    setPanel(null);
  };
  const addPhoto = (p: Photo) => {
    const w = 260;
    const h = Math.round((w * p.h) / p.w);
    const made = create({ kind: "photo", photo: p, x: PAPER_W / 2 - w / 2, y: 120, w, h, r: Math.round((Math.random() - 0.5) * 8) }, "사진 붙임");
    setTool("select");
    setSel(made);
    setPanel(null);
  };

  /** 지금 장을 PNG 로 (사진은 데이터로 넣어서, 글꼴은 이 PC 에 있는 걸로) */
  const savePng = async () => {
    try {
      const svgText = await standaloneSvg(svg.current!);
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
      const c = document.createElement("canvas");
      c.width = PAPER_W * 2;
      c.height = PAPER_H * 2;
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      const path = await platform.saveExport(`다이어리 ${day}`, "png", new Uint8Array(await blob!.arrayBuffer()));
      if (path) setMsg(`저장했어요: ${path}`);
    } catch (e) {
      setMsg(`저장하지 못했어요: ${String(e)}`);
    }
  };

  const tools: [Tool, string][] = [["select", "고르기"], ["pen", "펜"], ["marker", "형광펜"], ["eraser", "지우개"], ["text", "글"]];
  const editItem = editing ? items.find((x) => x.id === editing) : undefined;

  return (
    <div className="paper-wrap">
      <div className="paper-tools">
        <div className="seg" role="group" aria-label="도구">
          {tools.map(([t, l]) => <button key={t} aria-pressed={tool === t} onClick={() => { setTool(t); setPanel(null); }}>{l}</button>)}
        </div>
        {(tool === "pen" || tool === "text") && (
          <span className="swatches" role="group" aria-label="색">
            {PEN_COLORS.map((c) => <button key={c} style={{ background: c }} aria-pressed={color === c} aria-label={c} onClick={() => setColor(c)} />)}
          </span>
        )}
        {tool === "marker" && (
          <span className="swatches" role="group" aria-label="형광펜 색">
            {MARKER_COLORS.map((c) => <button key={c} style={{ background: c }} aria-pressed={mcolor === c} aria-label={c} onClick={() => setMcolor(c)} />)}
          </span>
        )}
        {(tool === "pen" || tool === "marker") && (
          <div className="seg" role="group" aria-label="굵기">
            {[2, 3, 6].map((w) => <button key={w} aria-pressed={width === w} onClick={() => setWidth(w)}>{w === 2 ? "가늘게" : w === 3 ? "보통" : "굵게"}</button>)}
          </div>
        )}
        <button className={`btn${panel === "sticker" ? " btn-accent" : ""}`} onClick={() => setPanel(panel === "sticker" ? null : "sticker")}>스티커</button>
        <button className={`btn${panel === "photo" ? " btn-accent" : ""}`} onClick={() => setPanel(panel === "photo" ? null : "photo")}>사진</button>
        <span style={{ flex: 1 }} />
        <select className="field" style={{ width: 96 }} aria-label="종이" value={page?.paper ?? "lined"}
          onChange={(e) => actions.create("page", { day, paper: e.target.value }, "종이 바꿈", pageId)}>
          <option value="plain">무지</option>
          <option value="lined">줄</option>
          <option value="grid">모눈</option>
          <option value="dot">점</option>
        </select>
        <button className="btn btn-ghost" onClick={() => void savePng()}>그림으로 저장</button>
        <button className="btn btn-ghost" onClick={async () => setPrint(await standaloneSvg(svg.current!))}>인쇄 · PDF</button>
      </div>

      {panel === "sticker" && (
        <div className="sticker-panel">
          {STICKERS.map((s) => (
            <button key={s.id} title={s.label} aria-label={`${s.label} 스티커`} onClick={() => addSticker(s.id)}>
              <svg viewBox="0 0 100 100" width="44" height="44">{s.svg}</svg>
            </button>
          ))}
        </div>
      )}
      {panel === "photo" && (
        <div className="sticker-panel">
          {dayPhotos.map((p) => <Thumb key={p.id} photo={p} size={64} onClick={() => addPhoto(p)} />)}
          {!dayPhotos.length && <span className="muted" style={{ fontSize: 13 }}>이날 타임라인에 붙인 사진이 없어요 —</span>}
          <PhotoButton label="새 사진 고르기" onAdd={(ps) => ps.forEach(addPhoto)} />
        </div>
      )}

      <div className="paper-stage">
        <svg ref={svg} className={`paper-svg tool-${tool}`} viewBox={`0 0 ${PAPER_W} ${PAPER_H}`} xmlns="http://www.w3.org/2000/svg"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onDoubleClick={(e) => {
            const [x, y] = at(e);
            const hit = [...items].reverse().find((it) => it.kind === "text" && hitTest(it, x, y));
            if (hit) setEditing(hit.id);
          }}>
          <Paper paper={page?.paper ?? "lined"} />
          <text x="36" y="58" fontSize="22" fontFamily={FONT_FAMILY.serif} fill="#3a4a40">{longDay(day)}</text>
          {items.filter((it) => it.id !== editing).map((it) => <ItemView key={it.id} it={shown(it)} />)}
          {live && tool !== "eraser" && (
            <path d={strokePath(live, tool === "marker" ? width * 4 : width, tool !== "marker")} fill={tool === "marker" ? mcolor : color} opacity={tool === "marker" ? 0.45 : 1} />
          )}
          {selected && !editing && <Selection it={shown(selected)} />}
        </svg>
        {editItem && <TextEditor key={editItem.id} svg={svg.current!} it={editItem} onDone={(text) => {
          setEditing((cur) => (cur === editItem.id ? null : cur)); // 그새 다른 글을 열었으면 그건 그대로
          // 새로 만든 빈 칸을 안 쓰고 두면 조용히 정리, 쓰던 글을 비웠으면 지운 것 (되돌리기 줄)
          if (!text.trim()) actions.removeMany([editItem.id], editItem.text ? "글 지움" : "빈 글 정리", !!editItem.text);
          else if (text !== editItem.text) actions.update(editItem.id, { text, ...textSize(text, editItem.size ?? 24) }, "글 고침");
        }} />}
      </div>

      {selected && (
        <div className="row paper-sel">
          <span className="muted" style={{ fontSize: 13 }}>{{ stroke: "획", sticker: "스티커", photo: "사진", text: "글" }[selected.kind]} 골랐어요 — 끌어서 옮기기 · 오른쪽 아래 점으로 크기 · 위 점으로 돌리기</span>
          {selected.kind === "text" && <button className="btn" onClick={() => setEditing(selected.id)}>글 고치기</button>}
          {selected.kind === "text" && (
            <select className="field" style={{ width: 96 }} aria-label="글꼴" value={selected.font ?? "hand"} onChange={(e) => actions.update(selected.id, { font: e.target.value }, "글꼴 바꿈")}>
              <option value="hand">손글씨</option>
              <option value="serif">명조</option>
              <option value="sans">고딕</option>
            </select>
          )}
          <button className="btn" onClick={() => actions.update(selected.id, { z: topZ + 1 }, "맨 앞으로")}>맨 앞으로</button>
          <button className="btn" onClick={() => { actions.removeMany([selected.id], "꾸미기 지움"); setSel(null); }}>지우기</button>
        </div>
      )}
      {msg && <span className="input-ok">{msg}</span>}
      {print && createPortal(
        <div className="print-view" role="dialog" aria-label="인쇄 미리보기">
          <div className="print-bar no-print">
            <span>인쇄 창에서 프린터를 'PDF로 저장'으로 고르면 PDF 가 돼요.</span>
            <span className="row"><button className="btn btn-accent" onClick={() => window.print()}>인쇄 · PDF</button><button className="btn" onClick={() => setPrint(null)}>닫기</button></span>
          </div>
          <div className="paper print-page" dangerouslySetInnerHTML={{ __html: print }} />
        </div>,
        document.body,
      )}
      {print && <PrintClass />}
    </div>
  );
}

function PrintClass() {
  useEffect(() => {
    document.documentElement.classList.add("printing");
    return () => document.documentElement.classList.remove("printing");
  }, []);
  return null;
}

/** 고른 항목 둘레 + 손잡이 (크기 · 돌리기) */
function Selection({ it }: { it: PageItem }) {
  const { w, h } = baseSize(it);
  const s = it.s ?? 1;
  const b = { w: w * s, h: h * s };
  return (
    <g transform={`translate(${it.x} ${it.y}) rotate(${it.r ?? 0} ${b.w / 2} ${b.h / 2})`} className="selection">
      <rect x="-4" y="-4" width={b.w + 8} height={b.h + 8} fill="none" stroke="#2f6a4c" strokeWidth="1.5" strokeDasharray="5 4" />
      <line x1={b.w / 2} y1="-4" x2={b.w / 2} y2="-26" stroke="#2f6a4c" strokeWidth="1.5" />
      <circle data-handle="rotate" cx={b.w / 2} cy="-30" r="8" fill="#fff" stroke="#2f6a4c" strokeWidth="2" style={{ cursor: "grab" }} />
      <circle data-handle="scale" cx={b.w + 4} cy={b.h + 4} r="8" fill="#2f6a4c" style={{ cursor: "nwse-resize" }} />
    </g>
  );
}

/** 글 고치기: 그 자리에 입력칸 (Enter 는 줄바꿈, 바깥을 누르면 저장) */
function TextEditor({ svg, it, onDone }: { svg: SVGSVGElement; it: PageItem; onDone: (text: string) => void }) {
  const [v, setV] = useState(it.text ?? "");
  // 다른 화면으로 가서 닫혀도(blur 없이) 쓴 글은 저장 — 한 번만
  const latest = useRef(v);
  latest.current = v;
  const done = useRef(false);
  const finish = (text: string) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  // 정말 닫혔을 때만 (개발 모드의 '껐다 켜 보기'에선 바로 다시 켜지므로 건너뜀)
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      setTimeout(() => !alive.current && finish(latest.current), 0);
    };
  }, []);
  // 칸을 연 누름(마우스 · 펜)이 끝난 뒤에 초점 — 바로 주면 그 누름이 초점을 다시 빼앗음
  const box = useRef<HTMLTextAreaElement>(null);
  const opened = useRef(Date.now());
  useEffect(() => {
    const t = setTimeout(() => box.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);
  const r = svg.getBoundingClientRect();
  const k = r.width / PAPER_W;
  const size = (it.size ?? 24) * (it.s ?? 1) * k;
  return (
    <textarea ref={box} className="paper-text" value={v} placeholder="여기에 쓰기"
      style={{ left: it.x * k, top: it.y * k, fontSize: size, fontFamily: FONT_FAMILY[it.font ?? "hand"], color: it.color ?? "#1d1d1b", transform: `rotate(${it.r ?? 0}deg)` }}
      onChange={(e) => setV(e.target.value)}
      onBlur={(e) => {
        // 연 직후 잠깐 초점이 빠지는 건 무시하고 다시 잡음
        if (Date.now() - opened.current < 400) return void setTimeout(() => e.target.focus(), 0);
        finish(v);
      }}
      onKeyDown={(e) => e.key === "Escape" && (e.target as HTMLTextAreaElement).blur()} />
  );
}

/** 화면의 종이 SVG → 혼자 열리는 SVG 글 (손잡이 빼고, 사진은 데이터로) */
async function standaloneSvg(el: SVGSVGElement): Promise<string> {
  const clone = el.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll(".selection").forEach((n) => n.remove());
  clone.setAttribute("width", String(PAPER_W));
  clone.setAttribute("height", String(PAPER_H));
  for (const img of [...clone.querySelectorAll("image")]) {
    const href = img.getAttribute("href") ?? "";
    if (!href.startsWith("blob:")) continue;
    const bytes = new Uint8Array(await (await fetch(href)).arrayBuffer());
    img.setAttribute("href", `data:image/webp;base64,${toBase64(bytes)}`);
  }
  return new XMLSerializer().serializeToString(clone);
}
