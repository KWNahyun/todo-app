"""경로 · 색 · 글꼴 · 기능 목록 같은 상수."""
import os
from pathlib import Path


DATA_FILE = Path(os.environ.get("DAILY_TODO_DATA")
                 or Path(os.environ.get("APPDATA", Path.home())) / "DailyTodo" / "tasks.json")


SETTINGS_FILE = DATA_FILE.with_name("settings.json")


JOURNAL_FILE = DATA_FILE.with_name("journal.json")


DEADLINE_FILE = DATA_FILE.with_name("deadlines.json")


MOOD_FILE = DATA_FILE.with_name("moods.json")      # {"YYYY-MM-DD": 1~5}


HABIT_FILE = DATA_FILE.with_name("habits.json")    # {"habits": [{id, name}], "log": {"YYYY-MM-DD": [id]}}


GOAL_FILE = DATA_FILE.with_name("goals.json")      # [{id, title, target_hours, titles}]


EVENT_FILE = DATA_FILE.with_name("events.json")    # {"YYYY-MM-DD": [{id, time "HH:MM", title, reminded}]}


MANDALA_FILE = DATA_FILE.with_name("mandalart.json")  # {center, subs[8], actions[8][8], done[8][8]}
# 기록장의 목록형 모음: {"bucket": [{id, title, tags, done, done_on, note, created}], ...}
COLLECTIONS_FILE = DATA_FILE.with_name("collections.json")


BACKUP_DIR = DATA_FILE.parent / "backups"  # 하루 한 번 자동: YYYY-MM-DD.zip (최근 14개 보관)


BACKUP_KEEP_DAILY, BACKUP_KEEP_OTHER = 14, 10


MOODS = [(1, "힘듦", "#bf4a30"), (2, "지침", "#d9844a"), (3, "보통", "#c9a13a"),
         (4, "좋음", "#6aa35f"), (5, "최고", "#3f7a4a")]


HOTKEY_ACTIONS = [("show", "위젯 불러오기 + 바로 입력"), ("timer", "마지막 타이머 시작/정지"),
                  ("review", "오늘 정리하기")]


# RegisterHotKey 수식키: Alt=1, Ctrl=2, Shift=4, Win=8
DEFAULT_HOTKEYS = {"show": {"mods": 3, "vk": 0x54, "label": "Ctrl+Alt+T"},
                   "timer": {"mods": 3, "vk": 0x53, "label": "Ctrl+Alt+S"},
                   "review": {"mods": 3, "vk": 0x52, "label": "Ctrl+Alt+R"}}


SECTIONS = [("events", "일정 (오늘 타임라인)"), ("deadlines", "마감 (디데이)"), ("goals", "큰 목표")]


# 켜고 끌 수 있는 기능 (끄면 메뉴·화면에서 사라지고, 기록은 그대로 남음)
FEATURES = [
    ("events", "일정 · 일정표", "'13:30 회의' 입력, 오늘 타임라인, 일정 알림, 일정표 창"),
    ("deadlines", "마감 (디데이)", "디데이 줄, 묶음 옆 D-배지, 달력의 빨간 점"),
    ("goals", "큰 목표", "누적 시간 목표, 목표에 연결"),
    ("habits", "습관 트래커", "일기 위 습관 칩, 연속 일수"),
    ("mood", "기분 기록", "일기 옆 표정 5단계"),
    ("review", "오늘 정리하기", "저녁 회고 카드와 정리 알림"),
    ("stats", "주간 통계", "날짜별 시간 그래프, 습관 표"),
    ("pomodoro", "뽀모도로", "25분 집중 · 5분 휴식"),
    ("mandala", "만다라트", "9x9 목표 계획표"),
    ("bucket", "버킷리스트", "기록장의 '언젠가 해 보고 싶은 것' 목록"),
]


POMO_DEFAULTS = {"pomo_focus": 25, "pomo_break": 5, "pomo_long": 15, "pomo_every": 4}


FONT = "Malgun Gothic"


MONO = "Consolas"


# 우드 & 포레스트 테마: 밝은 베이지(원목) 바탕 + 진한 숲 초록 글자 + 햇살(앰버) = 진행 중
C = {
    "bar": "#e6d6b8", "bg": "#f3e9d6", "card": "#fbf6ec", "border": "#dfcca8",
    "running": "#fcefd0", "text": "#1f3d2b", "muted": "#557060", "faint": "#8f9c88",
    "moss": "#3f7a4a", "moss_hi": "#4d8f59", "ink": "#fbf6ec",       # ink = 초록 위 글자
    "sun": "#e0a33a", "sun_hi": "#eab458", "sun_text": "#a0620c", "on_sun": "#3a2a08",
    "btn": "#eadfc8", "btn_hi": "#e0d1b2", "danger": "#bf4a30", "danger_bg": "#f3d9cf",
    "guide": "#b9ccaa",  # 하위 할 일 왼쪽 가이드선
    "moss_bg": "#dde8d3", "done_bg": "#e8f0df",  # 만다라트 세부 목표 / 완료 칸
}


DAY_HEADS = "일월화수목금토"


WEEKDAYS = "월화수목금토일"


PLACEHOLDER = "할 일 + Enter   (13:30 회의 → 일정)"
