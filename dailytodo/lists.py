"""기록장의 목록형 모음 (버킷리스트 등). 왼쪽 목록 · 오른쪽 상세, 화면 하나로 여러 모음을 다룸.

새 모음은 SCHEMAS 에 문구만 더하면 됨. 데이터는 app.collections[키] = [항목, ...]
항목: {id, title, tags[], done, done_on(YYYY-MM-DD|None), note, created(YYYY-MM-DD)}
"""
import re
import tkinter as tk
import uuid
from datetime import date
from tkinter import messagebox

from .config import C, FONT
from .core import new_task
from .widgets import CalendarPopup, CheckRow, scroll_area

SCHEMAS = {
    "bucket": dict(
        label="버킷리스트",
        done_word="이룸", undone_tab="남은 것", done_tab="이룬 것",
        add_hint="이루고 싶은 것을 적고 Enter   (#여행 오로라 보기 처럼 #로 분류)",
        note_label="이루고 싶은 이유 · 이룬 소감",
        empty="언젠가 해 보고 싶은 것을 하나씩 적어 보세요.\n작은 것도 좋아요.",
        pick="왼쪽에서 하나를 고르면 이유와 소감을 적을 수 있어요.",
        celebrate="'{title}'을(를) 이뤘어요! 축하해요",
        task_group="버킷리스트",
    ),
}


def split_tags(text):
    """'#여행 오로라 보기 #겨울' → ('오로라 보기', ['여행', '겨울'])."""
    tags = list(dict.fromkeys(re.findall(r"#(\S+)", text)))
    title = re.sub(r"\s*#\S+", "", text).strip()
    return title, tags


def short_date(iso):
    return iso.replace("-", ".") if iso else ""


