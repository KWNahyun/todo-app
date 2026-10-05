"""Daily Todo — 날짜별 할 일 관리 + 할 일마다 개별 스톱워치."""
import calendar
import ctypes
import json
import os
import queue
import re
import sys
import threading
import time
import uuid
import tkinter as tk
from ctypes import wintypes
from datetime import date, datetime, timedelta
from pathlib import Path
from tkinter import messagebox, ttk

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

# '13:30 회의', '오후 1시 30분 회의', '6시 반 저녁' → 일정. '3시간 공부' 처럼 뒤에 글자가 붙으면 할 일.
UNTIMED_RE = re.compile(r"^(?:미정|종일|하루\s*종일)\s+(\S.*)$")  # '미정 KAMP 회의' → 시간 미정 일정
EVENT_RE = re.compile(r"^(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분|(반))?)\s+(\S.*)$")

MOODS = [(1, "힘듦", "#bf4a30"), (2, "지침", "#d9844a"), (3, "보통", "#c9a13a"),
         (4, "좋음", "#6aa35f"), (5, "최고", "#3f7a4a")]
HOTKEY_ACTIONS = [("show", "위젯 불러오기 + 바로 입력"), ("timer", "마지막 타이머 시작/정지"),
                  ("review", "오늘 정리하기")]
# RegisterHotKey 수식키: Alt=1, Ctrl=2, Shift=4, Win=8
DEFAULT_HOTKEYS = {"show": {"mods": 3, "vk": 0x54, "label": "Ctrl+Alt+T"},
                   "timer": {"mods": 3, "vk": 0x53, "label": "Ctrl+Alt+S"},
                   "review": {"mods": 3, "vk": 0x52, "label": "Ctrl+Alt+R"}}
SECTIONS = [("events", "일정 (오늘 타임라인)"), ("deadlines", "마감 (디데이)"), ("goals", "큰 목표")]
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


def dday_text(n):
    return "D-DAY" if n == 0 else f"D-{n}" if n > 0 else f"D+{-n}"


def dday_colors(n):
    """(배경, 글자) — 3일 이내 빨강, 7일 이내 앰버, 그 외 초록, 지난 일정은 회색."""
    if n < 0:
        return C["btn"], C["faint"]
    if n <= 3:
        return C["danger"], C["ink"]
    if n <= 7:
        return C["sun"], C["on_sun"]
    return C["moss"], C["ink"]
WEEKDAYS = "월화수목금토일"
PLACEHOLDER = "할 일 + Enter   (13:30 회의 → 일정)"


def fmt(sec):
    h, r = divmod(int(sec), 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}"


def fmt_hm(sec):
    h, m = divmod(int(sec) // 60, 60)
    return f"{h}시간 {m}분" if h and m else f"{h}시간" if h else f"{m}분"


def new_task(title, note="", estimate=None):
    return {"id": uuid.uuid4().hex, "title": title, "done": False, "elapsed": 0.0, "started_at": None,
            "note": note, "estimate": estimate}


def elapsed(t):
    return t["elapsed"] + (time.time() - t["started_at"] if t["started_at"] else 0)


def children(t, tasks):
    return [c for c in tasks if c.get("parent") == t["id"]]


def total_time(t, tasks):
    """상위 할 일이면 자기 시간 + 하위 시간 합계."""
    return elapsed(t) + sum(elapsed(c) for c in children(t, tasks))


def goal_seconds(goal, data, since=None):
    """목표에 연결된 제목(상위 묶음 또는 일반 할 일)의 시간을 모든 날짜에서 합산."""
    names = set(goal.get("titles") or []) | {goal["title"]}
    total = 0.0
    for key, ts in data.items():
        if since and key < since:
            continue
        by_id = {t["id"]: t for t in ts}
        for t in ts:
            if by_id.get(t.get("parent"), t)["title"] in names:
                total += elapsed(t)
    return total


def fmt_hours(sec):
    h = sec / 3600
    return f"{h:.1f}".rstrip("0").rstrip(".") + "시간" if h < 10 else f"{int(h)}시간"


def draw_face(c, x, y, size, level, color, filled, ink):
    """캔버스에 표정 얼굴을 그림 (컬러 이모지를 못 쓰는 Tk 8.6 대용)."""
    w = max(1.0, size * 0.08)
    c.create_oval(x + w, y + w, x + size - w, y + size - w, fill=color if filled else "",
                  outline=color, width=w)
    fg = ink if filled else color
    r = size * 0.065
    for ex in (0.36, 0.64):
        c.create_oval(x + size * ex - r, y + size * 0.4 - r, x + size * ex + r, y + size * 0.4 + r,
                      fill=fg, outline=fg)
    curve = (level - 3) * 0.09 * size
    my = y + size * 0.66 - curve / 2
    if level == 3:
        c.create_line(x + size * 0.34, my, x + size * 0.66, my, fill=fg, width=w, capstyle="round")
    else:
        c.create_line(x + size * 0.3, my, x + size * 0.5, my + curve * 2, x + size * 0.7, my,
                      fill=fg, width=w, smooth=True, capstyle="round")


def over_estimate(t, secs=None):
    return bool(t.get("estimate")) and (elapsed(t) if secs is None else secs) > t["estimate"] * 60


def start(t):
    if not t["started_at"]:
        t["started_at"] = time.time()


def stop(t):
    if t["started_at"]:
        t["elapsed"] += time.time() - t["started_at"]
        t["started_at"] = None


def parse_event(text):
    """'13:30 회의' → ('13:30', '회의'), '미정 회의'·'종일 MT' → ('', ...) 시간 미정. 일정 형식이 아니면 None."""
    m0 = UNTIMED_RE.match(text.strip())
    if m0:
        return "", m0[1].strip()
    m = EVENT_RE.match(text.strip())
    if not m:
        return None
    ampm, h, mm_colon, mm_bun, half, title = m.groups()
    h, mnt = int(h), int(mm_colon or mm_bun or (30 if half else 0))
    if ampm == "오후" and h < 12:
        h += 12
    elif ampm == "오전" and h == 12:
        h = 0
    elif not ampm and not mm_colon and 1 <= h <= 6:
        h += 12  # '3시 회의'처럼 오전/오후 없이 1~6시는 보통 오후 (13:30 같은 표기는 그대로)
    if h > 23 or mnt > 59:
        return None
    return f"{h:02d}:{mnt:02d}", title.strip()


def event_dt(day, ev):
    """일정 시작 시각. 시간 미정이면 None."""
    if not ev.get("time"):
        return None
    return datetime.combine(day, datetime.strptime(ev["time"], "%H:%M").time())


def fmt_until(delta):
    mins = int(delta.total_seconds() // 60) + 1
    if mins < 60:
        return f"{mins}분 후"
    h, m = divmod(mins, 60)
    return f"{h}시간 {m}분 후" if m else f"{h}시간 후"


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds():
    """마지막 키보드·마우스 입력 후 지난 초."""
    info = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def parse_duration(text):
    """'1:25:00', '1:25'(시:분), '90'(분) → 초. 형식이 틀리면 None."""
    text = text.strip()
    if text.isdigit():
        return int(text) * 60
    m = re.fullmatch(r"(\d+):(\d{1,2})(?::(\d{1,2}))?", text)
    if not m or int(m[2]) > 59 or (m[3] and int(m[3]) > 59):
        return None
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3] or 0)


def normalize_mandala(d):
    """저장 파일이 없거나 모양이 어긋나도 9x9 구조를 보장."""
    d = d or {}
    subs = (list(d.get("subs") or []) + [""] * 8)[:8]
    actions = [(list(row) + [""] * 8)[:8] for row in (list(d.get("actions") or []) + [[]] * 8)[:8]]
    done = [[bool(x) for x in (list(row) + [False] * 8)[:8]] for row in (list(d.get("done") or []) + [[]] * 8)[:8]]
    return {"center": d.get("center", ""), "subs": subs, "actions": actions, "done": done}


def work_area(win):
    """작업 표시줄을 뺀 화면 영역 (left, top, right, bottom)."""
    try:
        rect = wintypes.RECT()
        ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(rect), 0)
        return rect.left, rect.top, rect.right, rect.bottom
    except Exception:
        return 0, 0, win.winfo_screenwidth(), win.winfo_screenheight()


