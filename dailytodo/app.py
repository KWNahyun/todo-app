"""App 본체: 시작 · 데이터 불러오기 · 매 틱 갱신 · 창 열기 · 종료, 그리고 main()."""
import ctypes
import re
import time
import tkinter as tk
from datetime import date, timedelta
from tkinter import messagebox

from .config import (
    C, COLLECTIONS_FILE, DATA_FILE, DEADLINE_FILE, EVENT_FILE, GOAL_FILE, HABIT_FILE, JOURNAL_FILE,
    MANDALA_FILE, MOOD_FILE, SETTINGS_FILE,
)
from .core import fmt, normalize_mandala, stop
from .storage import Store, daily_backup, load_json, save_json
from .winapi import already_running, resource
from .dialogs import (
    BackupDialog, DeadlineDialog, FeatureDialog, GoalDialog, HabitDialog, HelpDialog, ReviewDialog,
    SettingsDialog,
)
from .mandala import MandalartWindow
from .stats import StatsWindow
from .ui_window import WindowMixin
from .ui_journal import JournalMixin
from .ui_top import TopMixin
from .ui_tasks import TaskListMixin
from .ui_timers import TimerMixin


class App(TaskListMixin, TopMixin, JournalMixin, TimerMixin, WindowMixin, tk.Tk):
    """Daily Todo 본체. 기능별 메서드는 ui_*.py 의 믹스인에 나뉘어 있음."""

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

        daily_backup(date.today())  # 하루 한 번, 불러오기 전에 어제까지의 데이터를 백업
        self.load_data()
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
        self.apply_features()
        if crashed:
            self.after(600, lambda: self._ask_away(heartbeat, "앱이 꺼져 있던 동안"))
        self._tick()
        self.register_hotkeys(startup=True)
        self._poll_hotkeys()
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        # 위젯(바탕화면 고정) 모드에서 다른 곳을 클릭하면 다시 맨 뒤로
        self.bind("<FocusOut>", lambda e: self.after(150, self._back_if_unfocused))

    def load_data(self):
        """설정을 뺀 모든 데이터 파일을 읽음 (시작할 때, 백업에서 복원한 뒤)."""
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
        self.collections = load_json(COLLECTIONS_FILE)  # 기록장의 목록형 모음 (버킷리스트 등)

    def save_collections(self, source=None):
        save_json(COLLECTIONS_FILE, self.collections)
        self._redraw_records(source)

    def has(self, feature):
        """기능이 켜져 있는지 (기본은 모두 켜짐)."""
        return self.settings.get("features", {}).get(feature, True)

    def set_feature(self, feature, on):
        self.settings.setdefault("features", {})[feature] = on
        self._save_settings()
        self.apply_features()

    def apply_features(self):
        """켜고 끈 기능에 맞춰 화면을 다시 구성."""
        for b in (self.stats_btn, self.review_btn):
            b.pack_forget()
        if self.has("stats"):
            self.stats_btn.pack(side="right", padx=(6, 0))
        if self.has("review"):
            self.review_btn.pack(side="right", padx=(6, 0))
        if self.has("mood"):
            self.mood_picker.pack(side="right")
        else:
            self.mood_picker.pack_forget()
        self._show_diary(self.settings.get("diary_open", True))
        if not self.has("pomodoro") and self.pomo_var.get():
            self.pomo_var.set(False)
            self._set_pomo()
        # 꺼진 기능의 창은 닫음
        for feature, attr in (("mandala", "mandala_win"), ("stats", "stats_win"),
                              ("events", "schedule_win")):
            win = getattr(self, attr, None)
            if not self.has(feature) and win and win.winfo_exists():
                win.destroy()
        records = getattr(self, "records_win", None)
        if records and records.winfo_exists():
            records.build_sidebar()  # 버킷리스트 등 모음을 켜고 끄면 기록장 왼쪽 목록도 맞춤
        self.refresh()

    def reload_data(self):
        self._diary_day = None  # 지금 일기 칸 내용으로 복원된 일기를 덮어쓰지 않게
        self.pomo = None
        self.load_data()
        self._load_diary()
        self.refresh()
        self.after_idle(self.render_top)
        if self.mandala_win and self.mandala_win.winfo_exists():
            self.mandala_win.draw()
        self._redraw_schedule()
        self._redraw_records(force=True)  # 기록장에 쓰던 글이 있어도 복원된 내용으로

    def open_backups(self):
        self._open_window("backup_win", BackupDialog)

    # ---------- settings / widget mode ----------
    def _save_settings(self):
        self.update_idletasks()
        if self.widget_mode is not None and self.winfo_width() > 1:  # 창이 그려지기 전엔 1x1
            self.settings["geom_widget" if self.widget_mode else "geom_window"] = self.geometry()
        save_json(SETTINGS_FILE, self.settings)

    def _dialog(self, fn, *args, **kw):
        self._dialog_open = True
        try:
            return fn(*args, parent=self, **kw)
        finally:
            self._dialog_open = False

    def _redraw_stats(self):
        if self.stats_win and self.stats_win.winfo_exists():
            self.after_idle(self.stats_win.draw)

    def open_features(self):
        self._open_window("feature_win", FeatureDialog)

    def open_help(self):
        self._open_window("help_win", HelpDialog)

    def _tick(self):
        self._guard_timers()
        # 자정이 지나면: 켜진 타이머를 날짜별로 나누고 '오늘' 화면을 새 날짜로 넘김
        if date.today() != self.today:
            was_today = self.day == self.today
            self.today = date.today()
            daily_backup(self.today)  # 켜 둔 채 날짜가 바뀌어도 하루 한 번 백업
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

    # ---------- actions ----------
    def go(self, delta):
        self.go_to(self.today if delta == 0 else self.day + timedelta(days=delta))

    def go_to(self, day):
        self.day = day
        self._load_diary()
        self.render()
        self.canvas.yview_moveto(0)

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
        self._flush_records()
        self.settings["heartbeat"] = None  # 정상 종료 — 다음 실행 때 '꺼져 있던 동안' 확인 안 함
        self._save_settings()
        self.shutdown()

    def shutdown(self):
        """예약된 콜백(타이머 갱신·다시 그리기 등)을 모두 취소하고 창을 닫음."""
        for job in self.tk.splitlist(self.tk.call("after", "info")):
            self.tk.call("after", "cancel", job)
        if self.hotkeys:
            self.hotkeys.stop()
        self.destroy()


def main():
    try:  # 고해상도 모니터에서 글자 흐림 방지
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
        # 작업 표시줄에서 python 이 아니라 Daily Todo 아이콘으로 묶이게
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("DailyTodo.App")
    except Exception:
        pass
    if not already_running():
        App().mainloop()
