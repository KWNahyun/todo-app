"""기록장: 위젯과 따로 여는 큰 창. 왼쪽은 모음 목록, 오른쪽은 고른 모음의 화면.

- 다이어리: 이 파일의 DiaryView
- 목록형 모음(버킷리스트 등): lists.py 의 ListView + SCHEMAS (문구만 더하면 새 모음)
화면은 tk.Frame 을 상속해 refresh(source, force) / save_now() 를 구현하면 됨.
"""
import tkinter as tk
from datetime import date, timedelta
from pathlib import Path
from tkinter import filedialog

from .config import C, FONT, MOODS, WEEKDAYS
from .core import elapsed, fmt_hm
from .lists import SCHEMAS, ListView
from .widgets import CalendarPopup, MoodPicker, draw_face, scroll_area

# 빈 페이지에 하나씩 보여 주는 질문 (날짜마다 바뀜)
PROMPTS = [
    "오늘 가장 좋았던 순간은?", "오늘 새로 알게 된 것 하나는?", "내일의 나에게 한마디",
    "오늘 나를 힘들게 한 것은?", "고마웠던 사람이나 일은?", "오늘 집중이 잘 된 때는 언제였나?",
    "다시 한다면 다르게 할 것은?", "오늘 나를 웃게 한 것은?", "요즘 가장 많이 생각하는 것은?",
]


def day_label(d):
    return f"{d.month}월 {d.day}일 ({WEEKDAYS[d.weekday()]})"


