/** 종이 다이어리 스티커 (직접 그린 SVG, 100×100) — 이모지 대신, 테마와 상관없이 같은 색 */
import type { ReactNode } from "react";

export const STICKERS: { id: string; label: string; svg: ReactNode }[] = [
  { id: "heart", label: "하트", svg: <path d="M50 86 C20 64 8 46 14 30 C20 14 40 12 50 28 C60 12 80 14 86 30 C92 46 80 64 50 86 Z" fill="#f28b9b" stroke="#c9566b" strokeWidth="3" /> },
  { id: "star", label: "별", svg: <path d="M50 8 L61 37 L92 38 L67 57 L76 88 L50 70 L24 88 L33 57 L8 38 L39 37 Z" fill="#ffd166" stroke="#d99a1e" strokeWidth="3" strokeLinejoin="round" /> },
  {
    id: "flower", label: "꽃", svg: (
      <g>
        {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="50" cy="28" rx="15" ry="22" fill="#f6b6d0" stroke="#d0779e" strokeWidth="2.5" transform={`rotate(${a} 50 50)`} />)}
        <circle cx="50" cy="50" r="12" fill="#ffd166" stroke="#d99a1e" strokeWidth="2.5" />
      </g>
    ),
  },
  {
    id: "leaf", label: "잎", svg: (
      <g>
        <path d="M20 82 C18 40 50 14 86 16 C86 54 60 84 20 82 Z" fill="#9fd08b" stroke="#4f8a3f" strokeWidth="3" />
        <path d="M22 80 C40 60 56 42 80 22" fill="none" stroke="#4f8a3f" strokeWidth="2.5" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: "sun", label: "해", svg: (
      <g stroke="#e0951c" strokeWidth="4" strokeLinecap="round">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="50" y1="10" x2="50" y2="22" transform={`rotate(${a} 50 50)`} />)}
        <circle cx="50" cy="50" r="22" fill="#ffd166" strokeWidth="3" />
      </g>
    ),
  },
  { id: "cloud", label: "구름", svg: <path d="M26 72 C12 72 8 56 20 50 C18 34 38 28 46 38 C52 24 76 26 76 44 C90 44 94 70 76 72 Z" fill="#e6f1fb" stroke="#7aa6cf" strokeWidth="3" strokeLinejoin="round" /> },
  { id: "sparkle", label: "반짝", svg: <path d="M50 6 C54 38 62 46 94 50 C62 54 54 62 50 94 C46 62 38 54 6 50 C38 46 46 38 50 6 Z" fill="#fff3b0" stroke="#d9b21e" strokeWidth="3" strokeLinejoin="round" /> },
  {
    id: "check", label: "완료", svg: (
      <g>
        <circle cx="50" cy="50" r="38" fill="#a8e6a1" stroke="#3f8a4a" strokeWidth="3.5" />
        <path d="M32 51 L45 64 L70 38" fill="none" stroke="#2f6a3a" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
  },
  {
    id: "coffee", label: "커피", svg: (
      <g stroke="#7a4f2c" strokeWidth="3.5" strokeLinejoin="round">
        <path d="M22 40 H70 V66 C70 78 60 84 46 84 C32 84 22 78 22 66 Z" fill="#f3e3cf" />
        <path d="M70 46 C84 46 84 64 70 64" fill="none" />
        <path d="M36 30 C32 24 40 20 36 14 M50 30 C46 24 54 20 50 14" fill="none" strokeLinecap="round" />
      </g>
    ),
  },
  {
    id: "bow", label: "리본", svg: (
      <g stroke="#b5547a" strokeWidth="3" strokeLinejoin="round">
        <path d="M50 50 L14 30 L18 70 Z M50 50 L86 30 L82 70 Z" fill="#f7c6d9" />
        <path d="M50 50 L38 88 M50 50 L62 88" fill="none" strokeLinecap="round" />
        <circle cx="50" cy="50" r="9" fill="#e98bb0" />
      </g>
    ),
  },
  {
    id: "tape", label: "마스킹 테이프", svg: (
      <g>
        <path d="M4 36 L96 30 L98 66 L6 72 Z" fill="#a7d8ff" opacity="0.8" />
        {[14, 30, 46, 62, 78].map((x) => <line key={x} x1={x} y1={34} x2={x + 6} y2={70} stroke="#ffffff" strokeWidth="5" opacity="0.7" />)}
      </g>
    ),
  },
  {
    id: "smile", label: "웃음", svg: (
      <g stroke="#d99a1e" strokeWidth="3.5" strokeLinecap="round">
        <circle cx="50" cy="50" r="38" fill="#ffe066" />
        <circle cx="37" cy="42" r="3.5" fill="#7a5a10" stroke="none" />
        <circle cx="63" cy="42" r="3.5" fill="#7a5a10" stroke="none" />
        <path d="M34 58 C42 70 58 70 66 58" fill="none" stroke="#7a5a10" />
      </g>
    ),
  },
];

export const stickerById = (id: string | undefined) => STICKERS.find((s) => s.id === id);