class ListView(tk.Frame):
    """목록형 모음 화면. key 로 SCHEMAS 의 문구를 고름."""

    def __init__(self, parent, app, key):
        super().__init__(parent, bg=C["bg"])
        self.app, self.key, self.sc = app, key, SCHEMAS[key]
        s = app._s
        self.status_filter, self.tag = "all", None
        self.sel_id = None
        self._note_job = None

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

    # ---- 데이터
    @property
    def items(self):
        return self.app.collections.setdefault(self.key, [])

    def item(self, iid):
        return next((x for x in self.items if x["id"] == iid), None)

    def save(self):
        self.app.save_collections(source=self)

    def add(self):
        title, tags = split_tags(self.entry.get())
        if not title:
            self.bell()
            return
        it = {"id": uuid.uuid4().hex, "title": title, "tags": tags, "done": False, "done_on": None,
              "note": "", "created": self.app.today.isoformat()}
        self.items.append(it)
        self.entry.delete(0, "end")
        if self.status_filter == "done":
            self.status_filter = "all"
        self.save()
        self.select(it["id"])

    def set_done(self, it, done):
        if it["done"] == done:
            return
        it["done"] = done
        it["done_on"] = self.app.today.isoformat() if done else None
        self.save()
        if done:
            self.app.notify(self.sc["celebrate"].format(title=it["title"]), self.sc["label"])
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
        """오늘 할 일에 '버킷리스트 > 제목' 으로 (이미 있으면 그대로)."""
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

    # ---- 목록
    def visible(self):
        q = self.query.get().strip().lower()
        out = []
        for it in self.items:
            if self.status_filter == "todo" and it["done"] or self.status_filter == "done" and not it["done"]:
                continue
            if self.tag and self.tag not in it["tags"]:
                continue
            if q and q not in (it["title"] + " " + it.get("note", "") + " " + " ".join(it["tags"])).lower():
                continue
            out.append(it)
        todo = [x for x in out if not x["done"]]
        done = sorted((x for x in out if x["done"]), key=lambda x: x["done_on"] or "", reverse=True)
        return todo + done

    def _draw_bar(self):
        total, done = len(self.items), sum(x["done"] for x in self.items)
        self.progress_lbl.config(text=f"{total}개 중 {done}개 {self.sc['done_word']}" if total else "")
        w = self.bar.winfo_width()
        self.bar.delete("all")
        if total and done:
            self.bar.create_rectangle(0, 0, w * done / total, self.app._s(5), fill=C["moss"], width=0)

    def _draw_filters(self):
        a = self.app
        for w in self.filters.winfo_children():
            w.destroy()
        for key, label in (("all", "전체"), ("todo", self.sc["undone_tab"]), ("done", self.sc["done_tab"])):
            on = self.status_filter == key
            b = a._button(self.filters, label, lambda k=key: self.set_filter(k), font=(FONT, 9), pady=2, padx=10,
                          bg=C["moss"] if on else C["btn"], fg=C["ink"] if on else C["text"])
            b.pack(side="left", padx=(0, 4))
        if self.tag:
            chip = tk.Label(self.filters, text=f"#{self.tag}  ✕", font=(FONT, 9, "bold"), bg=C["moss_bg"],
                            fg=C["moss"], padx=8, pady=2, cursor="hand2")
            chip.pack(side="right")
            chip.bind("<Button-1>", lambda e: self.set_tag(None))

    def set_filter(self, key):
        self.status_filter = key
        self.draw_list()

    def set_tag(self, tag):
        self.tag = tag
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
        if it["done"]:
            c.create_oval(1, 1, s - 1, s - 1, fill=C["moss"], outline=C["moss"])
            c.create_line(5.5 * k, 10 * k, 8.5 * k, 13.5 * k, 14.5 * k, 6.5 * k, fill=C["ink"], width=2 * k,
                          capstyle="round", joinstyle="round")
        else:
            c.create_oval(1, 1, s - 1, s - 1, outline=C["muted"], width=1.5 * k)
        c.bind("<Button-1>", lambda e: self.set_done(it, not it["done"]))
        return c

    def _card(self, it):
        a = self.app
        sel = it["id"] == self.sel_id
        bg = C["moss_bg"] if sel else C["card"]
        row = tk.Frame(self.list_inner, bg=bg, highlightthickness=1,
                       highlightbackground=C["moss"] if sel else C["border"], cursor="hand2")
        row.pack(fill="x", pady=(0, 4), padx=(0, 6))
        self._check(row, it, bg).pack(side="left", padx=(10, 8), pady=8, anchor="n")
        if it["done"]:
            tk.Label(row, text=f"{short_date(it['done_on'])} {self.sc['done_word']}", font=(FONT, 8, "bold"),
                     bg=bg, fg=C["moss"]).pack(side="right", padx=8, anchor="n", pady=9)
        col = tk.Frame(row, bg=bg)
        col.pack(side="left", fill="x", expand=True, pady=6)
        title = it["title"] + ("  ✎" if it.get("note") else "")
        tk.Label(col, text=title, font=(FONT, 10, "bold" if not it["done"] else "normal"), bg=bg,
                 fg=C["moss"] if it["done"] else C["text"], anchor="w", justify="left",
                 wraplength=a._s(250)).pack(fill="x")
        if it["tags"]:
            tags = tk.Frame(col, bg=bg)
            tags.pack(fill="x", pady=(2, 0))
            for tag in it["tags"]:
                lb = tk.Label(tags, text=f"#{tag}", font=(FONT, 8), bg=C["btn"], fg=C["muted"], padx=5,
                              cursor="hand2")
                lb.pack(side="left", padx=(0, 4))
                lb.bind("<Button-1>", lambda e, t=tag: self.set_tag(t))
        for w in [row, col] + col.winfo_children()[:1]:
            w.bind("<Button-1>", lambda e: self.select(it["id"]))

    # ---- 상세
    def select(self, iid):
        self.save_now()
        self.sel_id = iid
        self.draw_list()
        self.draw_detail()

    def draw_detail(self):
        a, d = self.app, self.detail
        for w in d.winfo_children():
            w.destroy()
        it = self.item(self.sel_id)
        if not it:
            tk.Label(d, text=self.sc["pick"], font=(FONT, 10), bg=C["bg"], fg=C["faint"], pady=60).pack()
            self.status = tk.Label(d, bg=C["bg"])
            return
        label = lambda text, top=12: tk.Label(d, text=text, font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"],
                                              anchor="w").pack(fill="x", pady=(top, 4))
        self.title_e = a._field(d, font=(FONT, 14, "bold"))
        self.title_e.insert(0, it["title"])
        self.title_e.pack(fill="x", ipady=6, ipadx=8)
        label("태그  (#여행 #경험 처럼)")
        self.tags_e = a._field(d, font=(FONT, 10))
        self.tags_e.insert(0, " ".join(f"#{t}" for t in it["tags"]))
        self.tags_e.pack(fill="x", ipady=4, ipadx=8)
        for w in (self.title_e, self.tags_e):
            w.bind("<Return>", lambda e: self._commit_fields())
            w.bind("<FocusOut>", lambda e: self._commit_fields())

        state = tk.Frame(d, bg=C["bg"])
        state.pack(fill="x", pady=(12, 0))
        done_var = tk.BooleanVar(value=it["done"])
        done_var.trace_add("write", lambda *_: self.set_done(it, done_var.get()))
        CheckRow(state, a, self.sc["done_word"], done_var, font=(FONT, 10, "bold")).pack(side="left")
        if it["done"]:
            btn = a._button(state, f"{short_date(it['done_on'])} ▾", None, font=(FONT, 9), pady=2)
            btn.config(command=lambda: CalendarPopup(a, btn, date.fromisoformat(it["done_on"]),
                                                     lambda day: self._set_done_on(it, day)))
            btn.pack(side="left", padx=8)
        tk.Label(state, text=f"{short_date(it.get('created'))} 추가", font=(FONT, 8), bg=C["bg"],
                 fg=C["faint"]).pack(side="right")

        label(self.sc["note_label"])
        self.note = a._field(d, tk.Text, wrap="word", font=(FONT, 11), padx=14, pady=12, undo=True, height=8)
        self.note.insert("1.0", it.get("note", ""))
        self.note.edit_modified(False)
        self.note.pack(fill="both", expand=True)
        self.note.bind("<<Modified>>", self._note_changed)

        btns = tk.Frame(d, bg=C["bg"])
        btns.pack(fill="x", pady=(10, 0))
        a._button(btns, "오늘 할 일로 보내기", lambda: self.to_today(it), font=(FONT, 9), pady=3).pack(side="left")
        if a.has("goals"):
            a._button(btns, "큰 목표로 등록", lambda: self.to_goal(it), font=(FONT, 9), pady=3).pack(
                side="left", padx=6)
        a._button(btns, "삭제", lambda: self.delete(it), font=(FONT, 9), pady=3, fg=C["danger"],
                  hover=C["danger_bg"]).pack(side="right")
        self.status = tk.Label(d, font=(FONT, 9), bg=C["bg"], fg=C["moss"], anchor="w")
        self.status.pack(fill="x", pady=(6, 0))

    def _set_done_on(self, it, day):
        it["done_on"] = day.isoformat()
        self.save()
        self.draw_list()
        self.draw_detail()

    def _commit_fields(self):
        it = self.item(self.sel_id)
        if not it or not self.title_e.winfo_exists():
            return
        title = self.title_e.get().strip()
        _, tags = split_tags(self.tags_e.get())
        if title and (title != it["title"] or tags != it["tags"]):
            it["title"], it["tags"] = title, tags
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

    # ---- 기록장과의 약속
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
