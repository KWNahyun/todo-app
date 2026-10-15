"""일정표 창 (이번 주 · 2주 · 한 달)."""
import calendar
import tkinter as tk
from datetime import date, datetime, timedelta
from tkinter import ttk

from .config import C, DAY_HEADS, FONT, MONO, WEEKDAYS
from .core import dday_text, event_dt, is_deadline_text, parse_dated_event, parse_deadline
from .widgets import CalendarPopup
from .dialogs import EventDialog


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

        # 추가: [일정|마감] [날짜 ▾] [13:30 회의        ] [추가]
        bar = tk.Frame(self, bg=C["bg"])
        bar.pack(fill="x", pady=(10, 2))
        self.kind = "event"
        self.kind_btns = {}
        if app.has("deadlines"):
            for key, label in (("event", "일정"), ("deadline", "마감")):
                b = app._button(bar, label, lambda k=key: self.set_kind(k), font=(FONT, 9), padx=10)
                b.pack(side="left", fill="y", padx=(0, 2))
                self.kind_btns[key] = b
            tk.Frame(bar, bg=C["bg"], width=s(6)).pack(side="left")
        self.date_btn = app._button(bar, "", self.pick_date, font=(FONT, 10))
        self.date_btn.pack(side="left", fill="y")
        self.entry = app._field(bar)
        self.entry.pack(side="left", fill="x", expand=True, padx=6, ipady=6, ipadx=6)
        self.entry.bind("<Return>", lambda e: self.add())
        app._button(bar, "추가", self.add, bg=C["moss"], fg=C["ink"], hover=C["moss_hi"],
                    activebackground=C["moss_hi"], activeforeground=C["ink"],
                    font=(FONT, 10, "bold"), padx=14).pack(side="left", fill="y")
        self.msg = tk.Label(self, font=(FONT, 9), bg=C["bg"], fg=C["faint"], anchor="w")
        self.msg.pack(fill="x", pady=(0, 8))
        self.set_kind("event")

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
    HINTS = {
        "event": "'13:30 회의'는 선택한 날짜에, '10/5 13:30 회의'처럼 날짜도 함께. 시간 없이 적으면 시간 미정. "
                 "날짜를 누르면 선택, 일정 · 마감을 누르면 수정.",
        "deadline": "마감 이름만 적으면 선택한 날짜에, '10/20 KAMP 제출'처럼 날짜도 함께. "
                    "'일정'에서도 '마감 10/20 …'으로 적으면 마감이 돼요.",
    }

    def set_kind(self, kind):
        self.kind = kind
        for key, b in self.kind_btns.items():
            on = key == kind
            b.config(bg=C["danger"] if on and key == "deadline" else C["moss"] if on else C["btn"],
                     fg=C["ink"] if on else C["text"])
            b.bind("<Leave>", lambda e, b=b, bg=b["bg"]: b.config(bg=bg))
        self.msg.config(text=self.HINTS[kind], fg=C["faint"])
        self.entry.focus_set()

    def _reveal(self, day):
        """추가한 날이 지금 보이는 기간 밖이면 그쪽으로 이동."""
        self.sel = day
        shown = [d for w in self.days() for d in w] if self.mode == "month" else self.days()
        if day not in shown or (self.mode == "month" and day.month != self.anchor.month):
            self.anchor = day

    def add(self):
        text = self.entry.get()
        a = self.app
        if a.has("deadlines") and (self.kind == "deadline" or is_deadline_text(text)):
            parsed, err = parse_deadline(text, self.sel, a.today)
            if err:
                self.msg.config(text=err, fg=C["danger"])
                return
            day, title = parsed
            a.add_deadline(day, title)
            self.entry.delete(0, "end")
            self._reveal(day)
            self.msg.config(text=f"마감 {day.month}/{day.day}({WEEKDAYS[day.weekday()]}) "
                                 f"{dday_text((day - a.today).days)} {title} — 추가했어요", fg=C["moss"])
            self.draw()
            return
        parsed, err = parse_dated_event(text, self.sel, a.today)
        if err:
            self.msg.config(text=err, fg=C["danger"])
            return
        day, hhmm, title = parsed
        a.add_event(day, hhmm, title)
        self.entry.delete(0, "end")
        self._reveal(day)
        self.msg.config(text=f"{day.month}/{day.day}({WEEKDAYS[day.weekday()]}) {hhmm or '시간 미정'} {title} — 추가했어요",
                        fg=C["moss"])
        self.draw()

    def edit(self, d, ev):
        self.app._open_window("event_win", EventDialog, d, ev, anchor=self)

    def edit_deadline(self, dl):
        self.app.edit_deadline(dl, anchor=self)

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
        dls = [] if hide or not self.app.has("deadlines") else [x for x in self.app.deadlines if x["date"] == iso]
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
                a._bind_tree(row, "<Button-1>", lambda e, dl=dl: self.edit_deadline(dl))
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
                              anchor="w", padx=4, cursor="hand2")
                lb.bind("<Button-1>", lambda e, dl=x: self.edit_deadline(dl))
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