def colorref(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return ctypes.c_int(r | g << 8 | b << 16)


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        # 깨진 파일은 덮어쓰지 않고 따로 보관
        path.replace(path.with_suffix(f".corrupt-{int(time.time())}.json"))
        return {}


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


class Store:
    """{"YYYY-MM-DD": [task, ...]} 형태로 JSON 파일에 저장."""

    def __init__(self, path):
        self.path = path
        self.data = load_json(path)

    def tasks(self, day):
        return self.data.setdefault(day.isoformat(), [])

    def all_tasks(self):
        return [t for ts in self.data.values() for t in ts]

    def save(self):
        save_json(self.path, {k: v for k, v in sorted(self.data.items()) if v})

    def split_at_midnight(self, today):
        """자정을 넘긴 타이머는 그날 몫까지만 기록하고, 다음 날 같은 할 일로 이어서 측정."""
        changed = False
        while True:
            found = None
            for key in sorted(k for k in self.data if k < today.isoformat()):
                nxt = date.fromisoformat(key) + timedelta(days=1)
                boundary = datetime.combine(nxt, datetime.min.time()).timestamp()
                t = next((t for t in self.data[key] if t["started_at"] and t["started_at"] < boundary), None)
                if t:
                    found = (t, key, nxt, boundary)
                    break
            if not found:
                return changed
            t, key, nxt, boundary = found
            t["elapsed"] += boundary - t["started_at"]
            t["started_at"] = None
            cont = self.copy_task(t, self.data[key], self.tasks(nxt))
            cont["done"] = False
            if not cont["started_at"]:
                cont["started_at"] = boundary
            changed = True

    def copy_task(self, t, src, dst):
        """src 목록의 t에 대응하는 할 일을 dst 목록에서 찾거나 만든다. 하위 할 일이면 상위도 함께."""
        parent_id = None
        p = next((x for x in src if x["id"] == t.get("parent")), None)
        if p:
            parent_id = self.copy_task(p, src, dst)["id"]
        found = next((x for x in dst if x["title"] == t["title"] and x.get("parent") == parent_id), None)
        if found:
            return found
        c = new_task(t["title"], t.get("note", ""), t.get("estimate"))
        c["parent"] = parent_id
        if t.get("mandala"):  # 만다라트에서 온 할 일은 연결 유지
            c["mandala"] = t["mandala"]
        dst.append(c)
        return c


class App(tk.Tk):
    WINDOW_MIN = (440, 480)
    WIDGET_MIN = (340, 360)

    def __init__(self):
        super().__init__()
        self.title("Daily Todo")
        try:  # 창·작업 표시줄 아이콘 (다른 창들도 이 아이콘을 물려받음)
            self.iconbitmap(default=resource("icon.ico"))
        except tk.TclError:
            pass
        self.geometry("560x680")
        self.configure(bg=C["bg"])
        self.px = self.winfo_fpixels("1i") / 96  # 고DPI 배율 (캔버스 크기 보정용)

        self.store = Store(DATA_FILE)
        self.journal = load_json(JOURNAL_FILE)
        self.deadlines = load_json(DEADLINE_FILE) or []  # [{id, title, date, group}]
        self.moods = load_json(MOOD_FILE)
        self.habits = load_json(HABIT_FILE) or {}
        self.habits.setdefault("habits", [])
        self.habits.setdefault("log", {})
        self.goals = load_json(GOAL_FILE) or []
        self.events = load_json(EVENT_FILE)
        self.mandala = normalize_mandala(load_json(MANDALA_FILE))
        self.mandala_win = None
        self._event_minute = None
        self.pomo = None  # {"tid", "phase": focus/break/ready, "ends", "count"}
        self.toast = None
        self.hotkeys = None
        self.cal_popup = None
        self.today = date.today()
        self.day = self.today
        self.time_labels = {}  # task id -> Label
        self.settings = load_json(SETTINGS_FILE)
        self.widget_mode = None  # apply_mode 전까지 미정
        self._dialog_open = False
        self._ph_on = False
        self._diary_day = None
        self._diary_job = None
        self.stats_win = None

        # 한 번만: 예전 기본 크기로 저장된 위젯을 세로로 꽉 차게 (가로 위치는 유지)
        if not self.settings.get("tall_widget"):
            m = re.fullmatch(r"\d+x\d+\+(-?\d+)\+-?\d+", self.settings.get("geom_widget") or "")
            self.settings["geom_widget"] = self._tall_widget_geom(int(m[1]) if m else None)
            self.settings["tall_widget"] = True
        # 앱이 닫히지 않고 꺼졌는데(재부팅·강제 종료) 타이머가 켜져 있었다면: 먼저 물어본 뒤 날짜 분할
        self._last_tick = time.time()
        self._idle_since = None
        self._away_open = False
        self._long_notified = {}
        heartbeat = self.settings.get("heartbeat")
        crashed = bool(heartbeat and time.time() - heartbeat > 180 and any(
            t["started_at"] for t in self.store.all_tasks()))
        self._pending_away = crashed
        if not crashed and self.store.split_at_midnight(self.today):
            self.store.save()
        self._style()
        self._build()
        self.render()
        self._load_diary()
        self.apply_mode(self.settings.get("widget", False))
        if crashed:
            self.after(600, lambda: self._ask_away(heartbeat, "앱이 꺼져 있던 동안"))
        self._tick()
        self.register_hotkeys(startup=True)
        self._poll_hotkeys()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        # 위젯(바탕화면 고정) 모드에서 다른 곳을 클릭하면 다시 맨 뒤로
        self.bind("<FocusOut>", lambda e: self.after(150, self._back_if_unfocused))

    # ---------- settings / widget mode ----------
    def _save_settings(self):
        self.update_idletasks()
        if self.widget_mode is not None and self.winfo_width() > 1:  # 창이 그려지기 전엔 1x1
            self.settings["geom_widget" if self.widget_mode else "geom_window"] = self.geometry()
        save_json(SETTINGS_FILE, self.settings)

    def _s(self, v):
        """96dpi 기준 크기를 현재 화면 배율에 맞춘 픽셀로."""
        return int(v * self.px)

    def _fit(self, geom, min_size, default):
        # 저장된 크기가 최소 크기보다 작으면(예: 배율 변경) 기본값 사용
        m = re.fullmatch(r"(\d+)x(\d+)([+-]-?\d+)?([+-]-?\d+)?", geom or "")
        if not m or int(m[1]) < self._s(min_size[0]) or int(m[2]) < self._s(min_size[1]):
            return default
        return geom

    def _apply_icon(self, win=None):
        """Tk 는 32px 아이콘 하나만 써서 고배율 작업 표시줄에서 흐려짐 → 배율에 맞는 크기를 직접 지정."""
        try:
            u32 = ctypes.windll.user32
            u32.LoadImageW.restype = wintypes.HANDLE
            u32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT,
                                       ctypes.c_int, ctypes.c_int, wintypes.UINT]
            u32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
            hwnd = u32.GetParent((win or self).winfo_id())
            if not hasattr(self, "_icon_handles"):
                self._icon_handles = {}
                for which, metric in ((1, 11), (0, 49)):  # ICON_BIG·SM_CXICON / ICON_SMALL·SM_CXSMICON
                    size = u32.GetSystemMetrics(metric)
                    # LR_LOADFROMFILE: .ico 안에서 이 크기에 가장 맞는 이미지를 고름
                    self._icon_handles[which] = u32.LoadImageW(None, resource("icon.ico"), 1, size, size, 0x10)
            for which, handle in self._icon_handles.items():
                if handle:
                    u32.SendMessageW(hwnd, 0x0080, which, handle)  # WM_SETICON
        except Exception:
            pass

    def _window_chrome(self, win=None):
        # Windows 11: 제목 표시줄을 테마 색으로, 모서리는 둥글게
        win = win or self
        self._apply_icon(win)
        try:
            hwnd = ctypes.windll.user32.GetParent(win.winfo_id())
            for attr, value in ((20, ctypes.c_int(0)), (35, colorref(C["bar"])),
                                (34, colorref(C["border"])), (33, ctypes.c_int(2))):
                ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(value),
                                                           ctypes.sizeof(value))
        except Exception:
            pass

    def _tall_widget_geom(self, x=None):
        """기본 위젯: 화면 오른쪽, 위아래 여백만 두고 세로로 꽉 차게."""
        left, top, right, bottom = work_area(self)
        margin = self._s(20)
        x = right - self._s(430) if x is None else x
        return f"{self._s(400)}x{bottom - top - 2 * margin}+{x}+{top + margin}"

    def apply_mode(self, widget):
        if self.widget_mode is not None:
            self._save_settings()  # 이전 모드의 위치/크기 기억
        self.widget_mode = widget
        self.settings["widget"] = widget
        self.withdraw()
        self.overrideredirect(widget)  # 테두리·작업표시줄 아이콘 없음
        if widget:
            self.topbar.pack(fill="x", before=self.header)
            self.mode_btn.pack_forget()
            self.grip.pack(side="right", padx=(6, 0), before=self.stats_btn)
            self.attributes("-alpha", 0.98)  # 밝은 바탕은 뒤가 비치면 글씨가 흐려져서 거의 불투명
            geom = self._fit(self.settings.get("geom_widget"), self.WIDGET_MIN, self._tall_widget_geom())
        else:
            self.topbar.pack_forget()
            self.grip.pack_forget()
            self.mode_btn.pack(side="right", padx=(6, 0))
            self.attributes("-alpha", 1.0)
            geom = self._fit(self.settings.get("geom_window"), self.WINDOW_MIN,
                             f"{self._s(560)}x{self._s(720)}")
        self.minsize(*(self._s(v) for v in (self.WIDGET_MIN if widget else self.WINDOW_MIN)))
        self.geometry(geom)
        self.deiconify()
        self.update_idletasks()
        self._window_chrome()
        self.apply_pin()
        self._save_settings()

    def apply_pin(self):
        pin = self.settings.get("pin", "desktop")
        self.attributes("-topmost", bool(self.widget_mode and pin == "top"))
        self.pin_btn.config(text="◆ 바탕화면 고정" if pin == "desktop" else "▲ 항상 위")
        if self.widget_mode and pin == "desktop":
            self.after(100, self.send_to_back)

    def toggle_pin(self):
        self.settings["pin"] = "top" if self.settings.get("pin", "desktop") == "desktop" else "desktop"
        self.apply_pin()
        self._save_settings()

    def send_to_back(self):
        if not (self.widget_mode and self.settings.get("pin", "desktop") == "desktop") or self._dialog_open:
            return
        try:
            # HWND_BOTTOM, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
            ctypes.windll.user32.SetWindowPos(ctypes.windll.user32.GetParent(self.winfo_id()),
                                              1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        except Exception:
            pass

    def _back_if_unfocused(self):
        try:
            focused = self.focus_get()
        except KeyError:  # 네이티브 대화상자에 포커스가 있는 경우
            focused = True
        if focused is None:
            self.send_to_back()

    def _dialog(self, fn, *args, **kw):
        self._dialog_open = True
        try:
            return fn(*args, parent=self, **kw)
        finally:
            self._dialog_open = False

    def _drag_start(self, e):
        self._drag = (e.x_root - self.winfo_x(), e.y_root - self.winfo_y())

    def _drag_move(self, e):
        self.geometry(f"+{e.x_root - self._drag[0]}+{e.y_root - self._drag[1]}")

    def _resize_start(self, e):
        self._rs = (e.x_root, e.y_root, self.winfo_width(), self.winfo_height())

    def _resize_move(self, e):
        x0, y0, w0, h0 = self._rs
        mw, mh = (self._s(v) for v in self.WIDGET_MIN)
        self.geometry(f"{max(mw, w0 + e.x_root - x0)}x{max(mh, h0 + e.y_root - y0)}")

    # ---------- widgets ----------
    def _style(self):
        st = ttk.Style(self)
        st.theme_use("clam")
        st.configure("Forest.Vertical.TScrollbar", background=C["btn"], troughcolor=C["bg"],
                     bordercolor=C["bg"], lightcolor=C["btn"], darkcolor=C["btn"],
                     arrowcolor=C["muted"], gripcount=0, arrowsize=self._s(10))
        st.map("Forest.Vertical.TScrollbar", background=[("active", C["btn_hi"])])

    def _button(self, parent, text, cmd, hover=None, **kw):
        opts = dict(bg=C["btn"], fg=C["text"], activebackground=C["btn_hi"], activeforeground=C["text"],
                    disabledforeground=C["faint"], relief="flat", bd=0, padx=10, pady=4,
                    font=(FONT, 10), cursor="hand2", highlightthickness=0)
        opts.update(kw)
        b = tk.Button(parent, text=text, command=cmd, **opts)
        base, hi = opts["bg"], hover or opts["activebackground"]
        b.bind("<Enter>", lambda e: b["state"] != "disabled" and b.config(bg=hi))
        b.bind("<Leave>", lambda e: b.config(bg=base))
        return b

    def _field(self, parent, cls=tk.Entry, **kw):
        opts = dict(font=(FONT, 11), relief="flat", bd=0, bg=C["card"], fg=C["text"],
                    insertbackground=C["moss"], selectbackground=C["moss"], selectforeground=C["ink"],
                    highlightthickness=1, highlightbackground=C["border"], highlightcolor=C["moss"])
        opts.update(kw)
        return cls(parent, **opts)

    # ---------- layout ----------
    def _build(self):
        # 위젯 모드 전용 상단 바 (드래그로 이동)
        self.topbar = tk.Frame(self, bg=C["bar"])
        handle = tk.Label(self.topbar, text="❦  Daily Todo", font=(FONT, 9, "bold"),
                          bg=C["bar"], fg=C["moss"], padx=12, pady=6, cursor="fleur", anchor="w")
        handle.pack(side="left", fill="x", expand=True, anchor="w")
        for w in (self.topbar, handle):
            w.bind("<Button-1>", self._drag_start)
            w.bind("<B1-Motion>", self._drag_move)
        bar_btn = dict(bg=C["bar"], fg=C["muted"], font=(FONT, 9), pady=4, padx=9)
        self._button(self.topbar, "✕", self.on_close, hover=C["danger_bg"], **bar_btn).pack(side="right")
        self._button(self.topbar, "창 모드", lambda: self.apply_mode(False), **bar_btn).pack(side="right")
        self.pin_btn = self._button(self.topbar, "", self.toggle_pin, **bar_btn)
        self.pin_btn.pack(side="right")

        self.header = header = tk.Frame(self, bg=C["bg"], pady=14)
        header.pack(fill="x", padx=16)
        nav = dict(bg=C["bg"], fg=C["muted"], hover=C["btn"], padx=10, pady=0, font=(FONT, 18))
        self._button(header, "‹", lambda: self.go(-1), **nav).pack(side="left")
        self.date_lbl = tk.Label(header, font=(FONT, 16, "bold"), bg=C["bg"], fg=C["text"], cursor="hand2")
        self.date_lbl.pack(side="left", expand=True)
        self.date_lbl.bind("<Button-1>", lambda e: self.open_calendar())
        self.menu_btn = self._button(header, "⋯", self._show_menu, font=(FONT, 10, "bold"), padx=8)
        self.menu_btn.pack(side="right", padx=(6, 0))
        self._button(header, "오늘", lambda: self.go(0), font=(FONT, 9)).pack(side="right")
        self._button(header, "›", lambda: self.go(1), **nav).pack(side="right", padx=(0, 4))

        self.single_var = tk.BooleanVar(value=self.settings.get("single_timer", True))
        self.menu_style = dict(bg=C["card"], fg=C["text"], activebackground=C["btn_hi"],
                               activeforeground=C["text"], selectcolor=C["moss"], font=(FONT, 10), bd=0)
        self.pomo_var = tk.BooleanVar(value=self.settings.get("pomo_on", False))
        self.menu = tk.Menu(self, tearoff=0, **self.menu_style)
        self.menu.add_command(label="오늘 정리하기", command=self.open_review)
        self.menu.add_command(label="주간 통계", command=self.open_stats)
        self.menu.add_separator()
        self.menu.add_command(label="일정표 (주 · 2주 · 한 달)", command=self.open_schedule)
        self.menu.add_command(label="만다라트", command=self.open_mandala)
        self.menu.add_command(label="큰 목표", command=self.open_goals)
        self.menu.add_command(label="마감 일정 (디데이)", command=self.open_deadlines)
        self.menu.add_command(label="습관 관리", command=self.open_habits)
        self.menu.add_command(label="이전 미완료 가져오기", command=self.carry_over)
        self.menu.add_separator()
        self.menu.add_checkbutton(label="뽀모도로 모드", variable=self.pomo_var, command=self._set_pomo)
        self.menu.add_checkbutton(label="타이머는 한 번에 하나만", variable=self.single_var,
                                  command=self._set_single)
        self.section_vars = {}
        top_menu = tk.Menu(self.menu, tearoff=0, **self.menu_style)
        for name, label in SECTIONS:
            self.section_vars[name] = tk.BooleanVar(value=self.section_cfg(name)["show"])
            top_menu.add_checkbutton(label=label, variable=self.section_vars[name],
                                     command=lambda n=name: self.set_section_shown(n, self.section_vars[n].get()))
        self.menu.add_cascade(label="상단에 표시", menu=top_menu)
        self.menu.add_separator()
        self.menu.add_command(label="설정 (단축키 · 뽀모도로 · 알림)", command=self.open_settings)

        # 상단: [일정][마감][목표] 버튼 줄 + 펼친 항목 (설정에서 항목별로 숨길 수 있음)
        self.top_box = tk.Frame(self, bg=C["bg"])
        self.top_box.pack(fill="x", padx=16, pady=(0, 4))
        self.chip_bar = tk.Frame(self.top_box, bg=C["bg"])
        self.event_box = tk.Frame(self.top_box, bg=C["bg"])
        self.dday_box = tk.Frame(self.top_box, bg=C["bg"])
        self.goal_box = tk.Frame(self.top_box, bg=C["bg"])

        self.entry_bar = bar = tk.Frame(self, bg=C["bg"])
        bar.pack(fill="x", padx=16, pady=(0, 10))
        self.entry = self._field(bar)
        self.entry.pack(side="left", fill="x", expand=True, ipady=7, ipadx=8)
        self.entry.bind("<Return>", lambda e: self.add())
        self.entry.bind("<FocusIn>", lambda e: self._placeholder(False))
        self.entry.bind("<FocusOut>", lambda e: self._placeholder(True))
        self._button(bar, "추가", self.add, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                     activebackground=C["moss_hi"], activeforeground=C["ink"],
                     font=(FONT, 10, "bold"), padx=14).pack(side="left", padx=(8, 0), fill="y")
        self._placeholder(True)

        # 진행률 막대 (완료 비율)
        self.progress = tk.Canvas(self, height=self._s(4), bg=C["card"], highlightthickness=0)
        self.progress.pack(fill="x", padx=16, pady=(0, 8))
        self.progress.bind("<Configure>", lambda e: self._update_summary())

        # 뽀모도로 진행 표시줄 (진행 중일 때만 보임)
        self.pomo_bar = tk.Frame(self, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])

        # 아래쪽(푸터·일기)을 먼저 pack 해야 창이 작아져도 목록만 줄어듦
        footer = tk.Frame(self, bg=C["bar"], pady=8)
        footer.pack(side="bottom", fill="x")
        self.summary = tk.Label(footer, font=(FONT, 9), bg=C["bar"], fg=C["muted"])
        self.summary.pack(side="left", padx=(16, 0))
        self.grip = tk.Label(footer, text="◢", font=(FONT, 9), bg=C["bar"], fg=C["faint"],
                             cursor="size_nw_se", padx=4)
        self.grip.bind("<Button-1>", self._resize_start)
        self.grip.bind("<B1-Motion>", self._resize_move)
        small = dict(bg=C["btn"], font=(FONT, 9), pady=3)
        self.stats_btn = self._button(footer, "통계", self.open_stats, **small)
        self.stats_btn.pack(side="right", padx=(0, 12))
        self._button(footer, "정리하기", self.open_review, **small).pack(side="right", padx=(0, 6))
        self.mode_btn = self._button(footer, "❦ 위젯", lambda: self.apply_mode(True), **small)

        self._build_diary()

        self.body = body = tk.Frame(self, bg=C["bg"])
        body.pack(fill="both", expand=True, padx=(4, 6))
        self.canvas = tk.Canvas(body, bg=C["bg"], highlightthickness=0)
        sb = ttk.Scrollbar(body, orient="vertical", command=self.canvas.yview,
                           style="Forest.Vertical.TScrollbar")
        self.canvas.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner = tk.Frame(self.canvas, bg=C["bg"])
        win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(win, width=e.width))
        self.bind_all("<MouseWheel>", self._on_wheel)

    def _build_diary(self):
        self.diary = tk.Frame(self, bg=C["bg"])
        self.diary.pack(side="bottom", fill="x", padx=16, pady=(4, 10))
        head = tk.Frame(self.diary, bg=C["bg"])
        head.pack(fill="x")
        self.diary_head = tk.Label(head, font=(FONT, 10, "bold"), bg=C["bg"], fg=C["moss"],
                                   cursor="hand2", anchor="w")
        self.diary_head.pack(side="left")
        self.diary_head.bind("<Button-1>", lambda e: self._toggle_diary())
        self.mood_picker = MoodPicker(head, self, lambda: self.day, bg=C["bg"])
        self.mood_picker.pack(side="right")
        self.diary_status = tk.Label(head, font=(FONT, 8), bg=C["bg"], fg=C["faint"])
        self.diary_status.pack(side="left", padx=8)
        self.habit_bar = HabitBar(self.diary, self, lambda: self.day)
        self.diary_text = self._field(self.diary, tk.Text, height=4, wrap="word", font=(FONT, 10),
                                      padx=10, pady=8, undo=True)
        self.diary_text.bind("<<Modified>>", self._diary_changed)
        self._show_diary(self.settings.get("diary_open", True))

    def _show_diary(self, show):
        self.settings["diary_open"] = show
        if show:
            self.habit_bar.pack(fill="x", pady=(6, 0))
            self.diary_text.pack(fill="x", pady=(6, 0))
        else:
            self.habit_bar.pack_forget()
            self.diary_text.pack_forget()
        self._update_diary_head()

    def set_journal(self, iso, text):
        """다른 창(오늘 정리하기)에서 일기를 바꿨을 때: 저장하고 화면에도 반영."""
        if text:
            self.journal[iso] = text
        else:
            self.journal.pop(iso, None)
        save_json(JOURNAL_FILE, dict(sorted(self.journal.items())))
        if self._diary_day == iso:
            self.diary_text.delete("1.0", "end")
            self.diary_text.insert("1.0", text)
            self.diary_text.edit_modified(False)

    def set_mood(self, iso, level):
        if level:
            self.moods[iso] = level
        else:
            self.moods.pop(iso, None)
        save_json(MOOD_FILE, dict(sorted(self.moods.items())))
        self.mood_picker.draw()
        self._redraw_stats()

    def toggle_habit(self, iso, hid):
        done = self.habits["log"].setdefault(iso, [])
        done.remove(hid) if hid in done else done.append(hid)
        if not done:
            del self.habits["log"][iso]
        self.save_habits()

    def habit_streak(self, hid, day):
        """연속 일수. 오늘 아직 안 했으면 어제까지의 연속을 보여 줌."""
        log, d = self.habits["log"], day
        if hid not in log.get(d.isoformat(), []):
            d -= timedelta(days=1)
        n = 0
        while hid in log.get(d.isoformat(), []):
            n += 1
            d -= timedelta(days=1)
        return n

    def save_habits(self):
        save_json(HABIT_FILE, self.habits)
        self.habit_bar.draw()
        self._redraw_stats()

    def _redraw_stats(self):
        if self.stats_win and self.stats_win.winfo_exists():
            self.after_idle(self.stats_win.draw)

    def _toggle_diary(self):
        self._show_diary(not self.settings["diary_open"])
        self._save_settings()

    def _update_diary_head(self):
        arrow = "▾" if self.settings.get("diary_open", True) else "▸"
        label = "오늘의 기록" if self.day == self.today else "이날의 기록"
        self.diary_head.config(text=f"{arrow} {label}")

    def _load_diary(self):
        self._save_diary()
        self._diary_day = self.day.isoformat()
        self.diary_text.delete("1.0", "end")
        self.diary_text.insert("1.0", self.journal.get(self._diary_day, ""))
        self.diary_text.edit_reset()
        self.diary_text.edit_modified(False)
        self.diary_status.config(text="")
        self._update_diary_head()
        self.mood_picker.draw()
        self.habit_bar.draw()

    def _diary_changed(self, _e):
        if not self.diary_text.edit_modified():
            return
        self.diary_text.edit_modified(False)
        self.diary_status.config(text="입력 중…")
        if self._diary_job:
            self.after_cancel(self._diary_job)
        self._diary_job = self.after(800, self._save_diary)

    def _save_diary(self):
        if self._diary_job:
            self.after_cancel(self._diary_job)
            self._diary_job = None
        if self._diary_day is None:
            return
        text = self.diary_text.get("1.0", "end-1c").rstrip()
        if text == self.journal.get(self._diary_day, ""):
            return
        if text:
            self.journal[self._diary_day] = text
        else:
            self.journal.pop(self._diary_day, None)
        save_json(JOURNAL_FILE, dict(sorted(self.journal.items())))
        self.diary_status.config(text="저장됨")

    def _on_wheel(self, e):
        w = e.widget
        if not isinstance(w, tk.Misc) or isinstance(w, tk.Text) or w.winfo_toplevel() is not self:
            return  # 일기 입력칸·다른 창은 각자 스크롤
        self.canvas.yview_scroll(int(-e.delta / 120), "units")

    def _show_menu(self):
        b = self.menu_btn
        self.menu.tk_popup(b.winfo_rootx(), b.winfo_rooty() + b.winfo_height())

    def _set_single(self):
        self.settings["single_timer"] = self.single_var.get()
        self._save_settings()

    def _set_pomo(self):
        self.settings["pomo_on"] = self.pomo_var.get()
        if not self.pomo_var.get():
            self.pomo_end()
        self._save_settings()

    def _placeholder(self, show):
        if show and not self.entry.get():
            self.entry.insert(0, PLACEHOLDER)
            self.entry.config(fg=C["faint"])
            self._ph_on = True
        elif not show and self._ph_on:
            self.entry.delete(0, "end")
            self.entry.config(fg=C["text"])
            self._ph_on = False

    # ---------- rendering ----------
    def render(self):
        for w in self.inner.winfo_children():
            w.destroy()
        self.time_labels.clear()

        wd = WEEKDAYS[self.day.weekday()]
        self.date_lbl.config(text=f"{self.day:%m월 %d일} {wd}요일",
                             fg=C["moss"] if self.day == self.today else C["text"])

        tasks = self.store.tasks(self.day)
        if not tasks:
            tk.Label(self.inner, text="❦\n\n오늘 할 일을 심어 보세요\n"
                                      "제목을 클릭하면 메모·예상 시간 · 우클릭하면 묶기 · 길게 눌러 끌면 순서 변경\n"
                                      "'상위 > 하위'로 적으면 하위 할 일, '13:30 회의'는 일정",
                     font=(FONT, 10), bg=C["bg"], fg=C["faint"], pady=40, justify="center").pack()
        ids = {t["id"] for t in tasks}
        tops = [t for t in tasks if t.get("parent") not in ids]  # 상위가 사라진 하위는 일반 할 일로
        for t in tops:
            kids = children(t, tasks)
            if kids:  # 상위 할 일은 하위가 모두 끝나면 완료
                t["done"] = all(c["done"] for c in kids)
        # 미완료 먼저, 완료는 아래로 (같은 상태끼리는 목록 순서 = 드래그로 정한 순서)
        self._rows, self._block_end = {}, {}
        drag_targets = []  # (task, row, 클릭 영역, 같이 움직이는 형제들)
        tops_sorted = sorted(tops, key=lambda t: t["done"])
        for t in tops_sorted:
            sibs = [x for x in tops_sorted if x["done"] == t["done"]]
            kids = children(t, tasks)
            if not kids:
                row, col = self._row(t)
                drag_targets.append((t, row, col, sibs))
                continue
            row, col = self._group_row(t, kids, tasks)
            drag_targets.append((t, row, col, sibs))
            if not t.get("collapsed"):
                kids_sorted = sorted(kids, key=lambda c: c["done"])
                for c in kids_sorted:
                    crow, ccol = self._row(c, child=True)
                    drag_targets.append((c, crow, ccol, [x for x in kids_sorted if x["done"] == c["done"]]))
                    self._block_end[t["id"]] = crow  # 묶음은 마지막 하위 줄까지가 한 덩어리
        for t, row, col, sibs in drag_targets:
            self._make_draggable(t, row, col, sibs)
        self._update_summary()
        self.render_top()

    # ---------- 상단 (일정 · 마감 · 목표) ----------
    def section_cfg(self, name):
        return self.settings.setdefault("sections", {}).setdefault(name, {"show": True, "open": True})

    def toggle_section(self, name):
        cfg = self.section_cfg(name)
        cfg["open"] = not cfg["open"]
        self._save_settings()
        self.render_top()

    def set_section_shown(self, name, shown):
        self.section_cfg(name)["show"] = shown
        self.section_vars[name].set(shown)
        self._save_settings()
        self.render_top()

    def _chip(self, name, label, info=None, info_fg=None, info_bg=None):
        """접기/펼치기 버튼: '▸ 마감 2 [D-2]'."""
        is_open = self.section_cfg(name)["open"]
        bg = C["btn_hi"] if is_open else C["btn"]
        chip = tk.Frame(self.chip_bar, bg=bg, cursor="hand2")
        chip.pack(side="left", padx=(0, 6))
        tk.Label(chip, text=("▾ " if is_open else "▸ ") + label, font=(FONT, 9, "bold" if is_open else "normal"),
                 bg=bg, fg=C["text"], padx=8, pady=3, cursor="hand2").pack(side="left")
        if info:
            tk.Label(chip, text=info, font=(FONT, 8, "bold"), bg=info_bg or bg, fg=info_fg or C["muted"],
                     padx=5, cursor="hand2").pack(side="left", padx=(0, 6), pady=3, fill="y")
        self._bind_tree(chip, "<Button-1>", lambda e: self.toggle_section(name))

    def _add_link(self, parent, text, cmd, side="left"):
        link = tk.Label(parent, text=text, font=(FONT, 9), bg=C["bg"], fg=C["muted"], cursor="hand2")
        link.pack(side=side, padx=(0, 8) if side == "left" else (8, 0))
        link.bind("<Button-1>", lambda e: cmd())

    def render_top(self):
        for box in (self.chip_bar, self.event_box, self.dday_box, self.goal_box):
            for w in box.winfo_children():
                w.destroy()
            box.pack_forget()
        cfg = {n: self.section_cfg(n) for n, _ in SECTIONS}
        now = datetime.now()
        is_today = self.day == self.today
        evs = sorted(self.events.get(self.day.isoformat(), []), key=lambda e: e["time"])
        upcoming = sorted((d for d in self.deadlines if d["date"] >= self.today.isoformat()),
                          key=lambda d: d["date"])

        # 버튼 줄: 접혀 있어도 다음 일정 시간 / 가장 가까운 마감은 보이게
        if cfg["events"]["show"] and evs:
            nxt = next((e for e in evs if e["time"] and event_dt(self.day, e) >= now), None) if is_today else None
            self._chip("events", f"일정 {len(evs)}", nxt["time"] if nxt else None, C["moss"])
        if cfg["deadlines"]["show"]:
            if upcoming:
                n = (date.fromisoformat(upcoming[0]["date"]) - self.today).days
                bg, fg = dday_colors(n)
                self._chip("deadlines", f"마감 {len(upcoming)}", dday_text(n), fg, bg)
            else:
                self._add_link(self.chip_bar, "+ 마감", self.open_deadlines)
        if cfg["goals"]["show"]:
            if self.goals:
                self._chip("goals", f"목표 {len(self.goals)}")
            else:
                self._add_link(self.chip_bar, "+ 목표", self.open_goals)
        # 오른쪽 끝: 주·2주·한 달 일정을 한 번에 보는 일정표
        self._add_link(self.chip_bar, "일정표 ›", self.open_schedule, side="right")
        self.chip_bar.pack(fill="x", pady=(0, 6))

        if cfg["events"]["show"] and cfg["events"]["open"] and evs:
            self.event_box.pack(fill="x", pady=(0, 4))
            self._render_event_rows(evs, now, is_today)
        if cfg["deadlines"]["show"] and cfg["deadlines"]["open"] and upcoming:
            self.dday_box.pack(fill="x", pady=(0, 4))
            self._render_deadline_rows(upcoming)
        if cfg["goals"]["show"] and cfg["goals"]["open"] and self.goals:
            self.goal_box.pack(fill="x", pady=(0, 4))
            self._render_goal_rows()

    render_events = render_ddays = render_top  # 일정/마감/목표가 바뀌면 상단 전체를 다시 그림

    def _render_event_rows(self, evs, now, is_today):
        box = self.event_box
        upcoming = [e for e in evs if e["time"] and event_dt(self.day, e) >= now] if is_today else []
        nxt = upcoming[0] if upcoming else None
        for ev in evs:
            dt = event_dt(self.day, ev)  # 시간 미정이면 None — 오늘 안에서는 '지난 일정'으로 흐리지 않음
            past = self.day < self.today or (is_today and dt is not None and dt < now)
            is_next = ev is nxt
            row = tk.Frame(box, bg=C["card"], highlightthickness=1,
                           highlightbackground=C["moss"] if is_next else C["border"], cursor="hand2")
            row.pack(fill="x", pady=(0, 3))
            tk.Frame(row, bg=C["moss"] if is_next else C["card"], width=self._s(3)).pack(side="left", fill="y")
            if ev["time"]:
                tk.Label(row, text=ev["time"], font=(MONO, 11, "bold"), bg=C["card"], width=6,
                         fg=C["moss"] if is_next else C["faint"] if past else C["text"]).pack(side="left", pady=4)
            else:
                tk.Label(row, text="미정", font=(FONT, 9, "bold"), bg=C["card"], width=7,
                         fg=C["faint"] if past else C["muted"]).pack(side="left", pady=4)
            self._button(row, "✕", lambda ev=ev: self.delete_event(self.day, ev), bg=C["card"], fg=C["faint"],
                         hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
            if is_today and not past and dt is not None:
                tk.Label(row, text=fmt_until(dt - now), font=(FONT, 9, "bold" if is_next else "normal"),
                         bg=C["card"], fg=C["moss"] if is_next else C["muted"]).pack(side="right", padx=6)
            title = tk.Label(row, text=ev["title"], anchor="w", bg=C["card"], cursor="hand2",
                             font=(FONT, 10, "bold" if is_next else "normal"),
                             fg=C["faint"] if past else C["text"])
            title.pack(side="left", fill="x", expand=True, padx=(4, 0))
            for w in (row, title):
                w.bind("<Button-1>", lambda e, ev=ev: self.edit_event(self.day, ev))

    def save_events(self):
        save_json(EVENT_FILE, {k: v for k, v in sorted(self.events.items()) if v})
        self._redraw_schedule()

    def _redraw_schedule(self):
        win = getattr(self, "schedule_win", None)
        if win and win.winfo_exists():
            self.after_idle(win.draw)

    def open_schedule(self):
        win = getattr(self, "schedule_win", None)
        if win and win.winfo_exists():
            win.deiconify()
            win.lift()
            win.focus_force()
            return
        self.schedule_win = ScheduleWindow(self)

    def add_event(self, day, hhmm, title):
        self.events.setdefault(day.isoformat(), []).append(
            {"id": uuid.uuid4().hex, "time": hhmm, "title": title, "reminded": False})
        self.save_events()
        self.render_events()

    def delete_event(self, day, ev):
        self.events[day.isoformat()].remove(ev)
        self.save_events()
        self.render_events()

    def edit_event(self, day, ev):
        self._open_window("event_win", EventDialog, day, ev)

    def _event_reminders(self):
        # 다음 일정 강조·남은 시간은 분이 바뀔 때마다 다시 그림
        now = datetime.now()
        if now.minute != self._event_minute:
            self._event_minute = now.minute
            self.render_events()
        if not self.settings.get("event_remind_on", True):
            return
        mins = int(self.settings.get("event_remind", 10))
        changed = False
        for ev in self.events.get(self.today.isoformat(), []):
            dt = event_dt(self.today, ev)
            if dt is None:  # 시간 미정은 알림 없음
                continue
            if not ev.get("reminded") and dt - timedelta(minutes=mins) <= now < dt:
                ev["reminded"] = True
                changed = True
                self.notify(f"{fmt_until(dt - now)} · {ev['time']} {ev['title']}", "일정 알림")
        if changed:
            self.save_events()

    def _render_deadline_rows(self, upcoming):
        for dl in upcoming[:3]:
            d = date.fromisoformat(dl["date"])
            n = (d - self.today).days
            bg, fg = dday_colors(n)
            sub = None
            status = self._group_status(dl.get("group"))
            if status:
                left, total = status
                if left == 0:
                    sub = f"↳ {dl['group']} · 할 일 모두 완료"
                else:
                    pace = left / max(n, 1)
                    pace_s = f"{pace:.1f}".rstrip("0").rstrip(".")
                    sub = f"↳ {dl['group']} · 남은 {left}/{total}개 · 하루 {pace_s}개"
            self._strip_row(self.dday_box, dday_text(n), bg, fg, dl["title"],
                            f"{d.month}/{d.day} ({WEEKDAYS[d.weekday()]})", sub, self.open_deadlines)
        links = tk.Frame(self.dday_box, bg=C["bg"])
        links.pack(fill="x")
        more = f"{len(upcoming) - 3}개 더 · " if len(upcoming) > 3 else ""
        self._add_link(links, f"{more}마감 관리", self.open_deadlines, side="right")

    def _render_goal_rows(self):
        week_ago = (self.today - timedelta(days=6)).isoformat()
        for g in self.goals[:3]:
            total = goal_seconds(g, self.store.data)
            week = goal_seconds(g, self.store.data, since=week_ago)
            right = f"누적 {fmt_hours(total)}"
            ratio = None
            if g.get("target_hours"):
                right = f"{fmt_hours(total)} / {g['target_hours']}시간"
                ratio = min(1.0, total / 3600 / g["target_hours"])
            self._strip_row(self.goal_box, "목표", C["btn"], C["moss"], g["title"], right,
                            f"최근 7일 {fmt_hours(week)}", self.open_goals, ratio)
        links = tk.Frame(self.goal_box, bg=C["bg"])
        links.pack(fill="x")
        more = f"{len(self.goals) - 3}개 더 · " if len(self.goals) > 3 else ""
        self._add_link(links, f"{more}목표 관리", self.open_goals, side="right")

    def _strip_row(self, parent, badge_text, bg, fg, title, right, sub, on_click, ratio=None):
        row = tk.Frame(parent, bg=C["card"], highlightthickness=1,
                       highlightbackground=C["border"], cursor="hand2")
        row.pack(fill="x", pady=(0, 4))
        tk.Label(row, text=badge_text, width=6, font=(FONT, 9, "bold"), bg=bg, fg=fg,
                 pady=3).pack(side="left", fill="y")
        tk.Label(row, text=right, font=(FONT, 9), bg=C["card"], fg=C["muted"]).pack(side="right", padx=8)
        col = tk.Frame(row, bg=C["card"])
        col.pack(side="left", fill="x", expand=True, padx=8, pady=2)
        tk.Label(col, text=title, anchor="w", font=(FONT, 10), bg=C["card"], fg=C["text"]).pack(fill="x")
        if sub:
            tk.Label(col, text=sub, anchor="w", font=(FONT, 8), bg=C["card"], fg=C["faint"]).pack(fill="x")
        if ratio is not None:
            bar = tk.Canvas(col, height=self._s(3), bg=C["btn"], highlightthickness=0)
            bar.pack(fill="x", pady=(2, 2))
            bar.bind("<Configure>", lambda e: (bar.delete("all"), bar.create_rectangle(
                0, 0, e.width * ratio, e.height, fill=C["moss"], width=0)))
        self._bind_tree(row, "<Button-1>", lambda e: on_click())

    def _group_status(self, title):
        """묶음(상위 할 일)의 (남은 하위 수, 전체 하위 수). 오늘 없으면 가장 최근 날짜 기준."""
        if not title:
            return None
        for key in sorted((k for k in self.store.data if k <= self.today.isoformat()), reverse=True):
            ts = self.store.data[key]
            g = next((t for t in ts if t["title"] == title and not t.get("parent")), None)
            if g:
                kids = children(g, ts) or [g]  # 하위가 없으면 그 할 일 하나로 계산
                return sum(not c["done"] for c in kids), len(kids)
        return None

    def save_goals(self):
        save_json(GOAL_FILE, self.goals)
        self.render_ddays()

    def save_deadlines(self):
        self.deadlines.sort(key=lambda d: d["date"])
        save_json(DEADLINE_FILE, self.deadlines)
        self.render_ddays()
        self._redraw_schedule()

    def _check(self, parent, t, bg):
        s = self.px
        c = tk.Canvas(parent, width=self._s(22), height=self._s(22), bg=bg, highlightthickness=0,
                      cursor="hand2")
        if t["done"]:
            c.create_oval(2 * s, 2 * s, 20 * s, 20 * s, fill=C["moss"], outline=C["moss"])
            c.create_line(6.5 * s, 11 * s, 9.5 * s, 14.5 * s, 15.5 * s, 7.5 * s, fill=C["ink"],
                          width=2 * s, capstyle="round", joinstyle="round")
        else:
            ring = c.create_oval(2 * s, 2 * s, 20 * s, 20 * s, outline=C["muted"], width=1.5 * s)
            c.bind("<Enter>", lambda e: c.itemconfig(ring, outline=C["moss"]))
            c.bind("<Leave>", lambda e: c.itemconfig(ring, outline=C["muted"]))
        c.bind("<Button-1>", lambda e: self.set_done(t, not t["done"]))
        return c

    def _time_fg(self, t):
        if over_estimate(t) and not t["done"]:
            return C["danger"]
        if t["started_at"]:
            return C["sun_text"]
        return C["faint"] if t["done"] else C["muted"]

    def _bind_tree(self, widget, seq, fn):
        widget.bind(seq, fn)
        for w in widget.winfo_children():
            self._bind_tree(w, seq, fn)

    def _time_cell(self, parent, bg, t, secs, fg, bold):
        tcol = tk.Frame(parent, bg=bg)
        tcol.pack(side="right", padx=6)
        tl = tk.Label(tcol, text=fmt(secs()), font=(MONO, 12, "bold" if bold else "normal"), bg=bg, fg=fg())
        tl.pack(anchor="e")
        self.time_labels[t["id"]] = (tl, secs, fg)
        extra = []
        if t.get("pomos"):
            extra.append(f"뽀모 {t['pomos']}")
        if t.get("estimate"):
            extra.append(f"목표 {fmt_hm(t['estimate'] * 60)}")
        if extra:
            tk.Label(tcol, text=" · ".join(extra), font=(FONT, 8), bg=bg, fg=C["faint"]).pack(anchor="e")

    def _linked_deadline(self, title):
        today = self.today.isoformat()
        linked = [d for d in self.deadlines if d.get("group") == title and d["date"] >= today]
        return min(linked, key=lambda d: d["date"]) if linked else None

    def _group_row(self, t, kids, tasks):
        """하위 할 일을 가진 상위 할 일: 접기/펼치기, 진행도, 시간 합계."""
        bg = C["card"]
        running = any(c["started_at"] for c in kids)
        row = tk.Frame(self.inner, bg=bg, highlightthickness=1, highlightbackground=C["border"])
        row.pack(fill="x", padx=12, pady=(6, 2))
        tk.Frame(row, bg=C["moss"], width=self._s(3)).pack(side="left", fill="y")
        inner = tk.Frame(row, bg=bg, padx=4, pady=8)
        inner.pack(side="left", fill="both", expand=True)

        arrow = tk.Label(inner, text="▸" if t.get("collapsed") else "▾", font=(FONT, 11), bg=bg,
                         fg=C["muted"], cursor="hand2", width=2)
        arrow.pack(side="left")
        arrow.bind("<Button-1>", lambda e: self.toggle_collapse(t))
        arrow.no_drag = True
        self._check(inner, t, bg).pack(side="left", padx=(0, 8))

        self._button(inner, "✕", lambda: self.delete(t), bg=bg, fg=C["faint"], hover=C["danger_bg"],
                     activeforeground=C["danger"], padx=6, font=(FONT, 9)).pack(side="right")
        self._button(inner, "+ 하위", lambda: self.prefill_child(t), width=7,
                     font=(FONT, 9)).pack(side="right", padx=(6, 2))

        def secs():
            return total_time(t, tasks)

        def fg():
            if over_estimate(t, secs()) and not t["done"]:
                return C["danger"]
            if any(c["started_at"] for c in kids):
                return C["sun_text"]
            return C["faint"] if t["done"] else C["muted"]
        self._time_cell(inner, bg, t, secs, fg, running)

        col = tk.Frame(inner, bg=bg, cursor="hand2")
        col.pack(side="left", fill="x", expand=True)
        tk.Label(col, text=t["title"], anchor="w", bg=bg, cursor="hand2",
                 font=(FONT, 11, "bold overstrike") if t["done"] else (FONT, 11, "bold"),
                 fg=C["faint"] if t["done"] else C["text"]).pack(fill="x")
        done = sum(c["done"] for c in kids)
        sub = f"하위 {done}/{len(kids)}"
        note = (t.get("note") or "").strip()
        if note:
            first = note.splitlines()[0]
            sub += "  ·  ✎ " + (first if len(first) <= 30 else first[:30] + " …")
        line = tk.Frame(col, bg=bg)
        line.pack(fill="x")
        dl = self._linked_deadline(t["title"])
        if dl:  # 연결된 마감: 'D-6' 을 색으로
            n = (date.fromisoformat(dl["date"]) - self.today).days
            dbg, dfg = dday_colors(n)
            tk.Label(line, text=dday_text(n), font=(FONT, 8, "bold"), bg=dbg, fg=dfg,
                     padx=4).pack(side="left", padx=(0, 6))
        tk.Label(line, text=sub, anchor="w", bg=bg, fg=C["faint"], font=(FONT, 9),
                 cursor="hand2").pack(side="left", fill="x")
        self._bind_tree(row, "<Button-3>", lambda e: self._context_menu(e, t))
        self._rows[t["id"]] = row
        return row, col

    def _row(self, t, child=False):
        running = bool(t["started_at"])
        bg = C["running"] if running else C["card"]
        row = tk.Frame(self.inner, bg=bg, highlightthickness=1,
                       highlightbackground=C["sun"] if running else C["border"])
        # 하위 할 일은 들여쓰고 촘촘하게
        row.pack(fill="x", padx=(12 + self._s(22), 12) if child else 12, pady=(0, 2) if child else 4)
        # 진행 중이면 왼쪽에 햇살색 띠, 하위 할 일은 연한 초록 가이드선
        strip = C["sun"] if running else C["guide"] if child else bg
        tk.Frame(row, bg=strip, width=self._s(3)).pack(side="left", fill="y")
        inner = tk.Frame(row, bg=bg, padx=8, pady=5 if child else 8)
        inner.pack(side="left", fill="both", expand=True)

        self._check(inner, t, bg).pack(side="left", padx=(0, 8))

        # 오른쪽 요소를 먼저 pack 해야 제목이 길어도 밀려나지 않음
        self._button(inner, "✕", lambda: self.delete(t), bg=bg, fg=C["faint"], hover=C["danger_bg"],
                     activeforeground=C["danger"], padx=6, font=(FONT, 9)).pack(side="right")
        if running:
            toggle = self._button(inner, "❚❚ 정지", lambda: self.toggle_timer(t), bg=C["sun"], fg=C["on_sun"],
                                  hover=C["sun_hi"], activebackground=C["sun_hi"], activeforeground=C["on_sun"],
                                  width=7, font=(FONT, 9, "bold"))
        else:
            toggle = self._button(inner, "▶ 시작", lambda: self.toggle_timer(t), width=7, font=(FONT, 9))
        if t["done"]:
            toggle.config(state="disabled", cursor="arrow", bg=bg)
        toggle.pack(side="right", padx=(6, 2))

        self._time_cell(inner, bg, t, lambda: elapsed(t), lambda: self._time_fg(t), running)

        col = tk.Frame(inner, bg=bg, cursor="hand2")
        col.pack(side="left", fill="x", expand=True)
        size = 10 if child else 11
        tk.Label(col, text=t["title"], anchor="w", bg=bg, cursor="hand2",
                 font=(FONT, size, "overstrike") if t["done"] else (FONT, size),
                 fg=C["faint"] if t["done"] else C["text"]).pack(fill="x")
        note = (t.get("note") or "").strip()
        if note:
            first = note.splitlines()[0]
            preview = first if len(first) <= 40 and "\n" not in note else first[:40] + " …"
            tk.Label(col, text="✎ " + preview, anchor="w", bg=bg, fg=C["faint"],
                     font=(FONT, 9), cursor="hand2").pack(fill="x")
        self._bind_tree(row, "<Button-3>", lambda e: self._context_menu(e, t))
        self._rows[t["id"]] = row
        return row, col

    # ---------- 드래그로 순서 바꾸기 ----------
    def _make_draggable(self, t, row, click_area, sibs):
        """줄 아무 데나 길게 누르거나 끌면 이동. 제목 부분을 짧게 누르면 상세 창."""
        clicks = set()

        def collect(w):
            clicks.add(w)
            for c in w.winfo_children():
                collect(c)
        collect(click_area)

        def walk(w):
            # 버튼·체크 동그라미·접기 화살표는 원래 동작 그대로
            if isinstance(w, (tk.Button, tk.Canvas)) or getattr(w, "no_drag", False):
                return
            on_click = (lambda: self.edit_task(t)) if w in clicks else None
            w.bind("<ButtonPress-1>", lambda e: self._rdrag_press(e, t, row, sibs, on_click))
            w.bind("<B1-Motion>", self._rdrag_motion)
            w.bind("<ButtonRelease-1>", self._rdrag_release)
            for c in w.winfo_children():
                walk(c)
        walk(row)

    def _rdrag_press(self, e, t, row, sibs, on_click):
        self._rdrag = {"t": t, "row": row, "sibs": sibs, "click": on_click, "y0": e.y_root,
                      "active": False, "idx": None, "job": self.after(350, self._rdrag_start)}

    def _rdrag_start(self):
        d = getattr(self, "_rdrag", None)
        if not d or d["active"]:
            return
        d["job"] = None
        d["active"] = True
        if len(d["sibs"]) < 2:  # 옮길 자리가 없음 — 길게 누른 것으로만 처리
            return
        d["row"].config(highlightbackground=C["moss"], highlightthickness=2)
        self.config(cursor="fleur")
        d["line"] = tk.Frame(self.inner, bg=C["moss"], height=self._s(3))

    def _rdrag_motion(self, e):
        d = getattr(self, "_rdrag", None)
        if not d:
            return
        if not d["active"]:
            if abs(e.y_root - d["y0"]) < self._s(8):
                return
            self.after_cancel(d["job"])  # 길게 누르지 않아도 끌기 시작하면 바로 드래그
            self._rdrag_start()
        if "line" not in d:
            return
        try:
            self._rdrag_track(e, d)
        except tk.TclError:  # 드래그 중 목록이 다시 그려짐(뽀모도로 종료 등) → 드래그 취소
            self._rdrag = None
            self.config(cursor="")

    def _rdrag_track(self, e, d):
        # 목록 위·아래 끝으로 끌면 자동 스크롤
        top = self.canvas.winfo_rooty()
        if e.y_root < top + self._s(28):
            self.canvas.yview_scroll(-1, "units")
        elif e.y_root > top + self.canvas.winfo_height() - self._s(28):
            self.canvas.yview_scroll(1, "units")
        rows = [self._rows[x["id"]] for x in d["sibs"]]
        idx = next((i for i, r in enumerate(rows) if e.y_root < r.winfo_rooty() + r.winfo_height() / 2),
                   len(rows))
        d["idx"] = idx
        if idx < len(rows):
            y = rows[idx].winfo_y() - self._s(3)
        else:  # 맨 끝: 마지막 덩어리(묶음이면 하위 줄까지) 바로 아래
            last = d["sibs"][-1]
            end = self._block_end.get(last["id"], rows[-1])
            y = end.winfo_y() + end.winfo_height() + 1
        ref = rows[0]
        d["line"].place(x=ref.winfo_x(), y=y, width=ref.winfo_width(), height=self._s(3))
        d["line"].lift()

    def _rdrag_release(self, e):
        d, self._rdrag = getattr(self, "_rdrag", None), None
        if not d:
            return
        if d["job"]:
            self.after_cancel(d["job"])
        if not d["active"]:  # 짧게 누름 = 클릭
            if d["click"]:
                d["click"]()
            return
        self.config(cursor="")
        if "line" in d:
            d["line"].destroy()
            if d["idx"] is not None:
                self._reorder(d["t"], d["sibs"], d["idx"])
        self.refresh()

    def _reorder(self, t, sibs, idx):
        """형제들끼리만 순서를 바꾸고, 다른 할 일들의 자리는 그대로 둠."""
        old = sibs.index(t)
        new = [x for x in sibs if x is not t]
        new.insert(idx - 1 if idx > old else idx, t)
        if new == sibs:
            return
        tasks = self.store.tasks(self.day)
        slots = sorted(next(i for i, x in enumerate(tasks) if x is s) for s in sibs)
        for pos, x in zip(slots, new):
            tasks[pos] = x

    def _context_menu(self, e, t):
        tasks = self.store.tasks(self.day)
        is_parent = bool(children(t, tasks))
        m = tk.Menu(self, tearoff=0, **self.menu_style)
        m.add_command(label="상세 편집 (메모·예상 시간)", command=lambda: self.edit_task(t))
        if t.get("parent"):
            m.add_command(label="묶음에서 빼기", command=lambda: self.set_parent(t, None))
        else:
            m.add_command(label="하위 할 일 추가", command=lambda: self.prefill_child(t))
            targets = [x for x in tasks if x is not t and not x.get("parent")]
            if targets and not is_parent:
                sub = tk.Menu(m, tearoff=0, **self.menu_style)
                for x in targets:
                    sub.add_command(label=x["title"], command=lambda x=x: self.set_parent(t, x))
                m.add_cascade(label="다른 할 일 아래로 묶기", menu=sub)
            m.add_separator()
            # 마감 연결: 이 할 일(묶음)의 남은 하위 수와 페이스를 디데이 옆에 표시
            dm = tk.Menu(m, tearoff=0, **self.menu_style)
            today = self.today.isoformat()
            for dl in sorted((d for d in self.deadlines if d["date"] >= today), key=lambda d: d["date"]):
                n = (date.fromisoformat(dl["date"]) - self.today).days
                mark = "✓ " if dl.get("group") == t["title"] else "    "
                dm.add_command(label=f"{mark}{dday_text(n)}  {dl['title']}",
                               command=lambda dl=dl: self.link_deadline(dl, t["title"]))
            dm.add_command(label="+ 새 마감 만들기…", command=lambda: self.open_deadlines(group=t["title"]))
            m.add_cascade(label="마감 연결", menu=dm)
            # 목표 연결: 이 제목의 시간이 목표 누적 시간에 합산
            gm = tk.Menu(m, tearoff=0, **self.menu_style)
            for g in self.goals:
                linked = t["title"] == g["title"] or t["title"] in g.get("titles", [])
                gm.add_command(label=("✓ " if linked else "    ") + g["title"],
                               command=lambda g=g: self.link_goal(g, t["title"]))
            gm.add_command(label="+ 이 할 일로 새 목표 만들기", command=lambda: self.add_goal(t["title"]))
            m.add_cascade(label="목표에 연결", menu=gm)
        m.add_separator()
        m.add_command(label="삭제", command=lambda: self.delete(t))
        m.tk_popup(e.x_root, e.y_root)

    def _update_summary(self):
        tasks = self.store.tasks(self.day)
        parents = {t.get("parent") for t in tasks}
        leaves = [t for t in tasks if t["id"] not in parents]  # 상위 할 일은 개수에서 제외
        done = sum(t["done"] for t in leaves)
        total = sum(elapsed(t) for t in tasks)
        running = sum(bool(t["started_at"]) for t in tasks)
        extra = f"  ·  진행 중 {running}" if running else ""
        self.summary.config(text=f"완료 {done}/{len(leaves)}  ·  총 {fmt(total)}{extra}")
        w = self.progress.winfo_width()
        self.progress.delete("all")
        if leaves and done:
            self.progress.create_rectangle(0, 0, w * done / len(leaves), self._s(10), fill=C["moss"], width=0)

    def _running(self):
        return [t for t in self.store.all_tasks() if t["started_at"]]

    def _guard_timers(self):
        """타이머 깜빡 방지: 절전 복귀 · 자리 비움 · 너무 오래 켜진 타이머."""
        now = time.time()
        gap, self._last_tick = now - self._last_tick, now
        if self._pending_away:  # 시작할 때 '꺼져 있던 동안' 확인이 먼저
            return
        running = self._running()
        if not running or self._away_open:
            self._idle_since = None
        elif gap > 120:  # 이벤트 루프가 멈춰 있었음 = 절전/최대 절전
            self._idle_since = None
            self._ask_away(now - gap, "절전 모드였던 동안")
            return
        elif self.settings.get("idle_on", True):
            idle = idle_seconds()
            if self._idle_since is None and idle >= int(self.settings.get("idle_min", 10)) * 60:
                self._idle_since = now - idle  # 자리 비움 시작 — 돌아오면 물어봄
            elif self._idle_since is not None and idle < 5:
                since, self._idle_since = self._idle_since, None
                self._ask_away(since, "입력이 없던 동안")
                return
        if self.settings.get("long_on", True):
            limit = float(self.settings.get("long_hours", 2)) * 3600
            for t in running:
                if now - t["started_at"] >= limit and self._long_notified.get(t["id"]) != t["started_at"]:
                    self._long_notified[t["id"]] = t["started_at"]
                    self.notify(f"'{t['title']}' 타이머가 {fmt_hm(now - t['started_at'])}째 켜져 있어요",
                                "계속하는 중이 아니라면 정지해 주세요", ("정지", lambda t=t: self.toggle_timer(t)))
        # 1분마다 살아 있다는 표시 — 강제 종료·재부팅 뒤 켜진 타이머를 알아채는 데 사용
        if now - (self.settings.get("heartbeat") or 0) >= 60:
            self.settings["heartbeat"] = now
            self._save_settings()

    def _task_day(self, t):
        return next(date.fromisoformat(k) for k, ts in self.store.data.items() if any(x is t for x in ts))

    def _ask_away(self, since, reason):
        self._pending_away = False
        running = self._running()
        away = time.time() - since
        if not running or away < 60 or self._away_open:
            if self.store.split_at_midnight(self.today):
                self.store.save()
            return
        self._away_open = self._dialog_open = True
        try:
            d = AwayDialog(self, since, reason, running)
            self.wait_window(d)
        finally:
            self._away_open = self._dialog_open = False
        if d.choice in ("cut", "cut_stop"):
            for t in running:  # 자리를 비운 시점에 멈춘 것으로
                t["elapsed"] += max(0, since - t["started_at"])
                t["started_at"] = None
            if d.choice == "cut":  # 지금부터 다시 (날짜가 바뀌었으면 오늘 목록의 같은 할 일로)
                for t in running:
                    day = self._task_day(t)
                    if day != self.today:
                        t = self.store.copy_task(t, self.store.data[day.isoformat()], self.store.tasks(self.today))
                        t["done"] = False
                    start(t)
            self.pomo = None
        self._last_tick = time.time()
        self.store.split_at_midnight(self.today)
        self.refresh()

    def _tick(self):
        self._guard_timers()
        # 자정이 지나면: 켜진 타이머를 날짜별로 나누고 '오늘' 화면을 새 날짜로 넘김
        if date.today() != self.today:
            was_today = self.day == self.today
            self.today = date.today()
            if self.store.split_at_midnight(self.today):
                self.store.save()
            if was_today:
                self.day = self.today
                self._load_diary()
            self.render()
        for label, secs, fg in self.time_labels.values():
            label.config(text=fmt(secs()), fg=fg())
        self._update_summary()
        self._pomo_tick()
        self._review_nudge()
        self._event_reminders()
        # Win+D(바탕화면 보기) 등으로 최소화돼도 위젯은 다시 표시
        if self.widget_mode and self.state() == "iconic":
            self.deiconify()
            self.apply_pin()
        self._tick_id = self.after(500, self._tick)

    def refresh(self):
        self.store.save()
        # 뽀모도로 집중 중인데 그 타이머가 꺼졌다면(직접 정지·완료·삭제) 뽀모도로도 끝냄
        if self.pomo and self.pomo["phase"] == "focus":
            t = self._find(self.pomo["tid"])
            if not t or not t["started_at"]:
                self.pomo = None
        # 위젯 콜백 안에서 자기 자신을 destroy 하지 않도록 idle 때 다시 그림
        self.after_idle(self.render)
        self.after_idle(self._render_pomo)
        self._redraw_stats()

    def _find(self, tid):
        return next((t for t in self.store.all_tasks() if t["id"] == tid), None)

    # ---------- 뽀모도로 ----------
    def _pomo_min(self, key):
        return int(self.settings.get(key, POMO_DEFAULTS[key]))

    def _pomo_tick(self):
        p = self.pomo
        if not p:
            return
        if p["phase"] in ("focus", "break") and time.time() >= p["ends"]:
            self._pomo_advance()
        elif p["phase"] in ("focus", "break"):
            left = max(0, int(p["ends"] - time.time()))
            self.pomo_clock.config(text=f"{left // 60:02d}:{left % 60:02d}")

    def _pomo_advance(self):
        p = self.pomo
        t = self._find(p["tid"])
        title = t["title"] if t else ""
        if p["phase"] == "focus":
            if t:
                stop(t)
                t["pomos"] = t.get("pomos", 0) + 1
            p["count"] += 1
            long_break = p["count"] % self._pomo_min("pomo_every") == 0
            mins = self._pomo_min("pomo_long" if long_break else "pomo_break")
            p.update(phase="break", ends=time.time() + mins * 60)
            self.notify(f"집중 {self._pomo_min('pomo_focus')}분 끝!",
                        f"'{title}' 뽀모 {p['count']}회째 완료 · {mins}분 쉬어요")
        else:
            p.update(phase="ready", ends=None)
            self.notify("휴식 끝!", f"'{title}' 다시 집중해 볼까요?", ("집중 시작", self.pomo_next))
        self.refresh()

    def pomo_next(self):
        t = self.pomo and self._find(self.pomo["tid"])
        if t and not t["done"]:
            if not t["started_at"]:
                self.toggle_timer(t)
        else:
            self.pomo_end()

    def pomo_skip(self):
        if self.pomo:
            self.pomo.update(phase="ready", ends=None)
            self._render_pomo()

    def pomo_end(self):
        if self.pomo and self.pomo["phase"] == "focus":
            t = self._find(self.pomo["tid"])
            self.pomo = None
            if t and t["started_at"]:
                self.toggle_timer(t)
        self.pomo = None
        self._render_pomo()

    def _render_pomo(self):
        bar = self.pomo_bar
        for w in bar.winfo_children():
            w.destroy()
        p = self.pomo
        if not p:
            bar.pack_forget()
            return
        t = self._find(p["tid"])
        focus = p["phase"] == "focus"
        bg = C["running"] if focus else C["card"]
        bar.config(bg=bg, highlightbackground=C["sun"] if focus else C["moss"])
        bar.pack(fill="x", padx=16, pady=(0, 8), before=self.body)
        inner = tk.Frame(bar, bg=bg, padx=10, pady=6)
        inner.pack(fill="x")
        phase = {"focus": "집중", "break": "휴식", "ready": "휴식 끝"}[p["phase"]]
        tk.Label(inner, text=phase, font=(FONT, 10, "bold"), bg=bg,
                 fg=C["sun_text"] if focus else C["moss"]).pack(side="left")
        cycle = self._pomo_min("pomo_every")
        dots = "●" * (p["count"] % cycle) + "○" * (cycle - p["count"] % cycle)
        tk.Label(inner, text=dots, font=(FONT, 8), bg=bg, fg=C["faint"]).pack(side="left", padx=6)
        btn = dict(font=(FONT, 9), pady=2, padx=8)
        if p["phase"] == "ready":
            self._button(inner, "끝내기", self.pomo_end, **btn).pack(side="right")
            self._button(inner, "▶ 집중 시작", self.pomo_next, bg=C["moss"], fg=C["ink"],
                         hover=C["moss_hi"], activebackground=C["moss_hi"], activeforeground=C["ink"],
                         **btn).pack(side="right", padx=(0, 6))
        else:
            self._button(inner, "그만" if focus else "건너뛰기",
                         self.pomo_end if focus else self.pomo_skip, **btn).pack(side="right")
            self.pomo_clock = tk.Label(inner, font=(MONO, 13, "bold"), bg=bg,
                                       fg=C["sun_text"] if focus else C["moss"])
            self.pomo_clock.pack(side="right", padx=8)
        tk.Label(inner, text=t["title"] if t else "", font=(FONT, 9), bg=bg, fg=C["muted"],
                 anchor="w").pack(side="left", fill="x", expand=True)
        self._pomo_tick()

    # ---------- 알림 ----------
    def notify(self, title, body="", action=None):
        """화면 오른쪽 아래 토스트 + 알림음. action = (버튼 글자, 콜백)."""
        self.bell()
        if self.toast and self.toast.winfo_exists():
            self.toast.destroy()
        self.toast = Toast(self, title, body, action)

    def _review_nudge(self):
        if not self.settings.get("review_on", True):
            return
        today = self.today.isoformat()
        if today in (self.settings.get("reviewed"), self.settings.get("nudged")):
            return
        if datetime.now().strftime("%H:%M") >= self.settings.get("review_time", "22:00"):
            self.settings["nudged"] = today
            self._save_settings()
            self.notify("오늘 하루를 정리해 볼까요?", "한 일 · 습관 · 기분 · 한 줄 회고",
                        ("정리하기", self.open_review))

    # ---------- 전역 단축키 ----------
    def register_hotkeys(self, startup=False):
        if self.hotkeys:
            self.hotkeys.stop()
        keys = self.settings.get("hotkeys", DEFAULT_HOTKEYS)
        bindings = {a: (k["mods"], k["vk"]) for a, k in keys.items() if k}
        self.hotkeys = HotkeyListener(bindings)
        self.hotkeys.start()
        self.hotkeys.ready.wait(1.0)
        failed = [keys[a]["label"] for a in self.hotkeys.failed]
        if failed and startup:
            self.after(800, lambda: self.notify("단축키를 등록하지 못했어요",
                                                f"{', '.join(failed)} — 다른 프로그램이 사용 중이에요. "
                                                "⋯ > 설정에서 바꿀 수 있어요"))
        return failed

    def _poll_hotkeys(self):
        try:
            while True:
                action = self.hotkeys.queue.get_nowait()
                {"show": self.summon, "timer": self.hotkey_timer, "review": self.hotkey_review}[action]()
        except queue.Empty:
            pass
        self._hotkey_job = self.after(80, self._poll_hotkeys)

    def summon(self):
        """단축키: 창을 앞으로 가져오고 입력창에 바로 입력."""
        if self.state() in ("iconic", "withdrawn"):
            self.deiconify()
        if self.day != self.today:
            self.go(0)
        self.attributes("-topmost", True)
        self.lift()
        try:
            ctypes.windll.user32.SetForegroundWindow(ctypes.windll.user32.GetParent(self.winfo_id()))
        except Exception:
            pass
        self.focus_force()
        self.entry.focus_set()
        # 잠깐만 맨 위로 — 이후엔 원래 고정 방식대로 (다른 곳을 클릭하면 다시 뒤로)
        self.after(500, lambda: self.attributes(
            "-topmost", bool(self.widget_mode and self.settings.get("pin", "desktop") == "top")))

    def hotkey_timer(self):
        running = [t for t in self.store.all_tasks() if t["started_at"]]
        if running:
            for t in running:
                self.toggle_timer(t)
            self.notify("타이머 정지", ", ".join(f"{t['title']} ({fmt(elapsed(t))})" for t in running))
            return
        tid, title = (self.settings.get("last_task") or [None, None])
        tasks = self.store.tasks(self.today)
        t = (next((x for x in tasks if x["id"] == tid), None)
             or next((x for x in tasks if x["title"] == title and not x["done"]), None))
        if t and not t["done"] and not children(t, tasks):
            if self.day != self.today:
                self.go(0)
            self.toggle_timer(t)
            self.notify("타이머 시작", t["title"])
        else:
            self.summon()
            self.notify("다시 시작할 할 일이 없어요", "할 일 옆의 ▶ 시작을 눌러 주세요")

    def hotkey_review(self):
        self.summon()
        self.open_review()

    # ---------- actions ----------
    def go(self, delta):
        self.go_to(self.today if delta == 0 else self.day + timedelta(days=delta))

    def go_to(self, day):
        self.day = day
        self._load_diary()
        self.render()
        self.canvas.yview_moveto(0)

    def open_calendar(self):
        if self.cal_popup and self.cal_popup.winfo_exists():
            self.cal_popup.destroy()
            return
        self.cal_popup = CalendarPopup(self, self.date_lbl, self.day, self.go_to)

    def _open_window(self, attr, cls, *args, **kw):
        """관리 창은 하나씩만. 열려 있는 동안은 위젯이 맨 뒤로 숨지 않게."""
        existing = getattr(self, attr, None)
        if existing and existing.winfo_exists():
            existing.lift()
            existing.focus_force()
            return
        self._dialog_open = True
        try:
            win = cls(self, *args, **kw)
            setattr(self, attr, win)
            self.wait_window(win)
        finally:
            self._dialog_open = False

    def open_deadlines(self, group=None):
        self._open_window("dl_win", DeadlineDialog, group)

    def open_goals(self):
        self._open_window("goal_win", GoalDialog)

    def open_habits(self):
        self._open_window("habit_win", HabitDialog)

    def open_settings(self):
        self._open_window("settings_win", SettingsDialog)

    def open_review(self):
        self._save_diary()
        self._open_window("review_win", ReviewDialog, self.day)

    def link_deadline(self, dl, title):
        dl["group"] = None if dl.get("group") == title else title
        self.save_deadlines()
        self.refresh()

    def link_goal(self, g, title):
        if title == g["title"]:
            return  # 목표와 같은 이름은 항상 연결됨
        titles = g.setdefault("titles", [])
        titles.remove(title) if title in titles else titles.append(title)
        self.save_goals()

    def add_goal(self, title, target_hours=None):
        if any(g["title"] == title for g in self.goals):
            return
        self.goals.append({"id": uuid.uuid4().hex, "title": title, "target_hours": target_hours,
                           "titles": [], "created": self.today.isoformat()})
        self.save_goals()

    def add(self):
        text = "" if self._ph_on else self.entry.get().strip()
        if not text:
            return
        event = parse_event(text)
        if event:  # '13:30 회의' → 보고 있는 날짜의 일정
            self.entry.delete(0, "end")
            self.add_event(self.day, *event)
            return
        tasks = self.store.tasks(self.day)
        ptitle, sep, ctitle = (s.strip() for s in text.partition(">"))
        if sep and not (ptitle and ctitle):
            self.bell()  # 'KAMP >' 처럼 한쪽이 비어 있으면 입력 대기
            return
        self.entry.delete(0, "end")
        if sep:
            # '상위 > 하위' : 상위가 없으면 만들고, 입력창엔 '상위 > '를 남겨 연속 입력
            parent = next((x for x in tasks if x["title"] == ptitle and not x.get("parent")), None)
            if parent is None:
                parent = new_task(ptitle)
                tasks.append(parent)
            child = new_task(ctitle)
            self._attach(child, parent)
            tasks.append(child)
            self.entry.insert(0, f"{ptitle} > ")
        else:
            tasks.append(new_task(text))
        self.refresh()

    def _attach(self, t, parent):
        t["parent"] = parent["id"]
        stop(parent)  # 상위 할 일의 시간은 하위 합계로 표시되므로 자체 타이머는 끔
        parent["collapsed"] = False

    def prefill_child(self, parent):
        self._placeholder(False)
        self.entry.delete(0, "end")
        self.entry.insert(0, f"{parent['title']} > ")
        self.entry.focus_set()
        self.entry.icursor("end")

    def set_parent(self, t, parent):
        if parent:
            self._attach(t, parent)
        else:
            t["parent"] = None
        self.refresh()

    def toggle_collapse(self, t):
        t["collapsed"] = not t.get("collapsed")
        self.refresh()

    def set_done(self, t, done):
        # 상위 할 일을 체크하면 하위 전체를 함께 완료/해제
        for x in [t] + children(t, self.store.tasks(self.day)):
            x["done"] = done
            if done:
                stop(x)
            if x.get("mandala"):  # 만다라트 실천 칸에도 완료 표시
                s, a = x["mandala"]
                self.mandala["done"][s][a] = done
                self.save_mandala()
        self.refresh()

    def save_mandala(self):
        save_json(MANDALA_FILE, self.mandala)
        if self.mandala_win and self.mandala_win.winfo_exists():
            self.mandala_win.draw()

    def open_mandala(self):
        if self.mandala_win and self.mandala_win.winfo_exists():
            self.mandala_win.deiconify()
            self.mandala_win.lift()
            self.mandala_win.focus_force()
            return
        self.mandala_win = MandalartWindow(self)

    def toggle_timer(self, t):
        if t["started_at"]:
            stop(t)
        else:
            if self.single_var.get():
                for other in self.store.all_tasks():
                    stop(other)
            start(t)
            self.settings["last_task"] = [t["id"], t["title"]]  # 단축키로 다시 켤 때 사용
            if self.pomo_var.get():
                keep = self.pomo and self.pomo["tid"] == t["id"]
                self.pomo = {"tid": t["id"], "phase": "focus", "count": self.pomo["count"] if keep else 0,
                             "ends": time.time() + self._pomo_min("pomo_focus") * 60}
        self.refresh()

    def edit_task(self, t):
        self._dialog_open = True
        try:
            d = TaskDialog(self, t, total_time(t, self.store.tasks(self.day)))
            self.wait_window(d)
        finally:
            self._dialog_open = False
        if d.saved:
            self.refresh()

    def delete(self, t):
        tasks = self.store.tasks(self.day)
        kids = children(t, tasks)
        msg = f"'{t['title']}'을(를) 삭제할까요?"
        if kids:
            msg += f"\n하위 할 일 {len(kids)}개도 함께 삭제됩니다."
        if not self._dialog(messagebox.askyesno, "삭제", msg):
            return
        for x in [t] + kids:
            tasks.remove(x)
        self.refresh()

    def carry_over(self):
        key = self.day.isoformat()
        prev_days = [k for k, v in self.store.data.items() if k < key and v]
        if not prev_days:
            self._dialog(messagebox.showinfo, "가져오기", "이전 날짜에 할 일이 없습니다.")
            return
        prev_key = max(prev_days)
        prev, cur = self.store.data[prev_key], self.store.tasks(self.day)
        parents = {t.get("parent") for t in prev}
        before = len(cur)
        # 미완료인 '실제 할 일'(하위가 없는 것)만 가져오고, 상위는 필요할 때 함께 만들어짐
        for t in prev:
            if not t["done"] and t["id"] not in parents:
                stop(t)
                self.store.copy_task(t, prev, cur)
        if len(cur) == before:
            self._dialog(messagebox.showinfo, "가져오기", f"{prev_key}에 가져올 미완료 항목이 없습니다.")
            return
        self.refresh()

    def open_stats(self):
        if self.stats_win and self.stats_win.winfo_exists():
            self.stats_win.deiconify()
            self.stats_win.lift()
            self.stats_win.focus_force()
            return
        self.stats_win = StatsWindow(self)

    def on_close(self):
        running = [t for t in self.store.all_tasks() if t["started_at"]]
        if running:
            ans = self._dialog(
                messagebox.askyesnocancel,
                "종료", f"실행 중인 스톱워치가 {len(running)}개 있습니다.\n\n"
                       "예: 모두 정지하고 종료\n아니요: 켜 둔 채 종료 (다시 열면 그동안의 시간이 이어서 계산됨)")
            if ans is None:
                return
            if ans:
                for t in running:
                    stop(t)
        self.store.save()
        self._save_diary()
        self.settings["heartbeat"] = None  # 정상 종료 — 다음 실행 때 '꺼져 있던 동안' 확인 안 함
        self._save_settings()
        self.after_cancel(self._tick_id)
        self.after_cancel(self._hotkey_job)
        if self.hotkeys:
            self.hotkeys.stop()
        self.destroy()


class TaskDialog(tk.Toplevel):
    """제목·예상 시간·메모 편집 창."""

    def __init__(self, app, t, secs):
        super().__init__(app)
        self.app, self.t, self.saved = app, t, False
        self.title("할 일 상세")
        self.configure(bg=C["bg"], padx=18, pady=16)
        self.resizable(False, False)
        self.transient(app)
        if app.attributes("-topmost"):
            self.attributes("-topmost", True)

        def label(text, top=12):
            tk.Label(self, text=text, font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"],
                     anchor="w").pack(fill="x", pady=(top, 4))

        label("제목", 0)
        self.title_e = app._field(self, width=36)
        self.title_e.insert(0, t["title"])
        self.title_e.pack(fill="x", ipady=6, ipadx=6)

        label("예상 시간 (분)")
        est_row = tk.Frame(self, bg=C["bg"])
        est_row.pack(fill="x")
        self.est_e = app._field(est_row, width=8)
        if t.get("estimate"):
            self.est_e.insert(0, str(t["estimate"]))
        self.est_e.pack(side="left", ipady=6, ipadx=6)
        tk.Label(est_row, text="비워 두면 목표 없음", font=(FONT, 9),
                 bg=C["bg"], fg=C["faint"]).pack(side="left", padx=10)

        # 기록 시간 직접 수정 (타이머를 깜빡했을 때). 상위 할 일은 하위 합계라 수정 불가
        self.time_e = None
        if children(t, app.store.all_tasks()):
            label("기록 시간")
            tk.Label(self, text=f"{fmt(secs)}  (하위 할 일 합계 — 하위에서 수정해요)", font=(FONT, 9),
                     bg=C["bg"], fg=C["faint"], anchor="w").pack(fill="x")
        else:
            label("기록 시간")
            time_row = tk.Frame(self, bg=C["bg"])
            time_row.pack(fill="x")
            self.time_e = app._field(time_row, width=10, font=(MONO, 11))
            self.orig_time = fmt(secs)
            self.time_e.insert(0, self.orig_time)
            self.time_e.pack(side="left", ipady=6, ipadx=6)
            tk.Label(time_row, text="1:25:00 · 1:25 · 90(분) 형식", font=(FONT, 9),
                     bg=C["bg"], fg=C["faint"]).pack(side="left", padx=10)

        label("메모")
        self.note = app._field(self, tk.Text, width=40, height=7, wrap="word", font=(FONT, 10),
                               padx=10, pady=8, undo=True)
        self.note.insert("1.0", t.get("note", ""))
        self.note.pack(fill="both")

        self.error = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["danger"], anchor="w")
        self.error.pack(fill="x", pady=(8, 0))

        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(6, 0))
        app._button(btns, "저장", self.save, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                    activebackground=C["moss_hi"], activeforeground=C["ink"],
                    font=(FONT, 10, "bold"), padx=16).pack(side="right")
        app._button(btns, "취소", self.destroy, padx=14).pack(side="right", padx=(0, 8))
        tk.Label(btns, text="Ctrl+Enter 저장 · Esc 취소", font=(FONT, 8), bg=C["bg"],
                 fg=C["faint"]).pack(side="left")

        self.bind("<Escape>", lambda e: self.destroy())
        self.bind("<Control-Return>", lambda e: self.save() or "break")
        self.update_idletasks()
        x = app.winfo_rootx() + (app.winfo_width() - self.winfo_width()) // 2
        y = app.winfo_rooty() + app._s(60)
        self.geometry(f"+{max(0, x)}+{max(0, y)}")
        app._window_chrome(self)
        self.grab_set()
        self.note.focus_set() if t["title"] else self.title_e.focus_set()

    def save(self):
        title = self.title_e.get().strip()
        est = self.est_e.get().strip()
        if not title:
            self.error.config(text="제목을 입력해 주세요.")
            return
        if est and not (est.isdigit() and int(est) > 0):
            self.error.config(text="예상 시간은 1 이상의 숫자(분)로 적어 주세요.")
            return
        if self.time_e and self.time_e.get().strip() != self.orig_time:
            secs = parse_duration(self.time_e.get())
            if secs is None:
                self.error.config(text="기록 시간은 1:25:00, 1:25, 90 처럼 적어 주세요.")
                return
            # 켜져 있으면 지금 시각부터 다시 재기
            self.t["elapsed"] = float(secs)
            if self.t["started_at"]:
                self.t["started_at"] = time.time()
        self.t["title"] = title
        self.t["estimate"] = int(est) if est else None
        self.t["note"] = self.note.get("1.0", "end-1c").strip()
        self.saved = True
        self.destroy()


