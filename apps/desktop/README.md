# Daily Todo v2 — 데스크톱 앱 (Tauri 2 + React)

화면 설계: [docs/v2/02-화면-설계.md](../../docs/v2/02-화면-설계.md) · 시안: [mockup.html](../../docs/v2/mockup.html) ·
동기화: [packages/core](../../packages/core)

## 구조

```
src/
  platform/   운영체제 쪽 (Tauri 구현 · 브라우저 구현) — 파일 · 창 · 창 사이 알림
  app/        화면 없는 로직: 입력 한 줄 해석(parse) · 동작+되돌리기(actions) · 화면용 읽기(selectors) · 상태+동기화(store)
  ui/         위젯 · 메인 창(오늘 · 상세 패널 · 설정) · 공용 조각 · 스타일(테마 토큰)
src-tauri/    Rust 셸: 보관함/앱 데이터 파일 읽고 쓰기, v1 기록 읽기(읽기만), 창 둘, 한 번만 실행, 창 위치 기억
```

- **창 둘 = 복제본 둘**: 위젯 · 메인 창은 각자 복제본(`<PC ID>-widget`, `<PC ID>-main`)으로 자기 기록 파일에만 씀.
  쓰면 다른 창에 알림 → 다른 창이 바로 읽어 합침. 타이머 세션은 창이 아니라 PC ID 로 적음.
- **보관함**: 기본은 OneDrive 앱 폴더(`OneDrive\앱\DailyTodo`), 설정에서 바꿀 수 있음. OneDrive 가 없으면 앱 데이터 폴더.
- **이 창의 상태**: `%APPDATA%\com.kwnahyun.dailytodo\local-<창>.json` (다음에 빨리 켜기용, 지워도 보관함에서 다시 만듦)
- 위젯을 닫으면 앱이 꺼지고, 메인 창을 닫으면 숨기기만 함.

## 명령 (저장소 루트에서)

```bash
npm install
npm run web        # 브라우저로 화면만 (localhost:1420, ?view=widget 이면 위젯) — 보관함은 브라우저 저장소
npm run dev        # 진짜 앱 (Rust 필요: rustup)
npm run build:app  # 설치 파일: apps/desktop/src-tauri/target/release/bundle/nsis/
npm test           # core + 앱 로직 테스트
```
