"""기록장의 목록형 모음. 왼쪽 목록 · 오른쪽 상세, 화면 하나(ListView)가 SCHEMAS 설정을 보고 그림.

진행 방식(mode)
- "done":   완료 체크 하나 (버킷리스트 · 가고 싶은 곳)        항목: done, done_on
- "stages": 단계 (보고 싶음 → 보는 중 → 다 봄)              항목: stage(번호), done_on(마지막 단계가 된 날)
- "log":    체크 없는 날짜별 기록 (취미)                   항목: date
추가 칸(fields): (키, 이름, 종류[, 선택지])  종류 = text · choice · rating · file
데이터: app.collections[모음 키] = [{id, title, tags[], note, created, ...}, ...]
"""
import os
import re
import tkinter as tk
import uuid
import webbrowser
from datetime import date
from tkinter import filedialog, messagebox
from urllib.parse import quote

from .config import C, FONT
from .core import new_task
from .widgets import CalendarPopup, CheckRow, scroll_area

SCHEMAS = {
    "bucket": dict(
        label="버킷리스트", mode="done",
        done_word="이룸", undone_tab="남은 것", done_tab="이룬 것",
        add_hint="이루고 싶은 것을 적고 Enter   (#여행 오로라 보기 처럼 #로 분류)",
        note_label="이루고 싶은 이유 · 이룬 소감",
        empty="언젠가 해 보고 싶은 것을 하나씩 적어 보세요.\n작은 것도 좋아요.",
        pick="왼쪽에서 하나를 고르면 이유와 소감을 적을 수 있어요.",
        celebrate="'{title}'을(를) 이뤘어요! 축하해요",
        task_group="버킷리스트", to_goal=True,
    ),
    "places": dict(
        label="가고 싶은 곳", mode="done",
        done_word="다녀옴", undone_tab="가 볼 곳", done_tab="다녀온 곳",
        add_hint="가고 싶은 곳을 적고 Enter   (#카페 #제주 처럼 #로 분류)",
        fields=[("where", "지역 · 주소", "text"), ("rating", "다녀와 보니 (별점)", "rating")],
        subtitle=["where"], map_field="where",
        note_label="가고 싶은 이유 · 다녀온 후기",
        empty="가 보고 싶은 곳을 모아 두세요.\n카페, 여행지, 전시, 맛집 무엇이든.",
        pick="왼쪽에서 하나를 고르면 주소와 후기를 적을 수 있어요.",
        celebrate="'{title}'에 다녀왔어요!",
        task_group="가고 싶은 곳",
    ),
    "reviews": dict(
        label="콘텐츠 리뷰", mode="stages",
        stages=["보고 싶음", "보는 중", "다 봄"],
        add_hint="책 · 영화 · 드라마 제목을 적고 Enter   (#추천 처럼 #로 분류)",
        fields=[("kind", "종류", "choice", ["책", "영화", "드라마", "기타"]), ("rating", "별점", "rating"),
                ("oneline", "한줄평", "text")],
        subtitle=["kind", "rating", "oneline"], filter_field="kind",
        note_label="감상 · 인상 깊은 장면이나 구절",
        empty="보고 싶은 것, 본 것을 남겨 보세요.\n한줄평과 별점만 적어도 좋아요.",
        pick="왼쪽에서 하나를 고르면 별점과 감상을 적을 수 있어요.",
        task_group="콘텐츠",
    ),
    "hobby": dict(
        label="취미 기록", mode="log",
        add_hint="오늘의 취미 기록 제목을 적고 Enter   (#그림 #기타 처럼 #로 분류)",
        fields=[("file", "사진 · 파일", "file")],
        note_label="무엇을 했는지 · 느낀 점",
        empty="취미 활동을 날짜별로 남겨 보세요.\n그림, 악기, 운동, 요리 무엇이든.",
        pick="왼쪽에서 하나를 고르면 내용을 적고 사진을 붙일 수 있어요.",
    ),
}


def split_tags(text):
    """'#여행 오로라 보기 #겨울' → ('오로라 보기', ['여행', '겨울'])."""
    tags = list(dict.fromkeys(re.findall(r"#(\S+)", text)))
    title = re.sub(r"\s*#\S+", "", text).strip()
    return title, tags