class CalendarPopup(tk.Toplevel):
    """날짜 아래에 뜨는 달력. 할 일이 있는 날은 초록 점, 마감일은 빨간 점."""

    def __init__(self, app, anchor, selected, on_pick):
        super().__init__(app)
        self.app, self.selected, self.on_pick = app, selected, on_pick
        self.month = selected.replace(day=1)
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(bg=C["border"])
        box = tk.Frame(self, bg=C["card"], padx=10, pady=8)
        box.pack(padx=1, pady=1)

        head = tk.Frame(box, bg=C["card"])
        head.pack(fill="x")
        nav = dict(bg=C["card"], fg=C["muted"], hover=C["btn"], padx=8, pady=0, font=(FONT, 14))
        app._button(head, "‹", lambda: self.shift(-1), **nav).pack(side="left")
        app._button(head, "›", lambda: self.shift(1), **nav).pack(side="right")
        self.title_l = tk.Label(head, font=(FONT, 11, "bold"), bg=C["card"], fg=C["text"])
        self.title_l.pack(side="left", expand=True)

        self.grid_f = tk.Frame(box, bg=C["card"])
        self.grid_f.pack(pady=(6, 4))

        foot = tk.Frame(box, bg=C["card"])
        foot.pack(fill="x")
        for color, text in ((C["moss"], "할 일"), (C["sun"], "일정"), (C["danger"], "마감")):
            tk.Label(foot, text="●", font=(FONT, 7), bg=C["card"], fg=color).pack(side="left")
            tk.Label(foot, text=text, font=(FONT, 8), bg=C["card"], fg=C["faint"]).pack(side="left", padx=(1, 8))
        app._button(foot, "오늘", lambda: self.pick(app.today), font=(FONT, 9), pady=2).pack(side="right")

        self.bind("<Escape>", lambda e: self.destroy())
        self.bind("<FocusOut>", lambda e: app.after(80, self._close_if_unfocused))
        self.bind("<MouseWheel>", lambda e: self.shift(-1 if e.delta > 0 else 1))
        self.draw()
        self.update_idletasks()
        x = anchor.winfo_rootx() + (anchor.winfo_width() - self.winfo_width()) // 2
        y = anchor.winfo_rooty() + anchor.winfo_height() + app._s(4)
        x = min(max(0, x), self.winfo_screenwidth() - self.winfo_width())
        self.geometry(f"+{x}+{y}")
        self.focus_force()

    def _close_if_unfocused(self):
        try:
            if not self.winfo_exists():
                return
            focused = self.focus_get()
            if focused is None or focused.winfo_toplevel() is not self:
                self.destroy()
        except (KeyError, tk.TclError):
            pass

    def shift(self, months):
        y, m = divmod(self.month.year * 12 + self.month.month - 1 + months, 12)
        self.month = date(y, m + 1, 1)
        self.draw()

    def pick(self, day):
        self.destroy()
        self.on_pick(day)

    def draw(self):
        for w in self.grid_f.winfo_children():
            w.destroy()
        self.title_l.config(text=f"{self.month.year}년 {self.month.month}월")
        for i, h in enumerate(DAY_HEADS):
            tk.Label(self.grid_f, text=h, font=(FONT, 9), width=4, bg=C["card"],
                     fg=C["danger"] if i == 0 else C["muted"]).grid(row=0, column=i, pady=(0, 4))
        task_days = {k for k, v in self.app.store.data.items() if v}
        hide_past = self.app.settings.get("hide_past_deadlines", True)
        dl_days = {d["date"] for d in self.app.deadlines
                   if not (hide_past and d["date"] < self.app.today.isoformat())}
        ev_days = {k for k, v in self.app.events.items() if v}
        weeks = calendar.Calendar(firstweekday=6).monthdatescalendar(self.month.year, self.month.month)
        for r, week in enumerate(weeks, start=1):
            for c, d in enumerate(week):
                self._cell(d, task_days, dl_days, ev_days).grid(row=r, column=c, padx=1, pady=1)

    def _cell(self, d, task_days, dl_days, ev_days):
        iso = d.isoformat()
        sel, is_today = d == self.selected, d == self.app.today
        bg = C["moss"] if sel else C["btn"] if is_today else C["card"]
        if sel:
            fg = C["ink"]
        elif d.month != self.month.month:
            fg = C["faint"]
        else:
            fg = C["danger"] if d.weekday() == 6 else C["text"]
        # 점 하나만: 마감 > 일정 > 할 일 순으로 우선
        if iso in dl_days:
            dot = C["danger"]
        elif iso in ev_days:
            dot = C["sun"]
        elif iso in task_days:
            dot = C["ink"] if sel else C["moss"]
        else:
            dot = bg
        f = tk.Frame(self.grid_f, bg=bg, cursor="hand2")
        num = tk.Label(f, text=d.day, width=3, font=(FONT, 10, "bold" if sel or is_today else "normal"),
                       bg=bg, fg=fg, cursor="hand2")
        num.pack(pady=(3, 0))
        mark = tk.Label(f, text="●", font=(FONT, 5), bg=bg, fg=dot, cursor="hand2")
        mark.pack(pady=(0, 2))
        parts = (f, num, mark)

        def paint(color):
            for p in parts:
                p.config(bg=color)
            if dot == bg:  # 표시할 점이 없으면 점도 배경색과 같이
                mark.config(fg=color)

        for w in parts:
            w.bind("<Button-1>", lambda e: self.pick(d))
            if not sel:
                w.bind("<Enter>", lambda e: paint(C["btn_hi"]))
                w.bind("<Leave>", lambda e: paint(bg))
        return f


