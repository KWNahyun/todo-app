"""아래쪽 '오늘의 기록': 일기 · 기분 · 습관."""
import tkinter as tk
from datetime import timedelta

from .config import C, FONT, HABIT_FILE, JOURNAL_FILE, MOOD_FILE
from .storage import save_json
from .records import RecordsWindow
from .widgets import HabitBar, MoodPicker


class JournalMixin:
    """App 의 일부 — 아래쪽 '오늘의 기록': 일기 · 기분 · 습관."""

    def _build_diary(self):
        self.diary = tk.Frame(self, bg=C["bg"])
        self.diary.pack(side="bottom", fill="x", padx=16, pady=(4, 10))
        head = tk.Frame(self.diary, bg=C["bg"])
        head.pack(fill="x")
        self.diary_head = tk.Label(head, font=(FONT, 10, "bold"), bg=C["bg"], fg=C["moss"],
                                   cursor="hand2", anchor="w")
        self.diary_head.pack(side="left")
        self.diary_head.bind("<Button-1>", lambda e: self._toggle_diary())
        records = tk.Label(head, text="기록장 ›", font=(FONT, 9), bg=C["bg"], fg=C["muted"], cursor="hand2")
        records.pack(side="right", padx=(8, 0))
        records.bind("<Button-1>", lambda e: self.open_records(self.day))
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
        self.habit_bar.pack_forget()
        self.diary_text.pack_forget()
        if show:  # 습관 칩(켜져 있을 때) → 일기 순서로
            if self.has("habits"):
                self.habit_bar.pack(fill="x", pady=(6, 0))
            self.diary_text.pack(fill="x", pady=(6, 0))
        self._update_diary_head()

    def set_journal(self, iso, text, source=None):
        """다른 창(오늘 정리하기 · 기록장)에서 일기를 바꿨을 때: 저장하고 화면에도 반영."""
        if text:
            self.journal[iso] = text
        else:
            self.journal.pop(iso, None)
        save_json(JOURNAL_FILE, dict(sorted(self.journal.items())))
        if self._diary_day == iso:
            self.diary_text.delete("1.0", "end")
            self.diary_text.insert("1.0", text)
            self.diary_text.edit_modified(False)
        self._redraw_records(source)

    def set_mood(self, iso, level):
        if level:
            self.moods[iso] = level
        else:
            self.moods.pop(iso, None)
        save_json(MOOD_FILE, dict(sorted(self.moods.items())))
        self.mood_picker.draw()
        self._redraw_stats()
        self._redraw_records()

    # ---------- 기록장 ----------
    def open_records(self, day=None):
        win = getattr(self, "records_win", None)
        if win and win.winfo_exists():
            win.deiconify()
            win.lift()
            win.focus_force()
        else:
            win = self.records_win = RecordsWindow(self)
        if day:
            win.show_diary(day)

    def _redraw_records(self, source=None, force=False):
        """일기·기분이 바뀌면 기록장도 맞춤 (바꾼 쪽이 기록장 자신이면 편집 중인 글은 그대로)."""
        win = getattr(self, "records_win", None)
        if win and win.winfo_exists():
            win.refresh(source, force)

    def _flush_records(self):
        """기록장에서 아직 저장 안 된 글을 지금 저장 (종료 · 백업 전)."""
        win = getattr(self, "records_win", None)
        if win and win.winfo_exists():
            for view in win.views.values():
                view.save_now()

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
        self._redraw_records()