class DiaryView(tk.Frame):
    """다이어리: 왼쪽 달별 목록 · 검색, 오른쪽 넓은 편집 칸 (자동 저장)."""

    def __init__(self, parent, app):
        super().__init__(parent, bg=C["bg"])
        self.app, s = app, app._s
        self.day = app.today
        self.month = self.day.replace(day=1)
        self._job = None
        self._loading = False

        # ---- 왼쪽: 검색 · 달 이동 · 목록 · 내보내기
        left = tk.Frame(self, bg=C["bg"], width=s(300))
        left.pack(side="left", fill="y", padx=(16, 8), pady=14)
        left.pack_propagate(False)
        search_row = tk.Frame(left, bg=C["bg"])
        search_row.pack(fill="x")
        tk.Label(search_row, text="검색", font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"]).pack(side="left")
        self.query = tk.StringVar()
        self.query.trace_add("write", lambda *_: self.draw_list())
        app._field(search_row, textvariable=self.query, font=(FONT, 10)).pack(
            side="left", fill="x", expand=True, padx=(6, 0), ipady=4, ipadx=6)
        nav = tk.Frame(left, bg=C["bg"])
        nav.pack(fill="x", pady=(10, 6))
        arrows = dict(bg=C["bg"], fg=C["muted"], hover=C["btn"], padx=6, pady=0, font=(FONT, 14))
        app._button(nav, "‹", lambda: self.shift_month(-1), **arrows).pack(side="left")
        app._button(nav, "›", lambda: self.shift_month(1), **arrows).pack(side="right")
        self.month_lbl = tk.Label(nav, font=(FONT, 10, "bold"), bg=C["bg"], fg=C["text"])
        self.month_lbl.pack(side="left", expand=True)
        app._button(left, "전체 내보내기 (.md)", self.export, font=(FONT, 9), pady=3).pack(side="bottom", fill="x")
        area, self.list_canvas, self.list_inner = scroll_area(left, C["bg"])
        area.pack(fill="both", expand=True, pady=(0, 8))

        # ---- 오른쪽: 날짜 · 기분 · 그날 요약 · 질문 · 편집 칸
        right = tk.Frame(self, bg=C["bg"])
        right.pack(side="left", fill="both", expand=True, padx=(8, 16), pady=14)
        head = tk.Frame(right, bg=C["bg"])
        head.pack(fill="x")
        app._button(head, "‹", lambda: self.select(self.day - timedelta(days=1)), **arrows).pack(side="left")
        self.date_lbl = tk.Label(head, font=(FONT, 15, "bold"), bg=C["bg"], fg=C["text"], cursor="hand2")
        self.date_lbl.pack(side="left", padx=4)
        self.date_lbl.bind("<Button-1>", lambda e: CalendarPopup(app, self.date_lbl, self.day, self.select))
        app._button(head, "›", lambda: self.select(self.day + timedelta(days=1)), **arrows).pack(side="left")
        app._button(head, "오늘", lambda: self.select(app.today), font=(FONT, 9), pady=2).pack(side="left", padx=6)
        link = tk.Label(head, text="이 날 할 일 보기 ›", font=(FONT, 9), bg=C["bg"], fg=C["muted"], cursor="hand2")
        link.pack(side="right")
        link.bind("<Button-1>", lambda e: (app.go_to(self.day), app.lift()))

        meta = tk.Frame(right, bg=C["bg"])
        meta.pack(fill="x", pady=(8, 0))
        self.mood = MoodPicker(meta, app, lambda: self.day, bg=C["bg"], size=20)
        self.summary = tk.Label(meta, font=(FONT, 9), bg=C["bg"], fg=C["faint"], anchor="w")
        self.summary.pack(side="left", fill="x", expand=True)

        self.prompt = tk.Label(right, font=(FONT, 10), bg=C["moss_bg"], fg=C["moss"], anchor="w",
                               padx=12, pady=6, cursor="hand2")
        self.prompt.bind("<Button-1>", lambda e: self.use_prompt())
        self.text = app._field(right, tk.Text, wrap="word", font=(FONT, 11), padx=16, pady=14, undo=True,
                               spacing1=2, spacing3=6)
        self.text.pack(fill="both", expand=True, pady=(8, 0))
        self.text.bind("<<Modified>>", self._changed)
        foot = tk.Frame(right, bg=C["bg"])
        foot.pack(fill="x", pady=(4, 0))
        self.count = tk.Label(foot, font=(FONT, 8), bg=C["bg"], fg=C["faint"])
        self.count.pack(side="left")
        self.status = tk.Label(foot, font=(FONT, 8), bg=C["bg"], fg=C["faint"])
        self.status.pack(side="right")
        self.load()
        self.draw_list()

    # ---- 날짜 고르기 · 불러오기 · 저장
    def select(self, day):
        self.save_now()
        self.day = day
        if not self.query.get().strip():
            self.month = day.replace(day=1)
        self.load()
        self.draw_list()

    def shift_month(self, n):
        y, m = divmod(self.month.year * 12 + self.month.month - 1 + n, 12)
        self.month = date(y, m + 1, 1)
        self.query.set("")
        self.draw_list()

    def load(self):
        a, iso = self.app, self.day.isoformat()
        self._loading = True
        self.text.delete("1.0", "end")
        self.text.insert("1.0", a.journal.get(iso, ""))
        self.text.edit_reset()
        self.text.edit_modified(False)
        self._loading = False
        self.date_lbl.config(text=day_label(self.day) + ("  · 오늘" if self.day == a.today else ""),
                             fg=C["moss"] if self.day == a.today else C["text"])
        if a.has("mood"):
            self.mood.pack(side="right", before=self.summary)
            self.mood.draw()
        else:
            self.mood.pack_forget()
        self.summary.config(text=self.day_summary())
        self.status.config(text="")
        self._update_prompt()
        self._update_count()

    def _changed(self, _e):
        if self._loading or not self.text.edit_modified():
            return
        self.text.edit_modified(False)
        self.status.config(text="입력 중…")
        self._update_prompt()
        self._update_count()
        if self._job:
            self.after_cancel(self._job)
        self._job = self.after(700, self.save_now)

    def save_now(self):
        if self._job:
            self.after_cancel(self._job)
            self._job = None
        iso = self.day.isoformat()
        text = self.text.get("1.0", "end-1c").rstrip()
        if text == self.app.journal.get(iso, ""):
            return
        self.app.set_journal(iso, text, source=self)
        self.status.config(text="저장됨")
        self.draw_list()

    def refresh(self, source=None, force=False):
        """위젯 등 다른 곳에서 일기·기분이 바뀜. force: 백업 복원처럼 무조건 새 내용으로."""
        if source is self:
            return
        if force and self._job:
            self.after_cancel(self._job)
            self._job = None
        self.draw_list()
        if self._job is None and self.text.get("1.0", "end-1c").rstrip() != \
                self.app.journal.get(self.day.isoformat(), ""):
            self.load()  # 여기서 고치는 중이 아닐 때만 새 내용으로
        else:
            self.mood.draw()

    # ---- 보조 표시
    def day_summary(self):
        """그날 한 일 한 줄 요약."""
        a, iso = self.app, self.day.isoformat()
        ts = a.store.data.get(iso, [])
        parents = {t.get("parent") for t in ts}
        leaves = [t for t in ts if t["id"] not in parents]
        parts = []
        if leaves:
            parts.append(f"할 일 {sum(t['done'] for t in leaves)}/{len(leaves)} 완료")
        total = sum(elapsed(t) for t in ts)
        if total >= 60:
            parts.append(f"{fmt_hm(total)} 기록")
        if a.has("habits"):
            names = [h["name"] for h in a.habits["habits"] if h["id"] in a.habits["log"].get(iso, [])]
            if names:
                parts.append("습관 " + ", ".join(names))
        if a.has("events") and a.events.get(iso):
            parts.append(f"일정 {len(a.events[iso])}개")
        return "  ·  ".join(parts) or "이 날의 할 일 기록은 없어요"

    def _update_prompt(self):
        if self.text.get("1.0", "end-1c").strip():
            self.prompt.pack_forget()
            return
        q = PROMPTS[self.day.toordinal() % len(PROMPTS)]
        self.prompt.config(text=f"오늘의 질문 · {q}   (누르면 질문과 함께 쓰기 시작)")
        self.prompt.pack(fill="x", pady=(8, 0), before=self.text)

    def use_prompt(self):
        q = PROMPTS[self.day.toordinal() % len(PROMPTS)]
        self.text.insert("1.0", f"Q. {q}\n")
        self.text.mark_set("insert", "end")
        self.text.focus_set()

    def _update_count(self):
        n = len(self.text.get("1.0", "end-1c").replace("\n", ""))
        self.count.config(text=f"{n}자" if n else "")

    # ---- 목록
    def draw_list(self):
        a = self.app
        for w in self.list_inner.winfo_children():
            w.destroy()
        q = self.query.get().strip().lower()
        if q:
            isos = sorted((k for k, v in a.journal.items() if q in v.lower()), reverse=True)
            self.month_lbl.config(text=f"검색 결과 {len(isos)}개")
        else:
            prefix = self.month.strftime("%Y-%m")
            isos = sorted({k for k in list(a.journal) + list(a.moods) if k.startswith(prefix)}, reverse=True)
            if self.month == a.today.replace(day=1) and a.today.isoformat() not in isos:
                isos.insert(0, a.today.isoformat())  # 오늘 쓸 자리
            written = sum(1 for k in a.journal if k.startswith(prefix))
            self.month_lbl.config(text=f"{self.month.year}년 {self.month.month}월 · {written}편")
        if not isos:
            tk.Label(self.list_inner, text="이 달에는 기록이 없어요" if not q else "찾는 내용이 없어요",
                     font=(FONT, 9), bg=C["bg"], fg=C["faint"], pady=20).pack()
        for iso in isos:
            self._list_row(iso, q)
        self.list_canvas.yview_moveto(0)

    def _list_row(self, iso, q):
        a, s = self.app, self.app._s
        d = date.fromisoformat(iso)
        sel = d == self.day
        bg = C["moss_bg"] if sel else C["card"]
        row = tk.Frame(self.list_inner, bg=bg, highlightthickness=1,
                       highlightbackground=C["moss"] if sel else C["border"], cursor="hand2")
        row.pack(fill="x", pady=(0, 4), padx=(0, 6))
        top = tk.Frame(row, bg=bg)
        top.pack(fill="x", padx=10, pady=(6, 0))
        tk.Label(top, text=day_label(d) + ("  오늘" if d == a.today else ""), font=(FONT, 10, "bold"), bg=bg,
                 fg=C["moss"] if d == a.today else C["text"]).pack(side="left")
        mood = a.moods.get(iso) if a.has("mood") else None
        if mood:
            size = s(16)
            face = tk.Canvas(top, width=size, height=size, bg=bg, highlightthickness=0)
            draw_face(face, 0, 0, size, mood, MOODS[mood - 1][2], True, C["ink"])
            face.pack(side="right")
        text = a.journal.get(iso, "")
        if not text:
            preview, fg = "아직 안 썼어요", C["faint"]
        elif q:
            i = text.lower().find(q)
            start = max(0, i - 12)
            preview = ("…" if start else "") + text[start:i + len(q) + 28].replace("\n", " ") + "…"
            fg = C["muted"]
        else:
            first = text.strip().splitlines()[0]
            preview, fg = (first[:34] + " …") if len(first) > 34 or "\n" in text.strip() else first, C["muted"]
        tk.Label(row, text=preview, font=(FONT, 9), bg=bg, fg=fg, anchor="w", justify="left",
                 wraplength=s(250)).pack(fill="x", padx=10, pady=(2, 6))
        a._bind_tree(row, "<Button-1>", lambda e: self.select(d))

    # ---- 내보내기
    def export(self, path=None):
        a = self.app
        if path is None:
            path = filedialog.asksaveasfilename(
                parent=self.winfo_toplevel(), title="다이어리 내보내기", defaultextension=".md",
                initialfile=f"다이어리_{a.today:%Y%m%d}.md", filetypes=[("Markdown", "*.md"), ("텍스트", "*.txt")])
        if not path:
            return None
        self.save_now()
        lines = ["# 다이어리", ""]
        for iso in sorted(a.journal):
            d = date.fromisoformat(iso)
            mood = a.moods.get(iso)
            lines += [f"## {iso} ({WEEKDAYS[d.weekday()]})" + (f" · 기분: {MOODS[mood - 1][1]}" if mood else ""),
                      "", a.journal[iso], ""]
        Path(path).write_text("\n".join(lines), encoding="utf-8")
        self.status.config(text=f"{len(a.journal)}편을 내보냈어요")
        return path


class RecordsWindow(tk.Toplevel):
    """기록장 창. 모음이 늘어나면 COLLECTIONS 에 (키, 이름, 화면 만드는 함수, 기능 키) 를 추가."""

    COLLECTIONS = [("diary", "다이어리", DiaryView, None)] + [
        (key, sc["label"], lambda parent, app, k=key: ListView(parent, app, k), key) for key, sc in SCHEMAS.items()
    ]

    def __init__(self, app):
        super().__init__(app)
        self.app, s = app, app._s
        self.title("기록장")
        self.configure(bg=C["bg"])
        self.minsize(s(760), s(520))
        self.side = tk.Frame(self, bg=C["bar"], width=s(150))
        self.side.pack(side="left", fill="y")
        self.side.pack_propagate(False)
        self.body = tk.Frame(self, bg=C["bg"])
        self.body.pack(side="left", fill="both", expand=True)
        self.views = {}
        self.current = None
        self.build_sidebar()
        self.show("diary")
        self.protocol("WM_DELETE_WINDOW", self.close)
        self.bind("<MouseWheel>", self._wheel)
        self.geometry(f"{s(940)}x{s(700)}")
        self.update_idletasks()
        app._window_chrome(self)

    def build_sidebar(self):
        """켜진 모음만 왼쪽에 (기능 켜고 끄기를 바꾸면 다시 부름)."""
        for w in self.side.winfo_children():
            w.destroy()
        tk.Label(self.side, text="기록장", font=(FONT, 13, "bold"), bg=C["bar"], fg=C["text"], anchor="w",
                 padx=14, pady=14).pack(fill="x")
        self.side_btns = {}
        for key, label, _, feature in self.COLLECTIONS:
            if feature and not self.app.has(feature):
                continue
            b = tk.Label(self.side, text=label, font=(FONT, 10), anchor="w", padx=14, pady=6, cursor="hand2")
            b.pack(fill="x")
            b.bind("<Button-1>", lambda e, k=key: self.show(k))
            self.side_btns[key] = b
        if self.current and self.current not in self.side_btns:
            self.show("diary")
        elif self.current:
            self.show(self.current)

    def show(self, key):
        for v in self.views.values():
            v.pack_forget()
        if key not in self.views:
            make = next(c for k, _, c, _ in self.COLLECTIONS if k == key)
            self.views[key] = make(self.body, self.app)
        self.views[key].pack(fill="both", expand=True)
        self.current = key
        for k, b in self.side_btns.items():
            on = k == key
            b.config(bg=C["moss_bg"] if on else C["bar"], fg=C["moss"] if on else C["text"],
                     font=(FONT, 10, "bold" if on else "normal"))

    def show_diary(self, day):
        self.show("diary")
        self.views["diary"].select(day)

    def refresh(self, source=None, force=False):
        for v in self.views.values():
            v.refresh(source, force)

    def _wheel(self, e):
        if isinstance(e.widget, tk.Text):
            return  # 편집 칸은 스스로 스크롤
        view = self.views.get(self.current)
        canvas = getattr(view, "list_canvas", None)
        if canvas:
            canvas.yview_scroll(int(-e.delta / 120), "units")

    def close(self):
        for v in self.views.values():
            v.save_now()
        self.destroy()
