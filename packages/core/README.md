# @dailytodo/core — v2 동기화 핵심

화면 없는 순수 TypeScript 라이브러리. 설계는 [docs/v2/01-데이터-동기화-설계.md](../../docs/v2/01-데이터-동기화-설계.md).
브라우저 · Tauri 웹뷰 · Node 어디서나 돌아감 (`node-fs.ts` 만 Node 전용).

| 파일 | 하는 일 |
|---|---|
| `hlc.ts` | 하이브리드 논리 시계 — 변경마다 붙는 시각, 문자열 비교 = 순서 |
| `ids.ts` | UUIDv7 항목 ID, 이름에서 늘 같은 ID(v1 가져오기), 기기 ID |
| `order.ts` | 분수 인덱스 순서 값 (드래그 정렬) |
| `ops.ts` | 변경 기록 한 줄 형식(NDJSON) · 검사 · 파일 이름 |
| `state.ts` | 합치기: 칸 단위 늦은 값 이김, 지움 표시, 일기 동시 수정 보관 |
| `schema.ts` | 항목 종류별 칸 (task · session · event · deadline · … · record · mandala) |
| `vault.ts` | 보관함 폴더 모양, `VaultFs`(메모리 구현 포함), vault.json |
| `replica.ts` | 한 기기의 복제본: 쓰기 · 읽기 · flush · pull · 스냅샷 · 기기 안 저장 |
| `sessions.ts` | 타이머 = 세션: 켜기 · 끄기 · 잰 시간 · 날짜별 합계 |
| `import-v1.ts` | v1 JSON 가져오기 |
| `node-fs.ts` | PC 동기화 폴더 읽고 쓰기, v1 폴더 찾기 · 읽기 |

```ts
import { MemoryFs, Replica, startTimer } from "@dailytodo/core";

const pc = await Replica.open(fs, { deviceId: "pc-k3x9q2ma", name: "노트북" });
const id = pc.create("task", { day: "2026-10-15", title: "KAMP 제출" });
startTimer(pc, id, Date.now());
await pc.sync(); // 내 변경 덧붙이기 + 다른 기기 변경 합치기
pc.list("task", (t) => t.day === "2026-10-15");
```

## 명령

```bash
npm install
npm test               # Vitest (여러 기기 동시 수정 시뮬레이션 포함)
npm run typecheck
node scripts/import-check.ts   # 실제 v1 기록 가져오기 확인 (읽기만, 아무것도 안 씀)
```
