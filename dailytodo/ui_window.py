"""창 · 위젯 모드, 레이아웃 만들기, ⋯ 메뉴, 공용 버튼 · 입력칸."""
import ctypes
import re
import tkinter as tk
from ctypes import wintypes
from tkinter import ttk

from .config import C, FONT, PLACEHOLDER, SECTIONS
from .winapi import colorref, resource, work_area
from .widgets import CalendarPopup


class WindowMixin:
    """App 의 일부 — 창 · 위젯 모드, 레이아웃 만들기, ⋯ 메뉴, 공용 버튼 · 입력칸."""

    WINDOW_MIN = (440, 480)

    WIDGET_MIN = (340, 360)

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
            self.grip.pack(side="right", padx=(6, 0), before=self.foot_btns)
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
        # '상단에 표시'(설정 창에서 바꿈)와 연결된 값
        self.section_vars = {name: tk.BooleanVar(value=self.section_cfg(name)["show"]) for name, _ in SECTIONS}

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
        # 오른쪽 버튼 묶음 (기능을 끄면 그 버튼만 빠짐)
        self.foot_btns = tk.Frame(footer, bg=C["bar"])
        self.foot_btns.pack(side="right", padx=(0, 12))
        self.stats_btn = self._button(self.foot_btns, "통계", self.open_stats, **small)
        self.review_btn = self._button(self.foot_btns, "정리하기", self.open_review, **small)
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

        # 되돌리기: 목록 아래쪽에 잠깐 뜨는 알림 줄 + Ctrl+Z
        self._undo, self._snack_job = [], None
        self.snack = tk.Frame(body, bg=C["text"])
        for seq in ("<Control-z>", "<Control-Z>"):
            self.bind_all(seq, self.undo)

    def _on_wheel(self, e):
        w = e.widget
        if not isinstance(w, tk.Misc) or isinstance(w, tk.Text) or w.winfo_toplevel() is not self:
            return  # 일기 입력칸·다른 창은 각자 스크롤
        self.canvas.yview_scroll(int(-e.delta / 120), "units")

    def _build_menu(self):
        """⋯ 메뉴: 켜진 기능만, 성격별로 묶어서."""
        m = tk.Menu(self, tearoff=0, **self.menu_style)

        def group(items):
            items = [(label, cmd) for feature, label, cmd in items if feature is None or self.has(feature)]
            if items and m.index("end") is not None:
                m.add_separator()
            for label, cmd in items:
                m.add_command(label=label, command=cmd)

        group([("review", "오늘 정리하기", self.open_review), ("stats", "주간 통계", self.open_stats),
               ("events", "일정표 (주 · 2주 · 한 달)", self.open_schedule)])
        group([("goals", "큰 목표", self.open_goals), ("deadlines", "마감 일정 (디데이)", self.open_deadlines),
               ("habits", "습관 관리", self.open_habits), ("mandala", "만다라트", self.open_mandala), (None, "이전 미완료 가져오기", self.carry_over)])
        m.add_separator()
        if self.has("pomodoro"):
            m.add_checkbutton(label="뽀모도로 모드", variable=self.pomo_var, command=self._set_pomo)
        m.add_checkbutton(label="타이머는 한 번에 하나만", variable=self.single_var, command=self._set_single)
        m.add_separator()
        for label, cmd in (("설정 (단축키 · 알림 · 표시)", self.open_settings),
                           ("기능 켜고 끄기", self.open_features),
                           ("백업 · 복원", self.open_backups),
                           ("사용법 · 단축키", self.open_help)):
            m.add_command(label=label, command=cmd)
        return m

    def _show_menu(self):
        b = self.menu_btn
        self.menu = self._build_menu()
        self.menu.tk_popup(b.winfo_rootx(), b.winfo_rooty() + b.winfo_height())

    def _placeholder(self, show):
        if show and not self.entry.get():
            self.entry.insert(0, PLACEHOLDER)
            self.entry.config(fg=C["faint"])
            self._ph_on = True
        elif not show and self._ph_on:
            self.entry.delete(0, "end")
            self.entry.config(fg=C["text"])
            self._ph_on = False

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

    def open_calendar(self):
        if self.cal_popup and self.cal_popup.winfo_exists():
            self.cal_popup.destroy()
            return
        self.cal_popup = CalendarPopup(self, self.date_lbl, self.day, self.go_to)
