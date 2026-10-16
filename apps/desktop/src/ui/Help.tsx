/** 도움말 (v1 HelpDialog): 입력 한 줄 문법 · 단축키 · 알아 두면 좋은 것 */
import { useEffect } from "react";
import { useApp } from "../app/store.tsx";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, type HotkeyAction } from "../platform/index.ts";
import { Close } from "./icons.tsx";

const GRAMMAR: [string, string][] = [
  ["모델링", "할 일"],
  ["KAMP > 발표 자료", "하위 할 일 (KAMP 묶음이 없으면 만듦)"],
  ["13:30 회의 · 오후 3시 반 회의 · 3시 회의", "그날 일정 (1~6시는 오후로)"],
  ["10/20 13:30 회의 · 10월 5일 오후 2시 병원", "그 날짜 일정"],
  ["미정 MT · 종일 워크숍", "시간 미정 일정"],
  ["마감 10/20 KAMP 제출", "마감 (디데이)"],
  ["- 점심 맛있었다", "타임라인 기록"],
];

const KEYS: [string, string][] = [
  ["Ctrl + K", "찾기 · 실행 (화면 이동, 테마, 할 일 찾기, 바로 추가)"],
  ["Ctrl + Z", "되돌리기 (입력칸 밖에서)"],
  ["Delete", "고른 할 일 · 일정 · 꾸미기 지우기"],
  ["Esc", "상세 패널 · 창 닫기"],
  ["F1", "이 도움말"],
];

const TIPS = [
  "할 일을 오른쪽 버튼으로 누르면: 완료 · 타이머 · 하위 추가 · 다른 할 일 아래로 · 마감 · 목표 연결 · 내일로 · 지우기",
  "묶음 옆 + 를 누르면 바로 아래에 하위 할 일을 이어서 적을 수 있어요",
  "할 일 · 일정은 끌어서 순서 · 날짜를 바꿔요 (일정표에서 다른 날로 끌기)",
  "위젯의 일정 · 마감 칩을 누르면 앞으로의 일정 · 마감이 펼쳐져요",
  "타이머를 켠 채 자리를 비우거나 절전하면, 돌아왔을 때 그 시간을 뺄지 물어봐요",
  "기록은 보관함 폴더(OneDrive 앱 폴더)에만 있어요 — 휴대폰 · 다른 PC 와 저절로 맞춰져요",
];

export function Help({ onClose }: { onClose: () => void }) {
  const { config } = useApp();
  const keys = { ...DEFAULT_HOTKEYS, ...config.hotkeys };
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-label="도움말" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet help" style={{ width: "min(640px, 100%)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>도움말</h2>
          <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
        </div>
        <span className="label">입력 한 줄 (위젯 · 오늘 화면)</span>
        <table className="cmp"><tbody>{GRAMMAR.map(([a, b]) => <tr key={a}><td><code>{a}</code></td><td className="muted">{b}</td></tr>)}</tbody></table>
        <span className="label">전역 단축키 (다른 프로그램을 쓰는 중에도 · 설정에서 바꿈)</span>
        <table className="cmp"><tbody>
          {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((a) => <tr key={a}><td><kbd>{keys[a] || "끔"}</kbd></td><td className="muted">{HOTKEY_LABELS[a]}</td></tr>)}
        </tbody></table>
        <span className="label">앱 안에서</span>
        <table className="cmp"><tbody>{KEYS.map(([a, b]) => <tr key={a}><td><kbd>{a}</kbd></td><td className="muted">{b}</td></tr>)}</tbody></table>
        <span className="label">알아 두면 좋은 것</span>
        <ul className="tips">{TIPS.map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  );
}