class DeadlineDialog(tk.Toplevel):
    """마감 일정 목록 + 추가/삭제."""

    def __init__(self, app, group=None):
        super().__init__(app)
        self.app, self.group = app, group
        self.pick = app.today + timedelta(days=7)
        self.title("마감 일정")
        self.configure(bg=C["bg"], padx=18, pady=16)
        self.resizable(False, False)
        self.transient(app)
        if app.attributes("-topmost"):
            self.attributes("-topmost", True)

        head = "새 마감" + (f"  ·  '{group}'에 연결됨" if group else "")
        tk.Label(self, text=head, font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"],
                 anchor="w").pack(fill="x", pady=(0, 4))
        form = tk.Frame(self, bg=C["bg"])
        form.pack(fill="x")
        self.title_e = app._field(form, width=22)
        self.title_e.pack(side="left", fill="x", expand=True, ipady=6, ipadx=6)
        self.title_e.bind("<Return>", lambda e: self.add())
        self.date_btn = app._button(form, "", self.pick_date, font=(FONT, 10))
        self.date_btn.pack(side="left", padx=(6, 0), fill="y")
        app._button(form, "추가", self.add, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                    activebackground=C["moss_hi"], activeforeground=C["ink"],
                    font=(FONT, 10, "bold"), padx=14).pack(side="left", padx=(6, 0), fill="y")
        self._update_date_btn()

        tk.Label(self, text="등록된 마감", font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"],
                 anchor="w").pack(fill="x", pady=(16, 4))
        self.list_f = tk.Frame(self, bg=C["bg"])
        self.list_f.pack(fill="x")
        # 지난 마감: 기본은 숨김 (일정표·달력에서도 같이 적용)
        self.past_f = tk.Frame(self, bg=C["bg"])
        self.past_f.pack(fill="x", pady=(8, 0))
        self.hide_past = tk.BooleanVar(value=app.settings.get("hide_past_deadlines", True))
        self.hide_past.trace_add("write", lambda *_: self._set_hide_past())
        tk.Label(self, text="Enter 추가 · Esc 닫기", font=(FONT, 8), bg=C["bg"], fg=C["faint"],
                 anchor="w").pack(fill="x", pady=(10, 0))
        self.bind("<Escape>", lambda e: self.destroy())
        self.draw_list()

        self.update_idletasks()
        x = app.winfo_rootx() + (app.winfo_width() - self.winfo_width()) // 2
        self.geometry(f"+{max(0, x)}+{app.winfo_rooty() + app._s(60)}")
        app._window_chrome(self)
        self.title_e.focus_set()

    def _update_date_btn(self):
        d = self.pick
        self.date_btn.config(text=f"{d.month}/{d.day} ({WEEKDAYS[d.weekday()]}) ▾")

    def pick_date(self):
        CalendarPopup(self.app, self.date_btn, self.pick, self._set_date)

    def _set_date(self, d):
        self.pick = d
        self._update_date_btn()
        self.title_e.focus_set()

    def add(self):
        title = self.title_e.get().strip()
        if not title:
            self.title_e.focus_set()
            return
        self.app.deadlines.append({"id": uuid.uuid4().hex, "title": title, "date": self.pick.isoformat(),
                                   "group": self.group})
        self.app.save_deadlines()
        self.app.refresh()
        self.title_e.delete(0, "end")
        self.draw_list()

    def delete(self, dl):
        self.app.deadlines.remove(dl)
        self.app.save_deadlines()
        self.app.refresh()
        self.draw_list()

    def _set_hide_past(self):
        self.app.settings["hide_past_deadlines"] = self.hide_past.get()
        self.app._save_settings()
        self.app._redraw_schedule()
        self.draw_list()

    def clear_past(self):
        past = [d for d in self.app.deadlines if d["date"] < self.app.today.isoformat()]
        if past and messagebox.askyesno("지난 마감 지우기", f"지난 마감 {len(past)}개를 모두 지울까요?", parent=self):
            for d in past:
                self.app.deadlines.remove(d)
            self.app.save_deadlines()
            self.app.refresh()
            self.draw_list()

    def draw_list(self):
        for w in self.list_f.winfo_children() + self.past_f.winfo_children():
            w.destroy()
        today = self.app.today.isoformat()
        past = [d for d in self.app.deadlines if d["date"] < today]
        shown = [d for d in self.app.deadlines if not (self.hide_past.get() and d["date"] < today)]
        if not shown:
            tk.Label(self.list_f, text="다가오는 마감이 없어요", font=(FONT, 9), bg=C["bg"],
                     fg=C["faint"], anchor="w").pack(fill="x", pady=4)
        if past:
            CheckRow(self.past_f, self.app, f"지난 마감 숨기기 ({len(past)}개)", self.hide_past,
                     font=(FONT, 9)).pack(side="left")
            self.app._button(self.past_f, "지난 마감 모두 지우기", self.clear_past, font=(FONT, 9), pady=2,
                             fg=C["danger"], hover=C["danger_bg"]).pack(side="right")
        for dl in sorted(shown, key=lambda d: d["date"]):
            d = date.fromisoformat(dl["date"])
            n = (d - self.app.today).days
            bg, fg = dday_colors(n)
            row = tk.Frame(self.list_f, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
            row.pack(fill="x", pady=(0, 4))
            tk.Label(row, text=dday_text(n), width=6, font=(FONT, 9, "bold"), bg=bg, fg=fg,
                     pady=3).pack(side="left", fill="y")
            self.app._button(row, "✕", lambda dl=dl: self.delete(dl), bg=C["card"], fg=C["faint"],
                             hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
            tk.Label(row, text=f"{d:%Y.%m.%d} ({WEEKDAYS[d.weekday()]})", font=(FONT, 9), bg=C["card"],
                     fg=C["muted"]).pack(side="right", padx=6)
            col = tk.Frame(row, bg=C["card"])
            col.pack(side="left", fill="x", expand=True, padx=8)
            tk.Label(col, text=dl["title"], anchor="w", font=(FONT, 10), bg=C["card"],
                     fg=C["faint"] if n < 0 else C["text"]).pack(fill="x")
            if dl.get("group"):
                tk.Label(col, text=f"↳ {dl['group']}", anchor="w", font=(FONT, 8), bg=C["card"],
                         fg=C["faint"]).pack(fill="x")


class Dialog(tk.Toplevel):
    """관리 창 공통: 테마 색, 위젯 옆 위치, Esc로 닫기."""

    def __init__(self, app, title):
        super().__init__(app)
        self.app = app
        self.title(title)
        self.configure(bg=C["bg"], padx=18, pady=16)
        self.resizable(False, False)
        self.transient(app)
        if app.attributes("-topmost"):
            self.attributes("-topmost", True)
        self.bind("<Escape>", lambda e: self.close())
        self.protocol("WM_DELETE_WINDOW", self.close)

    def close(self):
        self.destroy()

    def section(self, text, top=14, parent=None):
        tk.Label(parent or self, text=text, font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"],
                 anchor="w").pack(fill="x", pady=(top, 4))

    def hint(self, text, parent=None):
        tk.Label(parent or self, text=text, font=(FONT, 8), bg=C["bg"], fg=C["faint"], anchor="w",
                 justify="left").pack(fill="x")

    def primary(self, parent, text, cmd, **kw):
        return self.app._button(parent, text, cmd, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                                activebackground=C["moss_hi"], activeforeground=C["ink"],
                                font=(FONT, 10, "bold"), padx=14, **kw)

    def finish(self, focus=None, anchor=None):
        app = self.app
        base = anchor or app  # 이 창을 띄운 창(기본은 위젯) 위에 위치
        self.update_idletasks()
        x = base.winfo_rootx() + (base.winfo_width() - self.winfo_width()) // 2
        y = base.winfo_rooty() + app._s(40)
        # 위젯이 화면 가장자리에 있어도 창이 화면 밖으로 나가지 않게
        x = min(max(0, x), self.winfo_screenwidth() - self.winfo_width())
        y = max(0, min(y, self.winfo_screenheight() - self.winfo_height() - app._s(60)))
        self.geometry(f"+{x}+{y}")
        app._window_chrome(self)
        if focus:
            focus.focus_set()


class CheckRow(tk.Frame):
    """테마에 맞춘 체크박스 (기본 체크박스는 고배율 화면에서 너무 작게 나옴)."""

    def __init__(self, parent, app, text, var, bg=None, font=(FONT, 10)):
        bg = bg or C["bg"]
        super().__init__(parent, bg=bg, cursor="hand2")
        self.var, self.size = var, app._s(16)
        self.box = tk.Canvas(self, width=self.size, height=self.size, bg=bg, highlightthickness=0, cursor="hand2")
        self.box.pack(side="left", padx=(0, 6))
        label = tk.Label(self, text=text, font=font, bg=bg, fg=C["text"], anchor="w", cursor="hand2")
        label.pack(side="left", fill="x")
        for w in (self, self.box, label):
            w.bind("<Button-1>", lambda e: var.set(not var.get()))
        var.trace_add("write", lambda *_: self.draw())
        self.draw()

    def draw(self):
        try:
            c, s, on = self.box, self.size, self.var.get()
            k = s / 16
            c.delete("all")
            c.create_rectangle(1, 1, s - 1, s - 1, width=max(1, 1.5 * k),
                               fill=C["moss"] if on else C["card"], outline=C["moss"] if on else C["muted"])
            if on:
                c.create_line(4 * k, 8.5 * k, 7 * k, 11.5 * k, 12.5 * k, 5 * k, fill=C["ink"], width=2 * k,
                              capstyle="round", joinstyle="round")
        except tk.TclError:  # 창이 닫힌 뒤
            pass


class AwayDialog(Dialog):
    """타이머가 켜진 채 자리를 비웠을 때: 그 시간을 뺄지 물어봄."""

    def __init__(self, app, since, reason, running):
        super().__init__(app, "타이머 확인")
        self.choice = "keep"
        self.attributes("-topmost", True)  # 위젯이 뒤에 있어도 보이게
        away = time.time() - since
        start = datetime.fromtimestamp(since)
        when = f"{start:%H:%M}" if start.date() == date.today() else f"{start.month}/{start.day} {start:%H:%M}"
        tk.Label(self, text="타이머가 켜져 있었어요", font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"],
                 anchor="w").pack(fill="x")
        tk.Label(self, text=f"{when}부터 {fmt_hm(away)} — {reason}", font=(FONT, 10), bg=C["bg"],
                 fg=C["muted"], anchor="w").pack(fill="x", pady=(2, 0))
        self.section("켜져 있던 타이머")
        for t in running:
            row = tk.Frame(self, bg=C["card"], highlightthickness=1, highlightbackground=C["sun"])
            row.pack(fill="x", pady=(0, 3))
            tk.Label(row, text=fmt(elapsed(t)), font=(MONO, 10, "bold"), bg=C["card"],
                     fg=C["sun_text"]).pack(side="right", padx=8)
            tk.Label(row, text=t["title"], font=(FONT, 10), bg=C["card"], fg=C["text"], anchor="w",
                     pady=4).pack(side="left", fill="x", expand=True, padx=8)
        self.hint(f"빼면 {when}에 멈춘 것으로 기록돼요.")
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(12, 0))
        self.primary(btns, "그 시간 빼고 계속", lambda: self.pick("cut")).pack(side="left")
        app._button(btns, "빼고 멈추기", lambda: self.pick("cut_stop"), padx=12).pack(side="left", padx=(6, 0))
        app._button(btns, "모두 포함", lambda: self.pick("keep"), padx=12).pack(side="left", padx=(6, 0))
        app.bell()
        self.finish()
        self.lift()
        self.focus_force()

    def pick(self, choice):
        self.choice = choice
        self.destroy()


class EventDialog(Dialog):
    """일정 수정: 시간 · 제목 · 날짜, 삭제."""

    def __init__(self, app, day, ev, anchor=None):
        super().__init__(app, "일정")
        self.anchor = anchor
        if anchor:  # 일정표에서 열면 일정표 위에 뜨게
            self.transient(anchor)
            self.attributes("-topmost", True)
        self.day, self.ev, self.pick = day, ev, day
        self.section("시간 · 제목   (시간을 비우면 '시간 미정')", top=0)
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x")
        self.time_e = app._field(row, width=6, justify="center")
        self.time_e.insert(0, ev["time"])
        self.time_e.pack(side="left", ipady=6)
        self.title_e = app._field(row, width=26)
        self.title_e.insert(0, ev["title"])
        self.title_e.pack(side="left", fill="x", expand=True, padx=(6, 0), ipady=6, ipadx=6)
        self.section("날짜")
        self.date_btn = app._button(self, "", self.pick_date, font=(FONT, 10))
        self.date_btn.pack(anchor="w")
        self._update_date_btn()
        self.error = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["danger"], anchor="w")
        self.error.pack(fill="x", pady=(8, 0))
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(4, 0))
        self.primary(btns, "저장", self.save).pack(side="right")
        app._button(btns, "취소", self.close, padx=14).pack(side="right", padx=(0, 8))
        app._button(btns, "삭제", self.delete, fg=C["danger"], hover=C["danger_bg"], padx=14).pack(side="left")
        for w in (self.time_e, self.title_e):
            w.bind("<Return>", lambda e: self.save())
        self.finish(self.title_e, anchor)

    def _update_date_btn(self):
        d = self.pick
        self.date_btn.config(text=f"{d.month}월 {d.day}일 ({WEEKDAYS[d.weekday()]}) ▾")

    def pick_date(self):
        CalendarPopup(self.app, self.date_btn, self.pick, self._set_date)

    def _set_date(self, d):
        self.pick = d
        self._update_date_btn()

    def save(self):
        raw_time = self.time_e.get().strip()
        parsed = parse_event(f"{raw_time} x") if raw_time else ("", "")  # 비우면 시간 미정
        title = self.title_e.get().strip()
        if not parsed:
            self.error.config(text="시간은 13:30 처럼 적어 주세요. 비우면 시간 미정이에요.")
            return
        if not title:
            self.error.config(text="제목을 입력해 주세요.")
            return
        a, ev = self.app, self.ev
        if parsed[0] != ev["time"] or self.pick != self.day:
            ev["reminded"] = False  # 시간이 바뀌면 다시 알림
        ev.update(time=parsed[0], title=title)
        if self.pick != self.day:
            a.events[self.day.isoformat()].remove(ev)
            a.events.setdefault(self.pick.isoformat(), []).append(ev)
        a.save_events()
        a.render_events()
        self.destroy()

    def delete(self):
        self.app.delete_event(self.day, self.ev)
        self.destroy()


