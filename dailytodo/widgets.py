"""여러 창에서 같이 쓰는 부품: 대화상자 틀, 체크박스, 토스트, 달력, 기분 · 습관."""
import calendar
import tkinter as tk
from datetime import date
from tkinter import ttk

from .config import C, DAY_HEADS, FONT, MOODS
from .winapi import work_area


def scroll_area(parent, bg):
    """세로 스크롤 영역. (바깥 frame, canvas, 안쪽 frame) 을 돌려줌."""
    wrap = tk.Frame(parent, bg=bg)
    canvas = tk.Canvas(wrap, bg=bg, highlightthickness=0)
    sb = ttk.Scrollbar(wrap, orient="vertical", command=canvas.yview, style="Forest.Vertical.TScrollbar")
    canvas.configure(yscrollcommand=sb.set)
    sb.pack(side="right", fill="y")
    canvas.pack(side="left", fill="both", expand=True)
    inner = tk.Frame(canvas, bg=bg)
    win = canvas.create_window((0, 0), window=inner, anchor="nw")
    inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
    canvas.bind("<Configure>", lambda e: canvas.itemconfigure(win, width=e.width))
    return wrap, canvas, inner


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
        dl_days = {d["date"] for d in (self.app.deadlines if self.app.has("deadlines") else [])
                   if not (hide_past and d["date"] < self.app.today.isoformat())}
        ev_days = {k for k, v in self.app.events.items() if v} if self.app.has("events") else set()
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
