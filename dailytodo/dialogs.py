"""대화상자: 할 일 상세, 마감, 백업, 기능 켜고 끄기, 사용법, 일정, 습관, 목표, 오늘 정리, 설정."""
import ctypes
import os
import re
import time
import tkinter as tk
import uuid
from datetime import date, datetime, timedelta
from tkinter import messagebox

from .config import (
    BACKUP_DIR, C, DEFAULT_HOTKEYS, FEATURES, FONT, HOTKEY_ACTIONS, MONO, POMO_DEFAULTS, SECTIONS,
    WEEKDAYS,
)
from .core import (
    children, dday_colors, dday_text, elapsed, fmt, fmt_hm, fmt_hours, goal_seconds, parse_duration,
    parse_event, stop, total_time,
)
from .storage import make_backup, restore_backup
from .widgets import CalendarPopup, CheckRow, Dialog, HabitBar, MoodPicker


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
        tk.Label(self, text="Enter 추가 · 마감을 누르면 이름 · 날짜 수정 · Esc 닫기", font=(FONT, 8), bg=C["bg"],
                 fg=C["faint"], anchor="w").pack(fill="x", pady=(10, 0))
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
            row = tk.Frame(self.list_f, bg=C["card"], highlightthickness=1, highlightbackground=C["border"],
                           cursor="hand2")
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
            # 줄을 누르면 수정 (✕ 버튼은 그대로 삭제)
            for w in [row, col] + row.winfo_children()[:1] + row.winfo_children()[2:3] + col.winfo_children():
                w.bind("<Button-1>", lambda e, dl=dl: self.edit(dl))

    def edit(self, dl):
        self.app.edit_deadline(dl, anchor=self)
        if self.winfo_exists():
            self.draw_list()


class EditDeadlineDialog(Dialog):
    """마감 하나 고치기: 이름 · 날짜 · 연결된 묶음, 삭제."""

    def __init__(self, app, dl, anchor=None):
        super().__init__(app, "마감 수정")
        if anchor:  # 마감 관리 창 · 일정표에서 열면 그 위에 뜨게
            self.transient(anchor)
            self.attributes("-topmost", True)
        self.dl, self.pick, self.group = dl, date.fromisoformat(dl["date"]), dl.get("group")
        self.section("마감 이름", top=0)
        self.title_e = app._field(self, width=32)
        self.title_e.insert(0, dl["title"])
        self.title_e.pack(fill="x", ipady=6, ipadx=6)
        self.title_e.bind("<Return>", lambda e: self.save())

        self.section("날짜")
        row = tk.Frame(self, bg=C["bg"])
        row.pack(fill="x")
        self.date_btn = app._button(row, "", self.pick_date, font=(FONT, 10))
        self.date_btn.pack(side="left")
        self.dday = tk.Label(row, font=(FONT, 9, "bold"), padx=6)
        self.dday.pack(side="left", padx=8)
        self._update_date()

        self.section("연결된 묶음  (남은 하위 할 일 수와 하루 페이스를 디데이 옆에 보여 줘요)")
        self.group_btn = tk.Menubutton(self, font=(FONT, 10), bg=C["btn"], fg=C["text"], relief="flat",
                                       activebackground=C["btn_hi"], anchor="w", padx=10, pady=4, cursor="hand2")
        menu = tk.Menu(self.group_btn, tearoff=0, **app.menu_style)
        menu.add_command(label="연결 없음", command=lambda: self._set_group(None))
        for title in self._group_choices():
            menu.add_command(label=title, command=lambda t=title: self._set_group(t))
        self.group_btn.config(menu=menu)
        self.group_btn.pack(fill="x")
        self._set_group(self.group)

        self.error = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["danger"], anchor="w")
        self.error.pack(fill="x", pady=(8, 0))
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(4, 0))
        self.primary(btns, "저장", self.save).pack(side="right")
        app._button(btns, "취소", self.close, padx=14).pack(side="right", padx=(0, 8))
        app._button(btns, "삭제", self.delete, fg=C["danger"], hover=C["danger_bg"], padx=14).pack(side="left")
        self.finish(self.title_e, anchor)

    def _group_choices(self):
        """최근 30일 동안의 상위 할 일 제목 (지금 연결된 것 포함)."""
        a = self.app
        since = (a.today - timedelta(days=30)).isoformat()
        titles = {t["title"] for k, ts in a.store.data.items() if k >= since for t in ts if not t.get("parent")}
        if self.group:
            titles.add(self.group)
        return sorted(titles)

    def _set_group(self, title):
        self.group = title
        self.group_btn.config(text=f"↳ {title}  ▾" if title else "연결 없음  ▾")

    def pick_date(self):
        CalendarPopup(self.app, self.date_btn, self.pick, self._set_date)

    def _set_date(self, d):
        self.pick = d
        self._update_date()

    def _update_date(self):
        d, n = self.pick, (self.pick - self.app.today).days
        self.date_btn.config(text=f"{d:%Y.%m.%d} ({WEEKDAYS[d.weekday()]}) ▾")
        bg, fg = dday_colors(n)
        self.dday.config(text=dday_text(n), bg=bg, fg=fg)

    def save(self):
        title = self.title_e.get().strip()
        if not title:
            self.error.config(text="마감 이름을 적어 주세요.")
            return
        self.dl.update(title=title, date=self.pick.isoformat(), group=self.group)
        self.app.save_deadlines()
        self.app.refresh()
        self.destroy()

    def delete(self):
        if not messagebox.askyesno("삭제", f"마감 '{self.dl['title']}'을(를) 지울까요?", parent=self):
            return
        self.app.deadlines.remove(self.dl)
        self.app.save_deadlines()
        self.app.refresh()
        self.destroy()