class Toast(tk.Toplevel):
    """화면 오른쪽 아래에 잠깐 뜨는 알림."""

    def __init__(self, app, title, body="", action=None):
        super().__init__(app)
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(bg=C["moss"])
        box = tk.Frame(self, bg=C["card"], padx=14, pady=10)
        box.pack(padx=(app._s(4), 1), pady=1)
        tk.Label(box, text="❦ Daily Todo", font=(FONT, 8), bg=C["card"], fg=C["faint"], anchor="w").pack(fill="x")
        tk.Label(box, text=title, font=(FONT, 11, "bold"), bg=C["card"], fg=C["text"], anchor="w").pack(fill="x")
        if body:
            tk.Label(box, text=body, font=(FONT, 9), bg=C["card"], fg=C["muted"], anchor="w", justify="left",
                     wraplength=app._s(280)).pack(fill="x", pady=(2, 0))
        row = tk.Frame(box, bg=C["card"])
        row.pack(fill="x", pady=(8, 0))
        app._button(row, "닫기", self.destroy, font=(FONT, 9), pady=2).pack(side="right")
        if action:
            label, fn = action
            app._button(row, label, lambda: (self.destroy(), fn()), bg=C["moss"], fg=C["ink"],
                        hover=C["moss_hi"], activebackground=C["moss_hi"], activeforeground=C["ink"],
                        font=(FONT, 9, "bold"), pady=2).pack(side="right", padx=(0, 6))
        self.update_idletasks()
        _, _, right, bottom = work_area(self)
        self.geometry(f"+{right - self.winfo_reqwidth() - app._s(16)}+{bottom - self.winfo_reqheight() - app._s(16)}")
        self.after(12000, self._close)

    def _close(self):
        try:
            self.destroy()
        except tk.TclError:
            pass