def short_date(iso):
    return iso.replace("-", ".") if iso else ""


def stars(n):
    return "★" * n + "☆" * (5 - n) if n else ""


class ListView(tk.Frame):
    """목록형 모음 화면. key 로 SCHEMAS 의 설정을 고름."""

    def __init__(self, parent, app, key):
        super().__init__(parent, bg=C["bg"])
        self.app, self.key, self.sc = app, key, SCHEMAS[key]
        self.mode = self.sc["mode"]
        s = app._s
        self.status_filter, self.tag, self.choice = "all", None, None
        self.sel_id = None
        self._note_job = None
        self.status = None
        self.field_entries = {}

        # ---- 왼쪽: 진행도 · 추가 · 거르기 · 목록
        left = tk.Frame(self, bg=C["bg"], width=s(400))
        left.pack(side="left", fill="y", padx=(16, 8), pady=14)
        left.pack_propagate(False)
        head = tk.Frame(left, bg=C["bg"])
        head.pack(fill="x")
        tk.Label(head, text=self.sc["label"], font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.progress_lbl = tk.Label(head, font=(FONT, 9), bg=C["bg"], fg=C["muted"])
        self.progress_lbl.pack(side="right")
        self.bar = tk.Canvas(left, height=s(5), bg=C["btn"], highlightthickness=0)
        self.bar.pack(fill="x", pady=(6, 10))
        self.bar.bind("<Configure>", lambda e: self._draw_bar())

        self.entry = app._field(left, font=(FONT, 10))
        self.entry.pack(fill="x", ipady=6, ipadx=6)
        self.entry.bind("<Return>", lambda e: self.add())
        tk.Label(left, text=self.sc["add_hint"], font=(FONT, 8), bg=C["bg"], fg=C["faint"], anchor="w").pack(
            fill="x", pady=(2, 8))

        self.filters = tk.Frame(left, bg=C["bg"])
        self.filters.pack(fill="x")
        self.choices = tk.Frame(left, bg=C["bg"])  # 콘텐츠 종류 같은 선택지 거르기
        if self.sc.get("filter_field"):
            self.choices.pack(fill="x", pady=(4, 0))
        search = tk.Frame(left, bg=C["bg"])
        search.pack(fill="x", pady=(6, 6))
        tk.Label(search, text="검색", font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"]).pack(side="left")
        self.query = tk.StringVar()
        self.query.trace_add("write", lambda *_: self.draw_list())
        app._field(search, textvariable=self.query, font=(FONT, 10)).pack(
            side="left", fill="x", expand=True, padx=(6, 0), ipady=3, ipadx=6)
        area, self.list_canvas, self.list_inner = scroll_area(left, C["bg"])
        area.pack(fill="both", expand=True)

        # ---- 오른쪽: 고른 항목 상세
        self.detail = tk.Frame(self, bg=C["bg"])
        self.detail.pack(side="left", fill="both", expand=True, padx=(8, 16), pady=14)
        self.draw_list()
        self.draw_detail()

    # ---------------------------------------------------------------- 데이터
    @property
    def items(self):
        return self.app.collections.setdefault(self.key, [])

    def item(self, iid):
        return next((x for x in self.items if x["id"] == iid), None)

    def save(self):
        self.app.save_collections(source=self)

    def is_done(self, it):
        if self.mode == "stages":
            return it.get("stage", 0) == len(self.sc["stages"]) - 1
        return bool(it.get("done"))

    def add(self):
        title, tags = split_tags(self.entry.get())
        if not title:
            self.bell()
            return
        today = self.app.today.isoformat()
        it = {"id": uuid.uuid4().hex, "title": title, "tags": tags, "note": "", "created": today}
        if self.mode == "done":
            it.update(done=False, done_on=None)
        elif self.mode == "stages":
            it.update(stage=0, done_on=None)
        else:
            it["date"] = today
        for key, _, kind, *opts in self.sc.get("fields", []):
            if kind == "choice":  # 지금 거르고 있는 종류가 있으면 그걸로, 없으면 '기타'
                it[key] = self.choice or opts[0][-1]
        self.items.append(it)
        self.entry.delete(0, "end")
        self.status_filter = "all"
        self.save()
        self.select(it["id"])

    def set_done(self, it, done):
        """완료 체크 방식: 이룸/다녀옴."""
        if bool(it.get("done")) == done:
            return
        it["done"] = done
        it["done_on"] = self.app.today.isoformat() if done else None
        self._after_status(it, done)

    def set_stage(self, it, stage):
        """단계 방식: 마지막 단계(다 봄)가 되면 그날을 기록."""
        if it.get("stage", 0) == stage:
            return
        was_done = self.is_done(it)
        it["stage"] = stage
        done = self.is_done(it)
        if done and not was_done:
            it["done_on"] = self.app.today.isoformat()
        elif not done:
            it["done_on"] = None
        self._after_status(it, done and not was_done)

    def _after_status(self, it, celebrate):
        self.save()
        if celebrate and self.sc.get("celebrate"):
            self.app.notify(self.sc["celebrate"].format(title=it["title"]), self.sc["label"])
        self.draw_list()
        self.draw_detail()

    def set_date(self, it, field, day):
        it[field] = day.isoformat()
        self.save()
        self.draw_list()
        self.draw_detail()

    def set_field(self, it, key, value):
        if it.get(key) != value:
            it[key] = value
            self.save()
            self.draw_list()
            self.draw_detail()

    def delete(self, it):
        if not messagebox.askyesno("삭제", f"'{it['title']}'을(를) 지울까요?", parent=self.winfo_toplevel()):
            return
        self.items.remove(it)
        self.sel_id = None
        self.save()
        self.draw_list()
        self.draw_detail()

    def to_today(self, it):
        """오늘 할 일에 '모음 이름 > 제목' 으로 (이미 있으면 그대로)."""
        a = self.app
        tasks = a.store.tasks(a.today)
        group = self.sc["task_group"]
        parent = next((t for t in tasks if t["title"] == group and not t.get("parent")), None)
        if parent and any(t["title"] == it["title"] and t.get("parent") == parent["id"] and not t["done"]
                          for t in tasks):
            self.status.config(text="이미 오늘 할 일에 있어요")
            return
        a.snapshot()
        if parent is None:
            parent = new_task(group)
            tasks.append(parent)
        t = new_task(it["title"])
        a._attach(t, parent)
        tasks.append(t)
        a.refresh()
        self.status.config(text=f"오늘 할 일에 '{group} > {it['title']}' 로 넣었어요")

    def to_goal(self, it):
        exists = any(g["title"] == it["title"] for g in self.app.goals)
        self.app.add_goal(it["title"])
        self.status.config(text="이미 큰 목표에 있어요" if exists else "큰 목표로 등록했어요 (같은 이름 할 일의 시간이 쌓여요)")

    def open_map(self, it):
        where = (it.get(self.sc["map_field"]) or "").strip() or it["title"]
        webbrowser.open("https://map.naver.com/p/search/" + quote(where))

    # ---------------------------------------------------------------- 목록
    def tabs(self):
        if self.mode == "done":
            return [("all", "전체"), ("todo", self.sc["undone_tab"]), ("done", self.sc["done_tab"])]
        if self.mode == "stages":
            return [("all", "전체")] + [(f"s{i}", name) for i, name in enumerate(self.sc["stages"])]
        return [("all", "전체")]

    def visible(self):
        q = self.query.get().strip().lower()
        f = self.sc.get("filter_field")
        out = []
        for it in self.items:
            sf = self.status_filter
            if sf == "todo" and self.is_done(it) or sf == "done" and not self.is_done(it):
                continue
            if sf.startswith("s") and it.get("stage", 0) != int(sf[1:]):
                continue
            if self.tag and self.tag not in it["tags"]:
                continue
            if f and self.choice and it.get(f) != self.choice:
                continue
            text = " ".join([it["title"], it.get("note", ""), " ".join(it["tags"])] +
                            [str(it.get(k, "")) for k, *_ in self.sc.get("fields", [])])
            if q and q not in text.lower():
                continue
            out.append(it)
        if self.mode == "log":  # 최근 기록이 위
            return sorted(out, key=lambda x: (x.get("date") or "", x.get("created") or ""), reverse=True)
        if self.mode == "stages":  # 보는 중 → 보고 싶음 → 다 봄(최근 순)
            order = {1: 0, 0: 1}
            todo = sorted((x for x in out if not self.is_done(x)), key=lambda x: order.get(x.get("stage", 0), 2))
        else:
            todo = [x for x in out if not self.is_done(x)]
        done = sorted((x for x in out if self.is_done(x)), key=lambda x: x.get("done_on") or "", reverse=True)
        return todo + done

    def _draw_bar(self):
        total = len(self.items)
        w = self.bar.winfo_width()
        self.bar.delete("all")
        if self.mode == "log":
            month = self.app.today.strftime("%Y-%m")
            n = sum(1 for x in self.items if (x.get("date") or "").startswith(month))
            self.progress_lbl.config(text=f"기록 {total}개 · 이번 달 {n}개" if total else "")
            return
        done = sum(self.is_done(x) for x in self.items)
        word = self.sc["done_word"] if self.mode == "done" else self.sc["stages"][-1]
        self.progress_lbl.config(text=f"{total}개 중 {done}개 {word}" if total else "")
        if total and done:
            self.bar.create_rectangle(0, 0, w * done / total, self.app._s(5), fill=C["moss"], width=0)

    def _chip_button(self, parent, label, on, cmd):
        return self.app._button(parent, label, cmd, font=(FONT, 9), pady=2, padx=10,
                                bg=C["moss"] if on else C["btn"], fg=C["ink"] if on else C["text"])

    def _draw_filters(self):
        for w in self.filters.winfo_children() + self.choices.winfo_children():
            w.destroy()
        if len(self.tabs()) > 1:
            for key, label in self.tabs():
                self._chip_button(self.filters, label, self.status_filter == key,
                                  lambda k=key: self.set_filter(k)).pack(side="left", padx=(0, 4))
        if self.tag:
            chip = tk.Label(self.filters, text=f"#{self.tag}  ✕", font=(FONT, 9, "bold"), bg=C["moss_bg"],
                            fg=C["moss"], padx=8, pady=2, cursor="hand2")
            chip.pack(side="right")
            chip.bind("<Button-1>", lambda e: self.set_tag(None))
        f = self.sc.get("filter_field")
        if f:
            opts = next(o for k, _, kind, *o in self.sc["fields"] if k == f)[0]
            for value in [None] + opts:
                self._chip_button(self.choices, value or "모든 종류", self.choice == value,
                                  lambda v=value: self.set_choice(v)).pack(side="left", padx=(0, 4))

    def set_filter(self, key):
        self.status_filter = key
        self.draw_list()

    def set_tag(self, tag):
        self.tag = tag
        self.draw_list()

    def set_choice(self, value):
        self.choice = value
        self.draw_list()

    def draw_list(self):
        for w in self.list_inner.winfo_children():
            w.destroy()
        self._draw_filters()
        self._draw_bar()
        shown = self.visible()
        if not self.items:
            tk.Label(self.list_inner, text=self.sc["empty"], font=(FONT, 10), bg=C["bg"], fg=C["faint"],
                     justify="center", pady=40).pack(fill="x")
        elif not shown:
            tk.Label(self.list_inner, text="조건에 맞는 항목이 없어요", font=(FONT, 9), bg=C["bg"],
                     fg=C["faint"], pady=20).pack()
        for it in shown:
            self._card(it)

    def _check(self, parent, it, bg):
        s, k = self.app._s(20), self.app.px
        c = tk.Canvas(parent, width=s, height=s, bg=bg, highlightthickness=0, cursor="hand2")
        if it.get("done"):
            c.create_oval(1, 1, s - 1, s - 1, fill=C["moss"], outline=C["moss"])
            c.create_line(5.5 * k, 10 * k, 8.5 * k, 13.5 * k, 14.5 * k, 6.5 * k, fill=C["ink"], width=2 * k,
                          capstyle="round", joinstyle="round")
        else:
            c.create_oval(1, 1, s - 1, s - 1, outline=C["muted"], width=1.5 * k)
        c.bind("<Button-1>", lambda e: self.set_done(it, not it.get("done")))
        return c

    def _stage_pill(self, parent, it, bg):
        """단계 표시. 누르면 다음 단계로 (다 봄 → 보고 싶음 으로 순환)."""
        st = it.get("stage", 0)
        last = len(self.sc["stages"]) - 1
        colors = {0: (C["btn"], C["muted"]), last: (C["moss"], C["ink"])}
        pbg, pfg = colors.get(st, (C["sun"], C["on_sun"]))
        pill = tk.Label(parent, text=self.sc["stages"][st], font=(FONT, 8, "bold"), bg=pbg, fg=pfg, padx=6,
                        width=6, cursor="hand2")
        pill.bind("<Button-1>", lambda e: self.set_stage(it, (st + 1) % (last + 1)))
        return pill

    def _subtitle(self, it):
        parts = []
        for key in self.sc.get("subtitle", []):
            v = it.get(key)
            if not v:
                continue
            parts.append(stars(v) if key == "rating" else f"“{v}”" if key == "oneline" else str(v))
        return "  ·  ".join(parts)

    def _card(self, it):
        a = self.app
        sel = it["id"] == self.sel_id
        bg = C["moss_bg"] if sel else C["card"]
        done = self.is_done(it)
        row = tk.Frame(self.list_inner, bg=bg, highlightthickness=1,
                       highlightbackground=C["moss"] if sel else C["border"], cursor="hand2")
        row.pack(fill="x", pady=(0, 4), padx=(0, 6))
        if self.mode == "done":
            self._check(row, it, bg).pack(side="left", padx=(10, 8), pady=8, anchor="n")
        elif self.mode == "stages":
            self._stage_pill(row, it, bg).pack(side="left", padx=(10, 8), pady=9, anchor="n")
        else:
            tk.Label(row, text=short_date(it.get("date"))[5:], font=(FONT, 9, "bold"), bg=bg, fg=C["moss"],
                     width=6).pack(side="left", padx=(8, 4), pady=9, anchor="n")
        if done and it.get("done_on"):
            word = self.sc["done_word"] if self.mode == "done" else ""
            tk.Label(row, text=f"{short_date(it['done_on'])} {word}".strip(), font=(FONT, 8, "bold"), bg=bg,
                     fg=C["moss"]).pack(side="right", padx=8, anchor="n", pady=9)
        col = tk.Frame(row, bg=bg)
        col.pack(side="left", fill="x", expand=True, pady=6)
        title = it["title"] + ("  ✎" if it.get("note") else "") + ("  · 사진" if it.get("file") else "")
        tk.Label(col, text=title, font=(FONT, 10, "normal" if done and self.mode != "log" else "bold"), bg=bg,
                 fg=C["moss"] if done and self.mode == "done" else C["text"], anchor="w", justify="left",
                 wraplength=a._s(240)).pack(fill="x")
        sub = self._subtitle(it)
        if sub:
            tk.Label(col, text=sub, font=(FONT, 8), bg=bg, fg=C["muted"], anchor="w", justify="left",
                     wraplength=a._s(240)).pack(fill="x")
        if it["tags"]:
            tags = tk.Frame(col, bg=bg)
            tags.pack(fill="x", pady=(2, 0))
            for tag in it["tags"]:
                lb = tk.Label(tags, text=f"#{tag}", font=(FONT, 8), bg=C["btn"], fg=C["muted"], padx=5,
                              cursor="hand2")
                lb.pack(side="left", padx=(0, 4))
                lb.bind("<Button-1>", lambda e, t=tag: self.set_tag(t))
        clickable = [row, col] + [w for w in col.winfo_children() if isinstance(w, tk.Label)]
        if self.mode == "log":
            clickable.append(row.winfo_children()[0])
        for w in clickable:
            w.bind("<Button-1>", lambda e: self.select(it["id"]))

    # ---------------------------------------------------------------- 상세
    def select(self, iid):
        self.save_now()
        self.sel_id = iid
        self.draw_list()
        self.draw_detail()

    def _label(self, text, top=12):
        tk.Label(self.detail, text=text, font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"], anchor="w").pack(
            fill="x", pady=(top, 4))

    def _date_button(self, parent, it, field):
        btn = self.app._button(parent, f"{short_date(it.get(field))} ▾", None, font=(FONT, 9), pady=2)
        btn.config(command=lambda: CalendarPopup(self.app, btn, date.fromisoformat(it[field]),
                                                 lambda day: self.set_date(it, field, day)))
        return btn

    def draw_detail(self):
        a, d = self.app, self.detail
        for w in d.winfo_children():
            w.destroy()
        self.field_entries = {}
        it = self.item(self.sel_id)
        if not it:
            tk.Label(d, text=self.sc["pick"], font=(FONT, 10), bg=C["bg"], fg=C["faint"], pady=60).pack()
            self.status = tk.Label(d, bg=C["bg"])
            return
        self.title_e = a._field(d, font=(FONT, 14, "bold"))
        self.title_e.insert(0, it["title"])
        self.title_e.pack(fill="x", ipady=6, ipadx=8)
        self._label("태그  (#여행 #경험 처럼)")
        self.tags_e = a._field(d, font=(FONT, 10))
        self.tags_e.insert(0, " ".join(f"#{t}" for t in it["tags"]))
        self.tags_e.pack(fill="x", ipady=4, ipadx=8)
        for w in (self.title_e, self.tags_e):
            w.bind("<Return>", lambda e: self._commit_fields())
            w.bind("<FocusOut>", lambda e: self._commit_fields())

        self._draw_status(it)
        for key, name, kind, *opts in self.sc.get("fields", []):
            self._draw_field(it, key, name, kind, opts)

        self._label(self.sc["note_label"])
        self.note = a._field(d, tk.Text, wrap="word", font=(FONT, 11), padx=14, pady=12, undo=True, height=6)
        self.note.insert("1.0", it.get("note", ""))
        self.note.edit_modified(False)
        self.note.pack(fill="both", expand=True)
        self.note.bind("<<Modified>>", self._note_changed)

        btns = tk.Frame(d, bg=C["bg"])
        btns.pack(fill="x", pady=(10, 0))
        small = dict(font=(FONT, 9), pady=3)
        if self.sc.get("task_group"):
            a._button(btns, "오늘 할 일로 보내기", lambda: self.to_today(it), **small).pack(side="left", padx=(0, 6))
        if self.sc.get("to_goal") and a.has("goals"):
            a._button(btns, "큰 목표로 등록", lambda: self.to_goal(it), **small).pack(side="left", padx=(0, 6))
        if self.sc.get("map_field"):
            a._button(btns, "지도에서 찾기", lambda: self.open_map(it), **small).pack(side="left", padx=(0, 6))
        a._button(btns, "삭제", lambda: self.delete(it), fg=C["danger"], hover=C["danger_bg"], **small).pack(
            side="right")
        self.status = tk.Label(d, font=(FONT, 9), bg=C["bg"], fg=C["moss"], anchor="w")
        self.status.pack(fill="x", pady=(6, 0))

    def _draw_status(self, it):
        a = self.app
        row = tk.Frame(self.detail, bg=C["bg"])
        row.pack(fill="x", pady=(12, 0))
        if self.mode == "done":
            var = tk.BooleanVar(value=bool(it.get("done")))
            var.trace_add("write", lambda *_: self.set_done(it, var.get()))
            CheckRow(row, a, self.sc["done_word"], var, font=(FONT, 10, "bold")).pack(side="left")
            if it.get("done"):
                self._date_button(row, it, "done_on").pack(side="left", padx=8)
        elif self.mode == "stages":
            for i, name in enumerate(self.sc["stages"]):
                self._chip_button(row, name, it.get("stage", 0) == i,
                                  lambda i=i: self.set_stage(it, i)).pack(side="left", padx=(0, 4))
            if self.is_done(it) and it.get("done_on"):
                self._date_button(row, it, "done_on").pack(side="left", padx=8)
        else:
            tk.Label(row, text="날짜", font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"]).pack(side="left")
            self._date_button(row, it, "date").pack(side="left", padx=8)
        tk.Label(row, text=f"{short_date(it.get('created'))} 추가", font=(FONT, 8), bg=C["bg"],
                 fg=C["faint"]).pack(side="right")

    def _draw_field(self, it, key, name, kind, opts):
        a = self.app
        self._label(name)
        row = tk.Frame(self.detail, bg=C["bg"])
        row.pack(fill="x")
        if kind == "text":
            e = a._field(row, font=(FONT, 10))
            e.insert(0, it.get(key, ""))
            e.pack(fill="x", ipady=4, ipadx=8)
            e.bind("<Return>", lambda ev: self._commit_fields())
            e.bind("<FocusOut>", lambda ev: self._commit_fields())
            self.field_entries[key] = e
        elif kind == "choice":
            for value in opts[0]:
                self._chip_button(row, value, it.get(key) == value,
                                  lambda v=value: self.set_field(it, key, v)).pack(side="left", padx=(0, 4))
        elif kind == "rating":  # 같은 별을 다시 누르면 지움
            cur = it.get(key) or 0
            for n in range(1, 6):
                star = tk.Label(row, text="★", font=(FONT, 16), bg=C["bg"], cursor="hand2",
                                fg=C["sun"] if n <= cur else C["border"])
                star.pack(side="left")
                star.bind("<Button-1>", lambda ev, n=n: self.set_field(it, key, 0 if n == cur else n))
        elif kind == "file":
            path = it.get(key, "")
            tk.Label(row, text=os.path.basename(path) if path else "없음", font=(FONT, 9), bg=C["bg"],
                     fg=C["text"] if path else C["faint"], anchor="w").pack(side="left", fill="x", expand=True)
            small = dict(font=(FONT, 9), pady=2)
            if path:
                a._button(row, "열기", lambda: self.open_file(path), **small).pack(side="right")
                a._button(row, "✕", lambda: self.set_field(it, key, ""), **small).pack(side="right", padx=4)
            a._button(row, "찾아보기", lambda: self.pick_file(it, key), **small).pack(side="right")

    def pick_file(self, it, key):
        path = filedialog.askopenfilename(parent=self.winfo_toplevel(), title="사진 · 파일 고르기",
                                          filetypes=[("사진", "*.jpg *.jpeg *.png *.gif *.webp *.heic"),
                                                     ("모든 파일", "*.*")])
        if path:
            self.set_field(it, key, path)

    def open_file(self, path):
        if os.path.exists(path):
            os.startfile(path)
        elif self.status:
            self.status.config(text="파일을 찾을 수 없어요 (옮겨졌거나 지워졌어요)", fg=C["danger"])

    def _commit_fields(self):
        it = self.item(self.sel_id)
        if not it or not self.title_e.winfo_exists():
            return
        title = self.title_e.get().strip()
        _, tags = split_tags(self.tags_e.get())
        changed = False
        if title and (title != it["title"] or tags != it["tags"]):
            it["title"], it["tags"] = title, tags
            changed = True
        for key, e in self.field_entries.items():
            v = e.get().strip()
            if v != it.get(key, ""):
                it[key] = v
                changed = True
        if changed:
            self.save()
            self.draw_list()

    def _note_changed(self, _e):
        if not self.note.edit_modified():
            return
        self.note.edit_modified(False)
        if self._note_job:
            self.after_cancel(self._note_job)
        self._note_job = self.after(700, self._save_note)

    def _save_note(self):
        self._note_job = None
        it = self.item(self.sel_id)
        if not it or not self.note.winfo_exists():
            return
        text = self.note.get("1.0", "end-1c").rstrip()
        if text != it.get("note", ""):
            it["note"] = text
            self.save()
            self.draw_list()

    # ---------------------------------------------------------------- 기록장과의 약속
    def save_now(self):
        if self._note_job:
            self.after_cancel(self._note_job)
            self._save_note()
        if self.item(self.sel_id) and getattr(self, "title_e", None) is not None:
            try:
                self._commit_fields()
            except tk.TclError:
                pass

    def refresh(self, source=None, force=False):
        if source is self:
            return
        if force and self._note_job:
            self.after_cancel(self._note_job)
            self._note_job = None
        self.draw_list()
        self.draw_detail()