class BackupDialog(Dialog):
    """자동 백업 목록 · 지금 백업 · 복원."""

    def __init__(self, app):
        super().__init__(app, "백업 · 복원")
        top = tk.Frame(self, bg=C["bg"])
        top.pack(fill="x")
        tk.Label(top, text="백업", font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        app._button(top, "폴더 열기", self.open_folder, font=(FONT, 9), pady=2).pack(side="right")
        self.primary(top, "지금 백업", self.backup_now).pack(side="right", padx=(0, 6))
        self.hint("매일 앱을 처음 켤 때 자동으로 백업해요 (최근 14일 보관). 할 일 · 일기 · 일정 · 습관 · 목표 · 만다라트 모두 포함.\n"
                  "복원해도 설정(창 위치·단축키 등)은 그대로이고, 복원 직전 상태도 따로 백업해 둬요.")
        self.status = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["moss"], anchor="w")
        self.status.pack(fill="x", pady=(4, 0))
        self.section("백업 목록")
        self.list_f = tk.Frame(self, bg=C["bg"])
        self.list_f.pack(fill="x")
        self.draw()
        self.finish()

    def draw(self):
        for w in self.list_f.winfo_children():
            w.destroy()
        zips = sorted(BACKUP_DIR.glob("*.zip"), key=lambda p: p.stat().st_mtime, reverse=True) \
            if BACKUP_DIR.exists() else []
        if not zips:
            self.hint("아직 백업이 없어요", self.list_f)
        for p in zips[:12]:
            when = datetime.fromtimestamp(p.stat().st_mtime)
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem):
                d = date.fromisoformat(p.stem)
                label, kind = f"{d.month}월 {d.day}일 ({WEEKDAYS[d.weekday()]})", "자동"
            else:
                label, kind = f"{when.month}월 {when.day}일 {when:%H:%M}", p.stem.split("-")[0]
            row = tk.Frame(self.list_f, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
            row.pack(fill="x", pady=(0, 3))
            self.app._button(row, "복원", lambda p=p: self.restore(p), font=(FONT, 9), pady=2).pack(
                side="right", padx=4, pady=3)
            tk.Label(row, text=f"{p.stat().st_size // 1024 + 1}KB", font=(FONT, 8), bg=C["card"],
                     fg=C["faint"]).pack(side="right", padx=6)
            tk.Label(row, text=kind, font=(FONT, 8, "bold"), bg=C["btn"], fg=C["muted"], padx=5).pack(
                side="left", padx=(8, 0))
            tk.Label(row, text=label, font=(FONT, 10), bg=C["card"], fg=C["text"], anchor="w").pack(
                side="left", fill="x", expand=True, padx=8, pady=4)

    def backup_now(self):
        self.app._save_diary()
        self.app._flush_records()
        self.app.store.save()
        p = make_backup(f"수동-{datetime.now():%Y%m%d-%H%M%S}")
        self.status.config(text=f"백업했어요: {p.name}")
        self.draw()

    def restore(self, path):
        if not messagebox.askyesno("복원", f"'{path.stem}' 백업으로 되돌릴까요?\n\n지금 데이터는 '복원전' 백업으로 남겨 둬요.",
                                   parent=self):
            return
        a = self.app
        a._save_diary()
        a._flush_records()  # 기록장에 쓰던 글도 '복원전' 백업에 들어가게
        a.store.save()
        make_backup(f"복원전-{datetime.now():%Y%m%d-%H%M%S}")
        restore_backup(path)
        a.reload_data()
        self.status.config(text=f"'{path.stem}' 백업으로 복원했어요")
        self.draw()

    def open_folder(self):
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(BACKUP_DIR)


class FeatureDialog(Dialog):
    """기능 켜고 끄기. 바꾸면 바로 반영, 기록은 지우지 않음."""

    def __init__(self, app):
        super().__init__(app, "기능 켜고 끄기")
        tk.Label(self, text="기능 켜고 끄기", font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"],
                 anchor="w").pack(fill="x")
        self.hint("안 쓰는 기능은 꺼 두면 메뉴와 화면에서 사라져요. 꺼도 기록은 지워지지 않고, 다시 켜면 그대로 보여요.")
        self.vars = {}
        grid = tk.Frame(self, bg=C["bg"])
        grid.pack(fill="x", pady=(10, 0))
        for i, (key, label, desc) in enumerate(FEATURES):
            cell = tk.Frame(grid, bg=C["bg"])
            cell.grid(row=i // 2, column=i % 2, sticky="nw", padx=(0, 18), pady=(0, 8))
            var = self.vars[key] = tk.BooleanVar(value=app.has(key))
            var.trace_add("write", lambda *_, k=key: app.set_feature(k, self.vars[k].get()))
            CheckRow(cell, app, label, var, font=(FONT, 10, "bold")).pack(anchor="w")
            tk.Label(cell, text=desc, font=(FONT, 8), bg=C["bg"], fg=C["faint"], anchor="w",
                     padx=app._s(22)).pack(anchor="w")
        self.hint("할 일 · 타이머 · 일기는 기본 기능이라 항상 켜져 있어요.")
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(10, 0))
        self.primary(btns, "닫기", self.close).pack(side="right")
        self.finish()


class HelpDialog(Dialog):
    """한 장짜리 사용법 · 단축키."""

    def __init__(self, app):
        super().__init__(app, "사용법 · 단축키")
        keys = app.settings.get("hotkeys", DEFAULT_HOTKEYS)
        hk = lambda a: (keys.get(a) or {}).get("label", "꺼짐")
        sections = [
            ("입력창에 적기", [
                ("보고서 쓰기", "할 일"),
                ("KAMP > 데이터 EDA", "'KAMP' 묶음 아래 하위 할 일 (입력창에 'KAMP > '가 남아 연속 입력)"),
                ("13:30 회의", "그날 일정 · '오후 3시 면담', '6시 반 저녁'도 돼요"),
                ("미정 KAMP 회의", "시간 미정 일정 ('종일 MT'도 같음)"),
                ("마감 10/20 KAMP 제출", "마감(디데이) 추가 · 일정표에서도 같은 방식"),
                ("10/5 13:30 회의", "일정표 창에서: 날짜까지 한 번에"),
            ]),
            ("마우스", [
                ("제목 클릭", "메모 · 예상 시간 · 기록 시간 수정"),
                ("길게 누르고 끌기", "순서 바꾸기 (묶음은 하위까지 통째로)"),
                ("우클릭", "묶기 · 묶음에서 빼기 · 마감/목표 연결 · 삭제"),
                ("날짜 클릭", "달력 열기 → 날짜로 이동"),
                ("일정 · 마감 클릭", "이름 · 날짜(· 시간 · 연결 묶음) 수정, 삭제"),
                ("▸ 일정  ▸ 마감", "날짜 아래 버튼: 펼치기 / 접기"),
                ("◢ (위젯 모드)", "오른쪽 아래를 끌어서 크기 조절"),
            ]),
            ("키보드", [
                (hk("show"), "어디서든 위젯 불러와서 바로 입력"),
                (hk("timer"), "마지막 타이머 시작 / 정지"),
                (hk("review"), "오늘 정리하기"),
                ("Ctrl+Z", "방금 한 일 되돌리기 (삭제 · 체크 · 순서 · 묶기)"),
                ("Ctrl+Enter / Esc", "상세 창 저장 / 닫기"),
                ("Tab", "만다라트: 다음 칸으로"),
            ]),
            ("알아 두면 좋은 것", [
                ("자리 비움", "타이머 켜고 10분 입력이 없으면 돌아왔을 때 그 시간을 뺄지 물어봐요"),
                ("자정", "켜 둔 타이머는 자정에 나뉘어 오늘 할 일로 이어져요"),
                ("백업", "매일 자동 (⋯ → 백업 · 복원)"),
            ]),
        ]
        tk.Label(self, text="사용법 · 단축키", font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"],
                 anchor="w").pack(fill="x")
        for title, rows in sections:
            self.section(title, top=12)
            for key, desc in rows:
                row = tk.Frame(self, bg=C["bg"])
                row.pack(fill="x", pady=1)
                tk.Label(row, text=key, font=(FONT, 9, "bold"), bg=C["btn"], fg=C["text"], width=18,
                         anchor="w", padx=8, pady=2).pack(side="left")
                tk.Label(row, text=desc, font=(FONT, 9), bg=C["bg"], fg=C["text"], anchor="w",
                         justify="left", wraplength=app._s(380)).pack(side="left", fill="x", padx=(8, 0))
        btns = tk.Frame(self, bg=C["bg"])
        btns.pack(fill="x", pady=(14, 0))
        app._button(btns, "단축키 바꾸기", lambda: (self.destroy(), app.open_settings()), font=(FONT, 9),
                    pady=2).pack(side="left")
        self.primary(btns, "닫기", self.close).pack(side="right")
        self.finish()


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

        if app.has("habits"):
            self.section("습관")
            HabitBar(self, app, lambda: day).pack(fill="x")
        if app.has("mood"):
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