class MoodPicker(tk.Frame):
    """표정 5단계. 같은 표정을 다시 누르면 해제."""

    def __init__(self, parent, app, get_day, bg, size=18, show_name=True):
        super().__init__(parent, bg=bg)
        self.app, self.get_day, self.size = app, get_day, app._s(size)
        self.name = tk.Label(self, font=(FONT, 8), bg=bg, fg=C["faint"])
        if show_name:
            self.name.pack(side="left", padx=(0, 4))
        self.cells = []
        for level, _, _ in MOODS:
            c = tk.Canvas(self, width=self.size, height=self.size, bg=bg, highlightthickness=0, cursor="hand2")
            c.pack(side="left", padx=1)
            c.bind("<Button-1>", lambda e, lv=level: self.pick(lv))
            c.bind("<Enter>", lambda e, lv=level: self.draw(hover=lv))
            c.bind("<Leave>", lambda e: self.draw())
            self.cells.append(c)
        self.draw()

    def pick(self, level):
        iso = self.get_day().isoformat()
        self.app.set_mood(iso, None if self.app.moods.get(iso) == level else level)
        self.draw()

    def draw(self, hover=None):
        cur = self.app.moods.get(self.get_day().isoformat())
        shown = hover or cur
        self.name.config(text=MOODS[shown - 1][1] if shown else "기분")
        for c, (level, _, color) in zip(self.cells, MOODS):
            c.delete("all")
            active = level in (cur, hover)
            draw_face(c, 0, 0, self.size, level, color if active else C["faint"], level == cur, C["ink"])


class HabitBar(tk.Frame):
    """습관 칩 (클릭하면 그날 체크). 폭에 맞춰 줄바꿈."""

    def __init__(self, parent, app, get_day, bg=None):
        super().__init__(parent, bg=bg or C["bg"], height=1)
        self.app, self.get_day, self.bg = app, get_day, bg or C["bg"]
        self.chips = []
        self._width = 0
        self.bind("<Configure>", self._on_resize)
        self.draw()

    def _on_resize(self, e):
        if e.width != self._width:
            self._width = e.width
            self._layout()

    def _toggle(self, hid):
        self.app.toggle_habit(self.get_day().isoformat(), hid)
        self.draw()

    def draw(self):
        for c in self.chips:
            c.destroy()
        self.chips = []
        day = self.get_day()
        done = set(self.app.habits["log"].get(day.isoformat(), []))
        for h in self.app.habits["habits"]:
            on = h["id"] in done
            streak = self.app.habit_streak(h["id"], day)
            text = ("✓ " if on else "") + h["name"] + (f" · {streak}일" if streak >= 2 else "")
            chip = tk.Label(self, text=text, font=(FONT, 9, "bold" if on else "normal"), padx=8, pady=2,
                            bg=C["moss"] if on else C["btn"], fg=C["ink"] if on else C["text"], cursor="hand2")
            chip.bind("<Button-1>", lambda e, hid=h["id"]: self._toggle(hid))
            self.chips.append(chip)
        add = tk.Label(self, text="+ 습관" if self.app.habits["habits"] else "+ 습관 추가 (운동, 독서 …)",
                       font=(FONT, 9), bg=self.bg, fg=C["muted"], padx=6, pady=2, cursor="hand2")
        add.bind("<Button-1>", lambda e: self.app.open_habits())
        self.chips.append(add)
        self._layout()

    def _layout(self):
        self.update_idletasks()
        width = self.winfo_width() if self.winfo_width() > 1 else self.app._s(360)
        gap = self.app._s(4)
        x = y = row_h = 0
        for c in self.chips:
            cw, ch = c.winfo_reqwidth(), c.winfo_reqheight()
            if x and x + cw > width:
                x, y, row_h = 0, y + row_h + gap, 0
            c.place(x=x, y=y)
            x += cw + gap
            row_h = max(row_h, ch)
        self.config(height=y + row_h)


