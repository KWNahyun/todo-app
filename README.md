# Daily Todo

할 일 + 스톱워치 + 기록을 한 곳에서 다루는 Windows 데스크톱 위젯 (Python · tkinter).

## 실행 · 테스트 · 설치

```powershell
# 개발 중 실행
python todo.pyw

# 테스트 (임시 데이터 사용, 실제 기록은 건드리지 않음)
python -m unittest discover -s tests -v

# 테스트 → exe 빌드 → %LOCALAPPDATA%\Programs\DailyTodo 설치 → 실행
powershell -ExecutionPolicy Bypass -File build.ps1
```

데이터: `%APPDATA%\DailyTodo\*.json` (자동 백업은 `backups\`).
`DAILY_TODO_DATA` 환경 변수로 데이터 위치를 바꿀 수 있음 (테스트가 이걸 씀).

## 코드 구조

```
todo.pyw                 실행 진입점 (PyInstaller 도 이 파일에서 시작)
dailytodo/
  config.py              경로 · 색 · 글꼴 · 기능 목록 같은 상수
  core.py                순수 로직: 시간 계산, 입력 해석('13:30 회의'), 할 일 구조
  storage.py             JSON 저장, 날짜별 할 일 저장소(Store), 자동 백업
  winapi.py              Windows 전용: 전역 단축키, 입력 없음 시간, 화면 영역, 중복 실행 방지
  widgets.py             공용 부품: Dialog 틀, CheckRow, Toast, CalendarPopup, MoodPicker, HabitBar
  dialogs.py             대화상자: 할 일 상세, 마감, 목표, 습관, 오늘 정리, 설정, 백업 …
  schedule.py            일정표 창
  mandala.py             만다라트 창
  stats.py               주간 통계 창
  app.py                 App 본체 (시작 · 매 틱 갱신 · 창 열기 · 종료) + main()
  ui_window.py           └ WindowMixin    위젯/창 모드, 레이아웃, ⋯ 메뉴
  ui_tasks.py            └ TaskListMixin  할 일 목록, 드래그 정렬, 되돌리기
  ui_top.py              └ TopMixin       상단 일정 · 마감 · 목표
  ui_journal.py          └ JournalMixin   일기 · 기분 · 습관
  ui_timers.py           └ TimerMixin     자리 비움, 뽀모도로, 알림, 단축키
tests/test_app.py        회귀 테스트
```

의존 방향: `config → core → storage → widgets → dialogs → (schedule · mandala · stats) → ui_* → app`.
아래쪽 모듈은 위쪽(App)을 import 하지 않고, 필요하면 넘겨받은 `app` 객체의 메서드를 부름.

## 주의할 점

- 위젯 창 이동(`_drag_start/_drag_move`)과 할 일 순서 드래그(`_rdrag_*`)는 이름이 비슷하니 섞지 않기.
- 화면 배율(200% 등)에 맞춘 픽셀은 `app._s(값)` 으로 계산.
- `build.ps1` 은 BOM 있는 UTF-8 로 저장해야 Windows PowerShell 5.1 에서 한글이 안 깨짐.
