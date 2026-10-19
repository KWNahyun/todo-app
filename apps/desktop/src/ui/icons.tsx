/** 선 아이콘 (currentColor) — 이모지 대신 */
const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const Check = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" {...S} strokeWidth={2} /></svg>
);
export const Caret = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" {...S} /></svg>
);
export const Play = () => (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 2l7 4-7 4z" fill="currentColor" /></svg>
);
export const Pause = () => (
  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor" /></svg>
);
export const Left = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" {...S} /></svg>
);
export const Right = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" {...S} /></svg>
);
export const Close = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" {...S} /></svg>
);
export const Minus = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" {...S} /></svg>
);
export const Expand = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" {...S} /><path d="M6 3v10" {...S} /></svg>
);
/** 고정 방식: 보통 · 항상 위 · 바탕화면 */
export const Pin = ({ mode }: { mode: "normal" | "top" | "desktop" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {mode === "top" && <path d="M8 2v9M4.5 5.5L8 2l3.5 3.5M3 14h10" {...S} />}
    {mode === "desktop" && <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10" {...S} />}
    {mode === "normal" && <><rect x="3" y="3" width="10" height="10" rx="2" {...S} /><path d="M6 8h4" {...S} /></>}
  </svg>
);
export const Trash = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" {...S} /></svg>
);

/** 앱 로고 (아이콘과 같은 스톱워치 + 체크, 글자 크기에 맞춤) */
export const Logo = () => (
  <svg className="logo" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
    <rect x="10.8" y="1.6" width="2.4" height="2.4" rx=".8" fill="currentColor" />
    <circle cx="12" cy="13.4" r="8.4" {...S} strokeWidth={2} />
    <path d="M8.6 13.6l2.4 2.4 4.4-4.6" {...S} strokeWidth={2.2} />
  </svg>
);
