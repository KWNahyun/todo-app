"""할 일 목록: 그리기, 드래그 정렬, 우클릭 메뉴, 할 일 동작, 되돌리기."""
import copy
import time
import tkinter as tk
from datetime import date
from tkinter import messagebox

from .config import C, FONT, MONO, WEEKDAYS
from .core import (
    children, dday_colors, dday_text, elapsed, fmt, fmt_hm, new_task, over_estimate, parse_event, start,
    stop, total_time,
)
from .dialogs import TaskDialog


class TaskListMixin:
    """App 의 일부 — 할 일 목록: 그리기, 드래그 정렬, 우클릭 메뉴, 할 일 동작, 되돌리기."""

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

    # ---------- 되돌리기 ----------
    def snapshot(self):
        """바꾸기 직전 상태를 저장 (할 일 + 일정, 최근 30번)."""
        self._undo.append((copy.deepcopy(self.store.data), copy.deepcopy(self.events)))
        del self._undo[:-30]

    def undo(self, e=None):
        if e is not None:
            w = e.widget
            if isinstance(w, (tk.Entry, tk.Text)):  # 입력 중인 글자는 입력칸이 알아서 되돌림
                return None
        if not self._undo:
            self.show_snack("되돌릴 작업이 없어요", undo=False)
            return "break"
        data, events = self._undo.pop()
        # 측정된 시간은 지금 값을 유지 (되돌리기 때문에 기록한 시간이 사라지지 않게)
        live = {t["id"]: t for t in self.store.all_tasks()}
        mandala_changed = False
        for ts in data.values():
            for t in ts:
                if t["id"] in live:
                    for k in ("elapsed", "started_at", "pomos"):
                        if k in live[t["id"]]:
                            t[k] = live[t["id"]][k]
                    if t.get("mandala") and t["done"] != live[t["id"]]["done"]:  # 만다라트 칸도 같이 되돌림
                        s, a = t["mandala"]
                        self.mandala["done"][s][a] = t["done"]
                        mandala_changed = True
        if mandala_changed:
            self.save_mandala()
        self.store.data, self.events = data, events
        self.save_events()
        self.refresh()
        self.after_idle(self.render_top)
        self.show_snack("되돌렸어요", undo=False)
        return "break"

    def show_snack(self, text, undo=True):
        bar = self.snack
        for w in bar.winfo_children():
            w.destroy()
        tk.Label(bar, text=text, font=(FONT, 10), bg=C["text"], fg=C["card"], padx=12, pady=6).pack(side="left")
        if undo:
            self._button(bar, "되돌리기 (Ctrl+Z)", self.undo, bg=C["text"], fg=C["sun_hi"], hover="#2c5139",
                         activebackground="#2c5139", activeforeground=C["sun_hi"], font=(FONT, 9, "bold"),
                         padx=10).pack(side="left", padx=(0, 4))
        bar.place(relx=0.5, rely=1.0, y=-self._s(10), anchor="s")
        bar.lift()
        if self._snack_job:
            self.after_cancel(self._snack_job)
        self._snack_job = self.after(6000, bar.place_forget)

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
        dl = self._linked_deadline(t["title"]) if self.has("deadlines") else None
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
                self.snapshot()
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
        if not t.get("parent") and (self.has("deadlines") or self.has("goals")):
            m.add_separator()
        if not t.get("parent") and self.has("deadlines"):
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
        if not t.get("parent") and self.has("goals"):
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

    def add(self):
        text = "" if self._ph_on else self.entry.get().strip()
        if not text:
            return
        event = parse_event(text) if self.has("events") else None
        if event:  # '13:30 회의' → 보고 있는 날짜의 일정
            self.entry.delete(0, "end")
            self.add_event(self.day, *event)
            return
        tasks = self.store.tasks(self.day)
        ptitle, sep, ctitle = (s.strip() for s in text.partition(">"))
        if sep and not (ptitle and ctitle):
            self.bell()  # 'KAMP >' 처럼 한쪽이 비어 있으면 입력 대기
            return
        self.snapshot()
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
        self.snapshot()
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
        self.snapshot()
        for x in [t] + children(t, self.store.tasks(self.day)):
            x["done"] = done
            if done:
                stop(x)
            if x.get("mandala"):  # 만다라트 실천 칸에도 완료 표시
                s, a = x["mandala"]
                self.mandala["done"][s][a] = done
                self.save_mandala()
        self.refresh()

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
        before = (copy.deepcopy(self.store.data), copy.deepcopy(self.events))
        self._dialog_open = True
        try:
            d = TaskDialog(self, t, total_time(t, self.store.tasks(self.day)))
            self.wait_window(d)
        finally:
            self._dialog_open = False
        if d.saved:
            self._undo.append(before)
            self.refresh()

    def delete(self, t):
        # 확인 창 대신 바로 지우고, 아래 알림 줄의 '되돌리기'(또는 Ctrl+Z)로 복구
        tasks = self.store.tasks(self.day)
        kids = children(t, tasks)
        self.snapshot()
        for x in [t] + kids:
            tasks.remove(x)
        self.refresh()
        extra = f" (하위 {len(kids)}개 포함)" if kids else ""
        self.show_snack(f"'{t['title']}' 삭제했어요{extra}")

    def carry_over(self):
        key = self.day.isoformat()
        prev_days = [k for k, v in self.store.data.items() if k < key and v]
        if not prev_days:
            self._dialog(messagebox.showinfo, "가져오기", "이전 날짜에 할 일이 없습니다.")
            return
        prev_key = max(prev_days)
        prev, cur = self.store.data[prev_key], self.store.tasks(self.day)
        parents = {t.get("parent") for t in prev}
        self.snapshot()
        before = len(cur)
        # 미완료인 '실제 할 일'(하위가 없는 것)만 가져오고, 상위는 필요할 때 함께 만들어짐
        for t in prev:
            if not t["done"] and t["id"] not in parents:
                stop(t)
                self.store.copy_task(t, prev, cur)
        if len(cur) == before:
            self._undo.pop()
            self._dialog(messagebox.showinfo, "가져오기", f"{prev_key}에 가져올 미완료 항목이 없습니다.")
            return
        self.refresh()
        self.show_snack(f"{prev_key[5:].replace('-', '/')}의 미완료 {len(cur) - before}개를 가져왔어요")