class HabitDialog(Dialog):
    def __init__(self, app):
        super().__init__(app, "습관 관리")
        self.section("새 습관", top=0)
        form = tk.Frame(self, bg=C["bg"])
        form.pack(fill="x")
        self.entry = app._field(form, width=26)
        self.entry.pack(side="left", fill="x", expand=True, ipady=6, ipadx=6)
        self.entry.bind("<Return>", lambda e: self.add())
        self.primary(form, "추가", self.add).pack(side="left", padx=(6, 0), fill="y")
        self.hint("매일 체크할 작은 습관 (예: 운동, 독서 20쪽, 물 2L). 체크는 일기 칸 위의 칩을 눌러요.")
        self.section("등록된 습관")
        self.list_f = tk.Frame(self, bg=C["bg"])
        self.list_f.pack(fill="x")
        self.draw()
        self.finish(self.entry)

    def add(self):
        name = self.entry.get().strip()
        if name:
            self.app.habits["habits"].append({"id": uuid.uuid4().hex, "name": name})
            self.app.save_habits()
            self.entry.delete(0, "end")
            self.draw()

    def delete(self, h):
        if messagebox.askyesno("삭제", f"'{h['name']}' 습관을 삭제할까요?\n(지난 체크 기록은 통계에서 사라져요)",
                               parent=self):
            self.app.habits["habits"].remove(h)
            self.app.save_habits()
            self.draw()

    def draw(self):
        for w in self.list_f.winfo_children():
            w.destroy()
        if not self.app.habits["habits"]:
            self.hint("아직 등록된 습관이 없어요", self.list_f)
        week = [(self.app.today - timedelta(days=i)).isoformat() for i in range(7)]
        for h in self.app.habits["habits"]:
            n = sum(h["id"] in self.app.habits["log"].get(d, []) for d in week)
            row = tk.Frame(self.list_f, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
            row.pack(fill="x", pady=(0, 4))
            self.app._button(row, "✕", lambda h=h: self.delete(h), bg=C["card"], fg=C["faint"],
                             hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
            tk.Label(row, text=f"최근 7일 {n}/7 · 연속 {self.app.habit_streak(h['id'], self.app.today)}일",
                     font=(FONT, 9), bg=C["card"], fg=C["muted"]).pack(side="right", padx=6)
            tk.Label(row, text=h["name"], font=(FONT, 10), bg=C["card"], fg=C["text"], anchor="w",
                     pady=4).pack(side="left", fill="x", expand=True, padx=8)


class GoalDialog(Dialog):
    """마감 없는 큰 목표: 연결된 할 일의 시간이 계속 쌓임."""

    def __init__(self, app):
        super().__init__(app, "큰 목표")
        self.section("새 목표", top=0)
        form = tk.Frame(self, bg=C["bg"])
        form.pack(fill="x")
        self.title_e = app._field(form, width=22)
        self.title_e.pack(side="left", fill="x", expand=True, ipady=6, ipadx=6)
        self.hours_e = app._field(form, width=6)
        self.hours_e.pack(side="left", padx=(6, 0), ipady=6, ipadx=4)
        tk.Label(form, text="시간", font=(FONT, 9), bg=C["bg"], fg=C["muted"]).pack(side="left", padx=(4, 0))
        self.primary(form, "추가", self.add).pack(side="left", padx=(6, 0), fill="y")
        for w in (self.title_e, self.hours_e):
            w.bind("<Return>", lambda e: self.add())
        self.hint("예: 코테 준비 / 목표 시간은 비워 둬도 돼요 (예: 100)\n"
                  "같은 이름의 할 일·묶음 시간이 자동으로 쌓여요. 다른 이름은 할 일 우클릭 → '목표에 연결'.")
        self.error = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["danger"], anchor="w")
        self.error.pack(fill="x")
        self.section("목표", top=8)
        self.list_f = tk.Frame(self, bg=C["bg"])
        self.list_f.pack(fill="x")
        self.draw()
        self.finish(self.title_e)

    def add(self):
        title, hours = self.title_e.get().strip(), self.hours_e.get().strip()
        if not title:
            return
        if hours and not (hours.isdigit() and int(hours) > 0):
            self.error.config(text="목표 시간은 1 이상의 숫자(시간)로 적어 주세요.")
            return
        if any(g["title"] == title for g in self.app.goals):
            self.error.config(text="같은 이름의 목표가 이미 있어요.")
            return
        self.error.config(text="")
        self.app.add_goal(title, int(hours) if hours else None)
        self.title_e.delete(0, "end")
        self.hours_e.delete(0, "end")
        self.draw()

    def delete(self, g):
        if messagebox.askyesno("삭제", f"'{g['title']}' 목표를 삭제할까요?\n(할 일과 시간 기록은 그대로 남아요)",
                               parent=self):
            self.app.goals.remove(g)
            self.app.save_goals()
            self.draw()

    def unlink(self, g, title):
        g["titles"].remove(title)
        self.app.save_goals()
        self.draw()

    def draw(self):
        a = self.app
        for w in self.list_f.winfo_children():
            w.destroy()
        if not a.goals:
            self.hint("아직 목표가 없어요", self.list_f)
        week_ago = (a.today - timedelta(days=6)).isoformat()
        for g in a.goals:
            total = goal_seconds(g, a.store.data)
            week = goal_seconds(g, a.store.data, since=week_ago)
            card = tk.Frame(self.list_f, bg=C["card"], highlightthickness=1, highlightbackground=C["border"],
                            padx=10, pady=8)
            card.pack(fill="x", pady=(0, 6))
            top = tk.Frame(card, bg=C["card"])
            top.pack(fill="x")
            a._button(top, "✕", lambda g=g: self.delete(g), bg=C["card"], fg=C["faint"], hover=C["danger_bg"],
                      padx=6, font=(FONT, 9)).pack(side="right")
            tk.Label(top, text=g["title"], font=(FONT, 11, "bold"), bg=C["card"], fg=C["text"],
                     anchor="w").pack(side="left", fill="x", expand=True)
            target = g.get("target_hours")
            info = f"누적 {fmt_hours(total)}" + (f" / {target}시간" if target else "") + \
                   f"  ·  최근 7일 {fmt_hours(week)}  ·  {g.get('created', '')[5:].replace('-', '/')} 시작"
            tk.Label(card, text=info, font=(FONT, 9), bg=C["card"], fg=C["muted"], anchor="w").pack(fill="x")
            if target:
                bar = tk.Canvas(card, width=a._s(380), height=a._s(5), bg=C["btn"], highlightthickness=0)
                bar.pack(fill="x", pady=(4, 2))
                bar.create_rectangle(0, 0, a._s(380) * min(1, total / 3600 / target), a._s(5),
                                     fill=C["moss"], width=0)
            links = tk.Frame(card, bg=C["card"])
            links.pack(fill="x", pady=(4, 0))
            tk.Label(links, text="연결:", font=(FONT, 8), bg=C["card"], fg=C["faint"]).pack(side="left")
            tk.Label(links, text=g["title"], font=(FONT, 8), bg=C["btn"], fg=C["text"],
                     padx=5).pack(side="left", padx=(4, 0))
            for title in g.get("titles", []):
                chip = tk.Label(links, text=f"{title}  ✕", font=(FONT, 8), bg=C["btn"], fg=C["text"],
                                padx=5, cursor="hand2")
                chip.pack(side="left", padx=(4, 0))
                chip.bind("<Button-1>", lambda e, g=g, t=title: self.unlink(g, t))


class ReviewDialog(Dialog):
    """하루 마무리: 한 일 요약 → 남은 일 내일로 → 습관 · 기분 · 한 줄 회고."""

    def __init__(self, app, day):
        super().__init__(app, "오늘 정리하기")
        self.day, self.iso = day, day.isoformat()
        tasks = self.tasks = app.store.tasks(day)
        by_id = {t["id"]: t for t in tasks}
        parent_ids = {t.get("parent") for t in tasks}
        leaves = [t for t in tasks if t["id"] not in parent_ids]
        tops = [t for t in tasks if t.get("parent") not in by_id]

        tk.Label(self, text=f"{day.month}월 {day.day}일 {WEEKDAYS[day.weekday()]}요일 정리",
                 font=(FONT, 14, "bold"), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")
        total = sum(elapsed(t) for t in tasks)
        pomos = sum(t.get("pomos", 0) for t in tasks)
        kpi = f"완료 {sum(t['done'] for t in leaves)}/{len(leaves)}  ·  {fmt_hm(total)} 기록"
        if pomos:
            kpi += f"  ·  뽀모 {pomos}회"
        tk.Label(self, text=kpi, font=(FONT, 10), bg=C["bg"], fg=C["muted"], anchor="w").pack(fill="x")

        self.section("한 일")
        worked = []
        for t in tops:
            kids = children(t, tasks)
            secs = total_time(t, tasks)
            if kids and (secs >= 60 or any(c["done"] for c in kids)):
                worked.append((f"▸ {t['title']}", f"{sum(c['done'] for c in kids)}/{len(kids)} · {fmt_hm(secs)}"))
            elif not kids and (t["done"] or secs >= 60):
                worked.append((("✓ " if t["done"] else "○ ") + t["title"], fmt_hm(secs)))
        if not worked:
            self.hint("기록된 일이 없어요")
        for left, right in worked[:6]:
            row = tk.Frame(self, bg=C["bg"])
            row.pack(fill="x")
            tk.Label(row, text=right, font=(FONT, 9), bg=C["bg"], fg=C["muted"]).pack(side="right")
            tk.Label(row, text=left, font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")
        if len(worked) > 6:
            self.hint(f"외 {len(worked) - 6}개")

        undone = [t for t in leaves if not t["done"]]
        self.carry = []
        if undone:
            self.section("내일로 넘길 일")
            for t in undone[:8]:
                label = f"{by_id[t['parent']]['title']} › {t['title']}" if t.get("parent") in by_id else t["title"]
                var = tk.BooleanVar(value=True)
                CheckRow(self, app, label, var).pack(fill="x", pady=1)
                self.carry.append((t, var))
            if len(undone) > 8:
                self.hint(f"외 {len(undone) - 8}개는 그대로 둬요")

        self.section("습관")
        HabitBar(self, app, lambda: day).pack(fill="x")
        self.section("기분")
        MoodPicker(self, app, lambda: day, bg=C["bg"], size=26).pack(anchor="w")
        self.section("한 줄 회고")
        self.text = app._field(self, tk.Text, height=4, width=46, wrap="word", font=(FONT, 10),
                               padx=10, pady=8, undo=True)
        self.text.insert("1.0", app.journal.get(self.iso, ""))
        self.text.pack(fill="x")

        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(12, 0))
        self.primary(btns, "정리 완료", self.done).pack(side="right")
        app._button(btns, "나중에", self.close, padx=14).pack(side="right", padx=(0, 8))
        self.finish(self.text)

    def done(self):
        a = self.app
        a.set_journal(self.iso, self.text.get("1.0", "end-1c").strip())
        dst = a.store.tasks(self.day + timedelta(days=1))
        moved = 0
        for t, var in self.carry:
            if var.get():
                stop(t)
                a.store.copy_task(t, self.tasks, dst)
                moved += 1
        a.settings["reviewed"] = self.iso
        a._save_settings()
        a.refresh()
        self.destroy()
        a.notify("오늘 정리 완료", f"내일로 {moved}개 넘겼어요. 수고했어요!" if moved else "수고했어요!")


class SettingsDialog(Dialog):
    MODIFIER_KEYS = {"Control_L", "Control_R", "Alt_L", "Alt_R", "Shift_L", "Shift_R",
                     "Win_L", "Win_R", "Meta_L", "Meta_R", "Super_L", "Super_R"}

    def __init__(self, app):
        super().__init__(app, "설정")
        s = app.settings
        if app.hotkeys:
            app.hotkeys.stop()  # 키 조합을 입력받는 동안 기존 단축키가 가로채지 않게
        saved = s.get("hotkeys", DEFAULT_HOTKEYS)
        self.keys = {a: saved.get(a) for a, _ in HOTKEY_ACTIONS}
        self.capturing = None

        self.section("전역 단축키", top=0)
        self.hint("다른 프로그램을 쓰는 중에도 동작해요. 버튼을 누른 뒤 원하는 키 조합을 눌러요.")
        self.key_btns = {}
        for action, label in HOTKEY_ACTIONS:
            row = tk.Frame(self, bg=C["bg"])
            row.pack(fill="x", pady=(4, 0))
            app._button(row, "✕", lambda a=action: self.set_key(a, None), bg=C["bg"], fg=C["faint"],
                        hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
            b = app._button(row, "", lambda a=action: self.capture(a), width=16, font=(FONT, 10))
            b.pack(side="right")
            self.key_btns[action] = b
            tk.Label(row, text=label, font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(side="left")
            self._show_key(action)

        self.section("뽀모도로")
        self.pomo_on = tk.BooleanVar(value=s.get("pomo_on", False))
        CheckRow(self, app, "타이머를 켜면 뽀모도로로 진행 (집중 → 휴식 알림)", self.pomo_on).pack(fill="x")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x", pady=(4, 0))
        self.pomo_e = {}
        for key, pre, post in (("pomo_focus", "집중", "분"), ("pomo_break", "휴식", "분"),
                               ("pomo_long", "긴 휴식", "분"), ("pomo_every", "", "회마다")):
            if pre:
                tk.Label(row, text=pre, font=(FONT, 9), bg=C["bg"], fg=C["muted"]).pack(side="left", padx=(0, 3))
            e = app._field(row, width=3, justify="center", font=(FONT, 10))
            e.insert(0, str(s.get(key, POMO_DEFAULTS[key])))
            e.pack(side="left", ipady=3)
            tk.Label(row, text=post, font=(FONT, 9), bg=C["bg"], fg=C["muted"]).pack(side="left", padx=(3, 10))
            self.pomo_e[key] = e

        self.section("하루 정리 알림")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x")
        self.review_on = tk.BooleanVar(value=s.get("review_on", True))
        CheckRow(row, app, "매일 이 시간에 '오늘 정리하기' 알림", self.review_on).pack(side="left")
        self.review_e = app._field(row, width=6, justify="center", font=(FONT, 10))
        self.review_e.insert(0, s.get("review_time", "22:00"))
        self.review_e.pack(side="left", padx=(8, 0), ipady=3)

        self.section("상단에 표시")
        self.hint("끄면 버튼까지 숨겨져요. 켜 둔 항목은 날짜 아래 버튼으로 펼치고 접을 수 있어요.")
        self.shown = {}
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x", pady=(2, 0))
        for name, label in SECTIONS:
            self.shown[name] = tk.BooleanVar(value=app.section_cfg(name)["show"])
            CheckRow(row, app, label.split(" (")[0], self.shown[name]).pack(side="left", padx=(0, 14))

        self.section("일정 알림")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x")
        self.event_on = tk.BooleanVar(value=s.get("event_remind_on", True))
        CheckRow(row, app, "일정 시작", self.event_on).pack(side="left")
        self.event_e = app._field(row, width=3, justify="center", font=(FONT, 10))
        self.event_e.insert(0, str(s.get("event_remind", 10)))
        self.event_e.pack(side="left", padx=(8, 3), ipady=3)
        tk.Label(row, text="분 전에 알림", font=(FONT, 10), bg=C["bg"], fg=C["text"]).pack(side="left")

        self.section("타이머")
        self.single = tk.BooleanVar(value=app.single_var.get())
        CheckRow(self, app, "타이머는 한 번에 하나만 실행", self.single).pack(fill="x")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x", pady=(4, 0))
        self.idle_on = tk.BooleanVar(value=s.get("idle_on", True))
        CheckRow(row, app, "켜진 채로 입력이 없으면", self.idle_on).pack(side="left")
        self.idle_e = app._field(row, width=3, justify="center", font=(FONT, 10))
        self.idle_e.insert(0, str(s.get("idle_min", 10)))
        self.idle_e.pack(side="left", padx=(8, 3), ipady=3)
        tk.Label(row, text="분 뒤 물어보기 (절전·재부팅 포함)", font=(FONT, 10), bg=C["bg"],
                 fg=C["text"]).pack(side="left")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x", pady=(4, 0))
        self.long_on = tk.BooleanVar(value=s.get("long_on", True))
        CheckRow(row, app, "한 타이머가", self.long_on).pack(side="left")
        self.long_e = app._field(row, width=3, justify="center", font=(FONT, 10))
        self.long_e.insert(0, str(s.get("long_hours", 2)))
        self.long_e.pack(side="left", padx=(8, 3), ipady=3)
        tk.Label(row, text="시간 넘게 켜져 있으면 알림", font=(FONT, 10), bg=C["bg"],
                 fg=C["text"]).pack(side="left")

        self.error = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["danger"], anchor="w", justify="left")
        self.error.pack(fill="x", pady=(8, 0))
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(6, 0))
        self.primary(btns, "저장", self.save).pack(side="right")
        app._button(btns, "취소", self.close, padx=14).pack(side="right", padx=(0, 8))
        self.bind("<KeyPress>", self._on_key)
        self.bind("<Escape>", self._on_key)  # 입력 중 Esc 는 입력 취소, 아니면 창 닫기
        self.finish()

    def _show_key(self, action):
        k = self.keys.get(action)
        self.key_btns[action].config(text=k["label"] if k else "없음", bg=C["btn"])

    def set_key(self, action, value):
        self.keys[action] = value
        self.capturing = None
        self._show_key(action)

    def capture(self, action):
        if self.capturing:
            self._show_key(self.capturing)
        self.capturing = action
        self.key_btns[action].config(text="키 조합을 누르세요…", bg=C["sun_hi"])
        self.error.config(text="")
        self.focus_set()

    def _on_key(self, e):
        if not self.capturing:
            if e.keysym == "Escape":
                self.close()
            return None
        if e.keysym == "Escape":
            self._show_key(self.capturing)
            self.capturing = None
            return "break"
        if e.keysym in self.MODIFIER_KEYS:
            return "break"
        down = lambda vk: ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000
        mods, names = 0, []
        for vk, bit, name in ((0x11, 2, "Ctrl"), (0x12, 1, "Alt"), (0x10, 4, "Shift")):
            if down(vk):
                mods |= bit
                names.append(name)
        if down(0x5B) or down(0x5C):
            mods |= 8
            names.append("Win")
        if not mods & (1 | 2 | 8):
            self.error.config(text="Ctrl, Alt, Win 중 하나와 함께 눌러 주세요.")
            return "break"
        key = e.keysym.upper() if len(e.keysym) == 1 else e.keysym
        # Windows에서 Tk의 keycode는 가상 키 코드(VK)와 같음
        self.set_key(self.capturing, {"mods": mods, "vk": e.keycode, "label": "+".join(names + [key])})
        return "break"

    def save(self):
        vals = {}
        for key, e in self.pomo_e.items():
            v = e.get().strip()
            if not (v.isdigit() and 1 <= int(v) <= 180):
                self.error.config(text="뽀모도로 시간은 1~180 사이 숫자로 적어 주세요.")
                return
            vals[key] = int(v)
        ev_min = self.event_e.get().strip()
        if not (ev_min.isdigit() and 1 <= int(ev_min) <= 180):
            self.error.config(text="일정 알림은 1~180분 사이로 적어 주세요.")
            return
        vals.update(event_remind=int(ev_min), event_remind_on=self.event_on.get())
        idle, long_h = self.idle_e.get().strip(), self.long_e.get().strip()
        if not (idle.isdigit() and 1 <= int(idle) <= 240):
            self.error.config(text="입력 없음 확인은 1~240분 사이로 적어 주세요.")
            return
        if not (long_h.isdigit() and 1 <= int(long_h) <= 24):
            self.error.config(text="장시간 알림은 1~24시간 사이로 적어 주세요.")
            return
        vals.update(idle_on=self.idle_on.get(), idle_min=int(idle), long_on=self.long_on.get(),
                    long_hours=int(long_h))
        rt = self.review_e.get().strip()
        m = re.fullmatch(r"(\d{1,2}):(\d{2})", rt)
        if not m or int(m[1]) > 23 or int(m[2]) > 59:
            self.error.config(text="알림 시간은 22:00 처럼 적어 주세요.")
            return
        a = self.app
        a.settings.update(vals, hotkeys=self.keys, pomo_on=self.pomo_on.get(), review_on=self.review_on.get(),
                          review_time=f"{int(m[1]):02d}:{m[2]}", single_timer=self.single.get())
        a.pomo_var.set(self.pomo_on.get())
        a.single_var.set(self.single.get())
        for name, var in self.shown.items():
            a.set_section_shown(name, var.get())
        if not self.pomo_on.get():
            a.pomo_end()
        a._save_settings()
        failed = a.register_hotkeys()
        self.destroy()
        if failed:
            a.notify("일부 단축키를 등록하지 못했어요", f"{', '.join(failed)} — 다른 프로그램이 사용 중이에요")

    def close(self):
        self.app.register_hotkeys()  # 취소: 원래 단축키 복원
        self.destroy()


class HotkeyListener(threading.Thread):
    """RegisterHotKey 로 전역 단축키를 받는 스레드. 눌리면 queue 에 동작 이름을 넣음."""

    def __init__(self, bindings):
        super().__init__(daemon=True)
        self.bindings = bindings  # {action: (mods, vk)}
        self.queue = queue.Queue()
        self.failed = []
        self.ready = threading.Event()
        self.tid = None

    def run(self):
        user32 = ctypes.windll.user32
        self.tid = ctypes.windll.kernel32.GetCurrentThreadId()
        ids = {}
        for i, (action, (mods, vk)) in enumerate(self.bindings.items(), start=1):
            if user32.RegisterHotKey(None, i, mods | 0x4000, vk):  # MOD_NOREPEAT
                ids[i] = action
            else:
                self.failed.append(action)
        self.ready.set()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == 0x0312 and msg.wParam in ids:  # WM_HOTKEY
                self.queue.put(ids[msg.wParam])
        for i in ids:
            user32.UnregisterHotKey(None, i)

    def stop(self):
        if self.tid:
            ctypes.windll.user32.PostThreadMessageW(self.tid, 0x0012, 0, 0)  # WM_QUIT
        self.join(timeout=1)


DATE_PREFIX_RE = re.compile(r"^(?:(\d{1,2})[/.](\d{1,2})|(\d{1,2})월\s*(\d{1,2})일)\s+(.+)$")


def parse_dated_event(text, default_day, today):
    """'10/5 13:30 회의' · '10월 5일 오후 3시 회의' · '13:30 회의'(→ default_day).
    일정표에서는 시간이 없으면 시간 미정: 'KAMP 회의', '10/7 MT'. 실패하면 (None, 이유)."""
    if not text.strip():
        return None, "일정 내용을 적어 주세요."
    day, m = default_day, DATE_PREFIX_RE.match(text.strip())
    if m:
        month, dd = int(m[1] or m[3]), int(m[2] or m[4])
        text = m[5]
        try:
            day = date(today.year, month, dd)
        except ValueError:
            return None, f"{month}월 {dd}일은 없는 날짜예요."
        if day < today - timedelta(days=60):  # 두 달 넘게 지난 날짜면 내년으로
            day = date(today.year + 1, month, dd)
    ev = parse_event(text) or ("", text.strip())  # 시간이 없으면 시간 미정
    return (day, *ev), None


class ScheduleWindow(tk.Toplevel):
    """일정표: 이번 주 · 2주(날짜별 목록) / 한 달(달력 칸). 위에서 바로 추가, 클릭해서 수정."""

    MODES = [("week", "이번 주"), ("2w", "2주"), ("month", "한 달")]

    def __init__(self, app):
        super().__init__(app)
        self.app = app
        s = app._s
        self.mode = app.settings.get("schedule_mode", "2w")
        self.anchor = self.sel = app.today
        self.title("일정표")
        self.configure(bg=C["bg"], padx=16, pady=12)
        self.minsize(s(560), s(520))

        head = tk.Frame(self, bg=C["bg"])
        head.pack(fill="x")
        tk.Label(head, text="일정표", font=(FONT, 14, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.mode_btns = {}
        seg = tk.Frame(head, bg=C["bg"])
        seg.pack(side="left", padx=14)
        for key, label in self.MODES:
            b = app._button(seg, label, lambda k=key: self.set_mode(k), font=(FONT, 9), pady=2, padx=10)
            b.pack(side="left", padx=(0, 2))
            self.mode_btns[key] = b
        nav = dict(bg=C["bg"], fg=C["muted"], hover=C["btn"], padx=8, pady=0, font=(FONT, 15))
        app._button(head, "오늘", self.go_today, font=(FONT, 9), pady=2).pack(side="right")
        app._button(head, "›", lambda: self.shift(1), **nav).pack(side="right", padx=(0, 6))
        self.range_lbl = tk.Label(head, font=(FONT, 11, "bold"), bg=C["bg"], fg=C["text"])
        self.range_lbl.pack(side="right", padx=4)
        app._button(head, "‹", lambda: self.shift(-1), **nav).pack(side="right")

        # 추가: [날짜 ▾] [13:30 회의        ] [추가]
        bar = tk.Frame(self, bg=C["bg"])
        bar.pack(fill="x", pady=(10, 2))
        self.date_btn = app._button(bar, "", self.pick_date, font=(FONT, 10))
        self.date_btn.pack(side="left", fill="y")
        self.entry = app._field(bar)
        self.entry.pack(side="left", fill="x", expand=True, padx=6, ipady=6, ipadx=6)
        self.entry.bind("<Return>", lambda e: self.add())
        app._button(bar, "추가", self.add, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                    activebackground=C["moss_hi"], activeforeground=C["ink"],
                    font=(FONT, 10, "bold"), padx=14).pack(side="left", fill="y")
        self.msg = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["faint"], anchor="w",
                            text="'13:30 회의'는 선택한 날짜에, '10/5 13:30 회의'처럼 날짜도 함께. 시간 없이 적으면 시간 미정. "
                                 "날짜를 누르면 선택, 일정을 누르면 수정.")
        self.msg.pack(fill="x", pady=(0, 8))

        self.body = tk.Frame(self, bg=C["bg"])
        self.body.pack(fill="both", expand=True)
        self.bind("<Escape>", lambda e: self.destroy())
        self.bind("<MouseWheel>", self._wheel)
        self.draw()
        self.geometry(f"{s(880)}x{s(760)}")
        self.update_idletasks()
        app._window_chrome(self)
        self.entry.focus_set()

    # --- 기간 ---
    def days(self):
        if self.mode == "month":
            return calendar.Calendar(firstweekday=6).monthdatescalendar(self.anchor.year, self.anchor.month)
        start = self.anchor - timedelta(days=(self.anchor.weekday() + 1) % 7)  # 일요일부터
        return [start + timedelta(days=i) for i in range(7 if self.mode == "week" else 14)]

    def set_mode(self, mode):
        self.mode = mode
        self.app.settings["schedule_mode"] = mode
        self.app._save_settings()
        self.draw()

    def shift(self, n):
        if self.mode == "month":
            y, m = divmod(self.anchor.year * 12 + self.anchor.month - 1 + n, 12)
            self.anchor = date(y, m + 1, 1)
        else:
            self.anchor += timedelta(days=n * (7 if self.mode == "week" else 14))
        self.draw()

    def go_today(self):
        self.anchor = self.sel = self.app.today
        self.draw()

    def select(self, d):
        self.sel = d
        self.draw()
        self.entry.focus_set()

    def pick_date(self):
        CalendarPopup(self.app, self.date_btn, self.sel, self.select)

    # --- 추가 · 수정 ---
    def add(self):
        parsed, err = parse_dated_event(self.entry.get(), self.sel, self.app.today)
        if err:
            self.msg.config(text=err, fg=C["danger"])
            return
        day, hhmm, title = parsed
        self.app.add_event(day, hhmm, title)
        self.entry.delete(0, "end")
        self.sel = day
        # 추가한 날이 지금 보이는 기간 밖이면 그쪽으로 이동
        shown = [d for w in self.days() for d in w] if self.mode == "month" else self.days()
        if day not in shown or (self.mode == "month" and day.month != self.anchor.month):
            self.anchor = day
        self.msg.config(text=f"{day.month}/{day.day}({WEEKDAYS[day.weekday()]}) {hhmm or '시간 미정'} {title} — 추가했어요",
                        fg=C["moss"])
        self.draw()

    def edit(self, d, ev):
        self.app._open_window("event_win", EventDialog, d, ev, anchor=self)

    def delete(self, d, ev):
        self.app.delete_event(d, ev)

    # --- 그리기 ---
    def draw(self):
        for w in self.body.winfo_children():
            w.destroy()
        for key, b in self.mode_btns.items():
            on = key == self.mode
            b.config(bg=C["moss"] if on else C["btn"], fg=C["ink"] if on else C["text"])
            b.bind("<Leave>", lambda e, b=b, on=on: b.config(bg=C["moss"] if on else C["btn"]))
        d = self.sel
        self.date_btn.config(text=f"{d.month}/{d.day} ({WEEKDAYS[d.weekday()]}) ▾")
        if self.mode == "month":
            self.range_lbl.config(text=f"{self.anchor.year}년 {self.anchor.month}월")
            self._draw_month()
        else:
            days = self.days()
            self.range_lbl.config(text=f"{days[0].month}.{days[0].day} – {days[-1].month}.{days[-1].day}")
            self._draw_list(days)

    def _items(self, d):
        iso = d.isoformat()
        evs = sorted(self.app.events.get(iso, []), key=lambda e: e["time"])  # 시간 미정("")이 맨 위
        hide = self.app.settings.get("hide_past_deadlines", True) and d < self.app.today
        dls = [] if hide else [x for x in self.app.deadlines if x["date"] == iso]
        return evs, dls

    def _wheel(self, e):
        if getattr(self, "canvas", None) and self.mode != "month":
            try:
                self.canvas.yview_scroll(int(-e.delta / 120), "units")
            except tk.TclError:
                pass

    def _draw_list(self, days):
        a, s = self.app, self.app._s
        self.canvas = tk.Canvas(self.body, bg=C["bg"], highlightthickness=0)
        sb = ttk.Scrollbar(self.body, orient="vertical", command=self.canvas.yview,
                           style="Forest.Vertical.TScrollbar")
        self.canvas.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        inner = tk.Frame(self.canvas, bg=C["bg"])
        win = self.canvas.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(win, width=e.width))
        now = datetime.now()
        for d in days:
            is_today, is_sel, past_day = d == a.today, d == self.sel, d < a.today
            evs, dls = self._items(d)
            head = tk.Frame(inner, bg=C["moss_bg"] if is_sel else C["bg"], cursor="hand2")
            head.pack(fill="x", pady=(6 if d != days[0] else 0, 3), padx=(0, 8))
            tk.Frame(head, bg=C["moss"] if is_sel else C["border"], width=s(3)).pack(side="left", fill="y")
            day_fg = C["moss"] if is_today else C["faint"] if past_day else \
                C["danger"] if d.weekday() == 6 else C["text"]
            tk.Label(head, text=f"{d.month}월 {d.day}일 ({WEEKDAYS[d.weekday()]})" + ("  · 오늘" if is_today else ""),
                     font=(FONT, 10, "bold"), bg=head["bg"], fg=day_fg, padx=8, pady=3).pack(side="left")
            if is_sel:
                tk.Label(head, text="여기에 추가", font=(FONT, 8), bg=head["bg"], fg=C["moss"]).pack(side="right", padx=8)
            elif not evs and not dls:  # 빈 날은 한 줄로
                tk.Label(head, text="일정 없음", font=(FONT, 8), bg=head["bg"], fg=C["border"]).pack(side="right", padx=8)
            a._bind_tree(head, "<Button-1>", lambda e, d=d: self.select(d))
            for dl in dls:
                row = tk.Frame(inner, bg=C["card"], highlightthickness=1, highlightbackground=C["border"],
                               cursor="hand2")
                row.pack(fill="x", pady=(0, 2), padx=(s(14), 8))
                tk.Label(row, text="마감", width=6, font=(FONT, 9, "bold"), bg=C["danger"], fg=C["ink"],
                         pady=3).pack(side="left", fill="y")
                tk.Label(row, text=dl["title"], anchor="w", font=(FONT, 10), bg=C["card"],
                         fg=C["text"]).pack(side="left", fill="x", expand=True, padx=8)
                a._bind_tree(row, "<Button-1>", lambda e: a.open_deadlines())
            for ev in evs:
                dt = event_dt(d, ev)
                past = past_day or (is_today and dt is not None and dt < now)
                row = tk.Frame(inner, bg=C["card"], highlightthickness=1, highlightbackground=C["border"],
                               cursor="hand2")
                row.pack(fill="x", pady=(0, 2), padx=(s(14), 8))
                a._button(row, "✕", lambda d=d, ev=ev: self.delete(d, ev), bg=C["card"], fg=C["faint"],
                          hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
                if ev["time"]:
                    tk.Label(row, text=ev["time"], width=6, font=(MONO, 10, "bold"), bg=C["card"],
                             fg=C["faint"] if past else C["moss"]).pack(side="left", pady=4)
                else:
                    tk.Label(row, text="미정", width=7, font=(FONT, 9, "bold"), bg=C["card"],
                             fg=C["faint"] if past else C["muted"]).pack(side="left", pady=4)
                title = tk.Label(row, text=ev["title"], anchor="w", font=(FONT, 10), bg=C["card"],
                                 fg=C["faint"] if past else C["text"], cursor="hand2")
                title.pack(side="left", fill="x", expand=True)
                for w in (row, title):
                    w.bind("<Button-1>", lambda e, d=d, ev=ev: self.edit(d, ev))

    def _draw_month(self):
        s = self.app._s
        self.canvas = None
        grid = tk.Frame(self.body, bg=C["bg"])
        grid.pack(fill="both", expand=True)
        for i, h in enumerate(DAY_HEADS):
            tk.Label(grid, text=h, font=(FONT, 9, "bold"), bg=C["bg"],
                     fg=C["danger"] if i == 0 else C["muted"]).grid(row=0, column=i, pady=(0, 4))
            grid.columnconfigure(i, weight=1, uniform="col", minsize=s(70))
        weeks = self.days()
        for r, week in enumerate(weeks, start=1):
            grid.rowconfigure(r, weight=1, uniform="row", minsize=s(80))
            for c, d in enumerate(week):
                self._month_cell(grid, d).grid(row=r, column=c, sticky="nsew", padx=1, pady=1)

    def _month_cell(self, grid, d):
        a = self.app
        in_month, is_today, is_sel = d.month == self.anchor.month, d == a.today, d == self.sel
        bg = C["moss_bg"] if is_sel else C["card"] if in_month else C["bg"]
        cell = tk.Frame(grid, bg=bg, highlightthickness=2 if is_today else 1,
                        highlightbackground=C["moss"] if is_today else C["border"], cursor="hand2")
        num_fg = C["faint"] if not in_month else C["moss"] if is_today else \
            C["danger"] if d.weekday() == 6 else C["text"]
        tk.Label(cell, text=str(d.day), font=(FONT, 9, "bold" if is_today else "normal"), bg=bg, fg=num_fg,
                 anchor="w", padx=4).pack(fill="x")
        evs, dls = self._items(d)
        items = [("dl", x) for x in dls] + [("ev", x) for x in evs]
        clickable = [cell] + cell.winfo_children()
        for kind, x in items[:3]:
            if kind == "dl":
                lb = tk.Label(cell, text=f"◆ {x['title']}", font=(FONT, 8, "bold"), bg=bg, fg=C["danger"],
                              anchor="w", padx=4)
                lb.bind("<Button-1>", lambda e: a.open_deadlines())
            else:
                lb = tk.Label(cell, text=f"{x['time'] or '·'} {x['title']}", font=(FONT, 8), anchor="w", padx=4,
                              bg=bg, fg=C["faint"] if d < a.today else C["text"], cursor="hand2")
                lb.bind("<Button-1>", lambda e, ev=x: self.edit(d, ev))
            lb.pack(fill="x")
        if len(items) > 3:
            more = tk.Label(cell, text=f"+{len(items) - 3}개", font=(FONT, 8), bg=bg, fg=C["muted"],
                            anchor="w", padx=4)
            more.pack(fill="x")
            clickable.append(more)  # 더 보기 → 그 날짜가 있는 2주 목록으로
            more.bind("<Button-1>", lambda e: (setattr(self, "anchor", d), setattr(self, "sel", d),
                                               self.set_mode("2w")))
        for w in clickable[:2]:
            w.bind("<Button-1>", lambda e: self.select(d))
        return cell


def sub_index(k):
    """3x3 블록 안의 칸 번호(가운데 4 제외) → 0~7."""
    return k if k < 4 else k - 1


class MandalartWindow(tk.Toplevel):
    """9x9 만다라트. 가운데 = 핵심 목표, 그 주변 8칸 = 세부 목표(바깥 블록 가운데와 연동), 나머지 = 실천."""

    def __init__(self, app):
        super().__init__(app)
        self.app, self.editing = app, None
        s = app._s
        self.title("만다라트")
        self.configure(bg=C["bg"], padx=16, pady=12)
        self.minsize(s(620), s(600))

        head = tk.Frame(self, bg=C["bg"])
        head.pack(fill="x")
        tk.Label(head, text="만다라트", font=(FONT, 14, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.progress = tk.Label(head, font=(FONT, 10), bg=C["bg"], fg=C["muted"])
        self.progress.pack(side="left", padx=12)
        app._button(head, "비우기", self.clear, font=(FONT, 9), pady=2).pack(side="right")
        self.status = tk.Label(head, font=(FONT, 9), bg=C["bg"], fg=C["moss"])
        self.status.pack(side="right", padx=10)
        tk.Label(self, text="칸을 클릭해 입력 (Enter 저장 · Tab 다음 칸 · Shift+Enter 줄바꿈)   "
                            "우클릭: 완료 표시 · 오늘 할 일로 보내기 · 큰 목표로 등록",
                 font=(FONT, 8), bg=C["bg"], fg=C["faint"], anchor="w").pack(fill="x", pady=(2, 8))

        grid = tk.Frame(self, bg=C["bg"])
        grid.pack(fill="both", expand=True)
        self.cells = {}
        for b in range(9):
            for c in range(9):
                r, col = (b // 3) * 3 + c // 3, (b % 3) * 3 + c % 3
                frame = tk.Frame(grid, highlightthickness=1, cursor="hand2")
                # 블록 사이는 넓게, 블록 안은 좁게
                frame.grid(row=r, column=col, sticky="nsew",
                           padx=(s(7) if col % 3 == 0 and col else 1, 1),
                           pady=(s(7) if r % 3 == 0 and r else 1, 1))
                label = tk.Label(frame, justify="center", cursor="hand2")
                label.place(relx=0.5, rely=0.5, anchor="center")
                frame.bind("<Configure>", lambda e, lb=label: lb.config(wraplength=max(10, e.width - s(8))))
                for w in (frame, label):
                    w.bind("<Button-1>", lambda e, b=b, c=c: self.edit(b, c))
                    w.bind("<Button-3>", lambda e, b=b, c=c: self.menu(e, b, c))
                self.cells[(b, c)] = (frame, label)
        for i in range(9):
            grid.rowconfigure(i, weight=1, uniform="row", minsize=s(60))
            grid.columnconfigure(i, weight=1, uniform="col", minsize=s(64))

        self.bind("<Escape>", lambda e: self.cancel_edit() if self.editing else self.destroy())
        self.draw()
        self.geometry(f"{s(820)}x{s(790)}")
        self.update_idletasks()
        app._window_chrome(self)

    # --- 데이터 ---
    @staticmethod
    def kind(b, c):
        if b == 4 and c == 4:
            return "center", None, None
        if b == 4:
            return "sub", sub_index(c), None
        if c == 4:
            return "sub", sub_index(b), None
        return "action", sub_index(b), sub_index(c)

    def get(self, kind, s, a):
        d = self.app.mandala
        return d["center"] if kind == "center" else d["subs"][s] if kind == "sub" else d["actions"][s][a]

    def put(self, kind, s, a, value):
        d = self.app.mandala
        if kind == "center":
            d["center"] = value
        elif kind == "sub":
            d["subs"][s] = value
        else:
            d["actions"][s][a] = value
            if not value:
                d["done"][s][a] = False
        self.app.save_mandala()

    # --- 그리기 ---
    def draw(self):
        d = self.app.mandala
        total = sum(1 for s in range(8) for a in range(8) if d["actions"][s][a].strip())
        done = sum(1 for s in range(8) for a in range(8) if d["actions"][s][a].strip() and d["done"][s][a])
        self.progress.config(text=f"실천 {done}/{total} 완료" if total else "")
        for (b, c), (frame, label) in self.cells.items():
            kind, s, a = self.kind(b, c)
            text = self.get(kind, s, a).strip()
            if kind == "center":
                bg, fg, font = C["moss"], C["ink"], (FONT, 12, "bold")
                shown = text or "핵심 목표"
            elif kind == "sub":
                bg, fg, font = C["moss_bg"], C["text"] if text else C["faint"], (FONT, 10, "bold")
                shown = text or f"세부 목표 {s + 1}"
                filled = [x for x in range(8) if d["actions"][s][x].strip()]
                if c == 4 and filled:  # 바깥 블록 가운데에 진행도
                    shown += f"\n{sum(d['done'][s][x] for x in filled)}/{len(filled)}"
            else:
                is_done = d["done"][s][a] and text
                bg = C["done_bg"] if is_done else C["card"]
                fg, font = (C["moss"], (FONT, 9, "overstrike")) if is_done else (C["text"], (FONT, 9))
                shown = ("✓ " + text) if is_done else text
            frame.config(bg=bg, highlightbackground=C["moss"] if kind == "center" else C["border"])
            label.config(text=shown, bg=bg, fg=fg, font=font)

    # --- 편집 ---
    def edit(self, b, c):
        if self.editing:
            self.commit()
        kind, s, a = self.kind(b, c)
        frame, label = self.cells[(b, c)]
        txt = tk.Text(frame, wrap="word", font=label["font"], bg=C["card"], fg=C["text"], relief="flat", bd=0,
                      highlightthickness=2, highlightbackground=C["moss"], highlightcolor=C["moss"],
                      insertbackground=C["moss"], padx=4, pady=4, undo=True)
        txt.insert("1.0", self.get(kind, s, a))
        txt.tag_add("sel", "1.0", "end-1c")
        txt.place(relx=0, rely=0, relwidth=1, relheight=1)
        txt.focus_set()
        txt.bind("<Return>", lambda e: self.commit() or "break")
        txt.bind("<Shift-Return>", lambda e: None)  # 줄바꿈은 그대로
        txt.bind("<Tab>", lambda e: self.commit(move=True) or "break")
        txt.bind("<Escape>", lambda e: self.cancel_edit() or "break")
        txt.bind("<FocusOut>", lambda e: self.commit())
        self.editing = (b, c, txt)

    def commit(self, move=False):
        if not self.editing:
            return
        b, c, txt = self.editing
        self.editing = None
        value = txt.get("1.0", "end-1c").strip()
        txt.destroy()
        self.put(*self.kind(b, c), value)
        self.draw()
        if move:  # 같은 블록의 다음 칸 (가운데 칸은 건너뜀)
            order = [0, 1, 2, 5, 8, 7, 6, 3]  # 시계 방향
            nxt = order[(order.index(c) + 1) % 8] if c in order else 0
            self.edit(b, nxt)

    def cancel_edit(self):
        if self.editing:
            _, _, txt = self.editing
            self.editing = None
            txt.destroy()

    def clear(self):
        if messagebox.askyesno("비우기", "만다라트를 모두 비울까요?\n(오늘 할 일로 보낸 항목은 그대로 남아요)",
                               parent=self):
            self.app.mandala = normalize_mandala({})
            self.app.save_mandala()

    # --- 우클릭 ---
    def menu(self, e, b, c):
        self.commit()
        kind, s, a = self.kind(b, c)
        text = self.get(kind, s, a).strip()
        if not text:
            return
        d, app = self.app.mandala, self.app
        m = tk.Menu(self, tearoff=0, **app.menu_style)
        if kind == "action":
            m.add_command(label="완료 해제" if d["done"][s][a] else "완료 표시", command=lambda: self.toggle_done(s, a))
            m.add_command(label="오늘 할 일로 보내기", command=lambda: self.to_today(s, [a]))
            m.add_separator()
            m.add_command(label="지우기", command=lambda: (self.put(kind, s, a, ""), self.draw()))
        else:
            if kind == "sub":
                m.add_command(label="실천 항목 모두 오늘 할 일로", command=lambda: self.to_today(s, range(8)))
            registered = any(g["title"] == text for g in app.goals)
            m.add_command(label="큰 목표에 등록됨 ✓" if registered else "큰 목표로 등록 (시간 누적)",
                          state="disabled" if registered else "normal",
                          command=lambda: (app.add_goal(text), self.status.config(text=f"'{text}' 큰 목표 등록")))
        m.tk_popup(e.x_root, e.y_root)

    def toggle_done(self, s, a):
        self.app.mandala["done"][s][a] = not self.app.mandala["done"][s][a]
        self.app.save_mandala()

    def to_today(self, s, actions):
        """실천 칸 → 오늘 할 일 ('세부 목표 > 실천' 묶음). 이미 있거나 완료한 칸은 건너뜀."""
        app, d = self.app, self.app.mandala
        tasks = app.store.tasks(app.today)
        sub = d["subs"][s].strip()
        parent = next((t for t in tasks if t["title"] == sub and not t.get("parent")), None) if sub else None
        added = 0
        for a in actions:
            title = d["actions"][s][a].strip()
            if not title or d["done"][s][a]:
                continue
            if any(t.get("mandala") == [s, a] and not t["done"] for t in tasks):
                continue
            if sub and parent is None:
                parent = new_task(sub)
                tasks.append(parent)
            t = new_task(title)
            t["mandala"] = [s, a]
            if parent:
                app._attach(t, parent)
            tasks.append(t)
            added += 1
        app.refresh()
        self.status.config(text=f"오늘 할 일에 {added}개 추가" if added else "추가할 항목이 없어요 (이미 있거나 완료)")


class StatsWindow(tk.Toplevel):
    """최근 7일 막대그래프 + 오래 한 일 + 예상 시간 적중률."""

    def __init__(self, app):
        super().__init__(app)
        self.app = app
        self.end = app.today
        self.title("주간 통계")
        self.configure(bg=C["bg"])
        self.resizable(False, False)

        top = tk.Frame(self, bg=C["bg"], pady=12)
        top.pack(fill="x", padx=16)
        nav = dict(bg=C["bg"], fg=C["muted"], hover=C["btn"], padx=10, pady=0, font=(FONT, 16))
        app._button(top, "‹", lambda: self.shift(-7), **nav).pack(side="left")
        self.range_lbl = tk.Label(top, font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"])
        self.range_lbl.pack(side="left", expand=True)
        self.next_btn = app._button(top, "›", lambda: self.shift(7), **nav)
        self.next_btn.pack(side="right")
        self.body = tk.Frame(self, bg=C["bg"])
        self.body.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.bind("<Escape>", lambda e: self.destroy())
        self.draw()
        self.update_idletasks()
        app._window_chrome(self)

    def shift(self, days):
        self.end = min(self.end + timedelta(days=days), self.app.today)
        self.draw()

    def _section(self, text, parent, top=14):
        tk.Label(parent, text=text, font=(FONT, 10, "bold"), bg=C["bg"], fg=C["moss"],
                 anchor="w").pack(fill="x", pady=(top, 6))

    def draw(self):
        a, s = self.app, self.app._s
        for w in self.body.winfo_children():
            w.destroy()
        days = [self.end - timedelta(days=i) for i in range(6, -1, -1)]
        isos = [d.isoformat() for d in days]
        per_day = [a.store.data.get(iso, []) for iso in isos]
        totals = [sum(elapsed(t) for t in ts) for ts in per_day]
        tasks = [t for ts in per_day for t in ts]
        parent_ids = {t.get("parent") for t in tasks}
        leaves = [t for t in tasks if t["id"] not in parent_ids]  # 상위 할 일은 개수에서 제외
        done = sum(t["done"] for t in leaves)
        active = sum(1 for v in totals if v > 0)
        pomos = sum(t.get("pomos", 0) for t in tasks)
        self.range_lbl.config(text=f"{days[0]:%m.%d} – {days[-1]:%m.%d}")
        self.next_btn.config(state="disabled" if self.end >= a.today else "normal")

        # 왼쪽: 시간 / 오른쪽: 습관 · 목표 (내용이 있을 때만)
        left = tk.Frame(self.body, bg=C["bg"])
        left.pack(side="left", fill="y", anchor="n")
        right = tk.Frame(self.body, bg=C["bg"], width=s(300))

        kpi = tk.Frame(left, bg=C["bg"])
        kpi.pack(fill="x")
        tiles = [("총 시간", fmt_hm(sum(totals))),
                 ("하루 평균", fmt_hm(sum(totals) / active) if active else "–"),
                 ("완료", f"{done} / {len(leaves)}")]
        if pomos:
            tiles.append(("뽀모", f"{pomos}회"))
        for i, (label, value) in enumerate(tiles):
            f = tk.Frame(kpi, bg=C["card"], padx=12, pady=8, highlightthickness=1,
                         highlightbackground=C["border"])
            f.pack(side="left", fill="x", expand=True, padx=(0 if i == 0 else 8, 0))
            tk.Label(f, text=label, font=(FONT, 9), bg=C["card"], fg=C["muted"]).pack(anchor="w")
            tk.Label(f, text=value, font=(FONT, 14, "bold"), bg=C["card"], fg=C["text"]).pack(anchor="w")

        # 날짜별 막대그래프 + 그날의 기분
        self._section("날짜별 시간 · 기분", left)
        W, H = s(520), s(222)
        cv = tk.Canvas(left, width=W, height=H, bg=C["bg"], highlightthickness=0)
        cv.pack()
        base = H - s(70)
        chart_h = base - s(24)
        peak = max(totals) or 1
        slot = W / 7
        face = s(20)
        cv.create_line(0, base, W, base, fill=C["border"], width=s(1))
        for i, (d, v) in enumerate(zip(days, totals)):
            cx = slot * i + slot / 2
            is_today = d == a.today
            if v > 0:
                h = max(s(2), chart_h * v / peak)
                cv.create_rectangle(cx - slot * 0.28, base - h, cx + slot * 0.28, base,
                                    fill=C["moss_hi"] if is_today else C["moss"], width=0)
                hm = int(v) // 60
                cv.create_text(cx, base - h - s(4), text=f"{hm // 60}:{hm % 60:02d}", anchor="s",
                               fill=C["text"], font=(FONT, 9))
            cv.create_text(cx, base + s(6), text=WEEKDAYS[d.weekday()], anchor="n",
                           fill=C["moss"] if is_today else C["muted"], font=(FONT, 10, "bold"))
            cv.create_text(cx, base + s(22), text=f"{d.month}/{d.day}", anchor="n",
                           fill=C["faint"], font=(FONT, 8))
            mood = a.moods.get(d.isoformat())
            if mood:
                draw_face(cv, cx - face / 2, base + s(44), face, mood, MOODS[mood - 1][2], True, C["ink"])
            else:
                cv.create_text(cx, base + s(44) + face / 2, text="·", fill=C["border"], font=(FONT, 10))

        # 가장 오래 한 일
        self._section("가장 오래 한 일", left)
        # 하위 할 일 시간은 상위 묶음(예: 'KAMP 경진대회')으로 합산
        agg = {}
        for ts in per_day:
            by_id = {t["id"]: t for t in ts}
            for t in ts:
                key = by_id[t["parent"]]["title"] if t.get("parent") in by_id else t["title"]
                agg[key] = agg.get(key, 0) + elapsed(t)
        top = sorted(((v, k) for k, v in agg.items() if v >= 60), reverse=True)[:5]
        if not top:
            tk.Label(left, text="아직 기록된 시간이 없어요", font=(FONT, 9), bg=C["bg"],
                     fg=C["faint"], anchor="w").pack(fill="x")
        for v, k in top:
            r = tk.Frame(left, bg=C["bg"])
            r.pack(fill="x", pady=(0, 4))
            tk.Label(r, text=fmt_hm(v), font=(FONT, 9), bg=C["bg"], fg=C["muted"]).pack(side="right")
            tk.Label(r, text=k, font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")
            bar = tk.Canvas(left, width=W, height=s(4), bg=C["card"], highlightthickness=0)
            bar.pack(fill="x", pady=(0, 6))
            bar.create_rectangle(0, 0, W * v / top[0][0], s(4), fill=C["moss"], width=0)

        # 습관: 7일 체크 격자
        has_right = False
        habits = a.habits["habits"]
        if habits:
            has_right = True
            self._section("습관", right, top=0)
            head = tk.Frame(right, bg=C["bg"])
            head.pack(fill="x")
            cell = s(18)
            grid_w = cell * 7 + s(3) * 6
            hc = tk.Canvas(head, width=grid_w, height=s(16), bg=C["bg"], highlightthickness=0)
            hc.pack(side="right", padx=(0, s(34)))
            for i, d in enumerate(days):
                hc.create_text(i * (cell + s(3)) + cell / 2, s(8), text=WEEKDAYS[d.weekday()],
                               fill=C["faint"], font=(FONT, 8))
            for h in habits:
                r = tk.Frame(right, bg=C["bg"])
                r.pack(fill="x", pady=(2, 2))
                n = sum(h["id"] in a.habits["log"].get(iso, []) for iso in isos)
                tk.Label(r, text=f"{n}/7", font=(FONT, 9), bg=C["bg"], fg=C["muted"], width=4).pack(side="right")
                gc = tk.Canvas(r, width=grid_w, height=cell, bg=C["bg"], highlightthickness=0)
                gc.pack(side="right")
                for i, iso in enumerate(isos):
                    on = h["id"] in a.habits["log"].get(iso, [])
                    x = i * (cell + s(3))
                    gc.create_rectangle(x, 0, x + cell, cell, width=0,
                                        fill=C["moss"] if on else C["btn"])
                tk.Label(r, text=h["name"], font=(FONT, 10), bg=C["bg"], fg=C["text"],
                         anchor="w").pack(side="left", fill="x", expand=True)

        # 큰 목표: 이번 주에 쌓은 시간
        if a.goals:
            has_right = True
            self._section("큰 목표 (이번 기간)", right, top=14 if habits else 0)
            for g in a.goals:
                week = goal_seconds(g, {iso: ts for iso, ts in zip(isos, per_day)})
                total = goal_seconds(g, {k: v for k, v in a.store.data.items() if k <= isos[-1]})
                r = tk.Frame(right, bg=C["bg"])
                r.pack(fill="x", pady=(0, 4))
                tk.Label(r, text=f"+{fmt_hours(week)}  (누적 {fmt_hours(total)})", font=(FONT, 9),
                         bg=C["bg"], fg=C["muted"]).pack(side="right")
                tk.Label(r, text=g["title"], font=(FONT, 10), bg=C["bg"], fg=C["text"],
                         anchor="w").pack(side="left", fill="x", expand=True)

        # 예상 시간 적중률 (완료 + 목표가 있는 일만)
        est = [(t, total_time(t, ts)) for ts in per_day for t in ts if t["done"] and t.get("estimate")]
        if est:
            has_right = True
            self._section("예상 시간", right, top=14 if (habits or a.goals) else 0)
            within = sum(not over_estimate(t, secs) for t, secs in est)
            tk.Label(right, text=f"목표 안에 끝낸 일  {within} / {len(est)}   ({within * 100 // len(est)}%)",
                     font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")

        if has_right:
            right.pack(side="left", fill="y", anchor="n", padx=(s(12), 0))

def resource(name):
    """exe(PyInstaller)로 묶였을 때와 스크립트로 실행할 때 모두 같은 파일을 찾음."""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, name)


def already_running():
    """이미 켜져 있으면 그 창을 앞으로 불러오고 True."""
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.CreateMutexW.restype = wintypes.HANDLE
    globals()["_instance_mutex"] = k32.CreateMutexW(None, False, "DailyTodo.SingleInstance")
    if k32.GetLastError() != 183:  # ERROR_ALREADY_EXISTS
        return False
    hwnd = u32.FindWindowW("TkTopLevel", "Daily Todo")
    if hwnd:
        u32.ShowWindow(hwnd, 9)  # SW_RESTORE
        u32.SetForegroundWindow(hwnd)
    return True


if __name__ == "__main__":
    try:  # 고해상도 모니터에서 글자 흐림 방지
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
        # 작업 표시줄에서 python 이 아니라 Daily Todo 아이콘으로 묶이게
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("DailyTodo.App")
    except Exception:
        pass
    if not already_running():
        App().mainloop()
