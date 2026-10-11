"""만다라트 창 (9x9)."""
import tkinter as tk
from tkinter import messagebox

from .config import C, FONT
from .core import new_task, normalize_mandala, sub_index


class MandalartWindow(tk.Toplevel):
    """9x9 만다라트. 가운데 = 핵심 목표, 그 주변 8칸 = 세부 목표(바깥 블록 가운데와 연동), 나머지 = 실천."""

    def __init__(self, app):
        super().__init__(app)
        self.app, self.editing = app, None
        s = app._s
        self.title("만다라트")
        self.configure(bg=C["bg"], padx=16, pady=12)
        self.minsize(s(620), s(600))

        head = tk.Frame(self, bg=C["bg"])
        head.pack(fill="x")
        tk.Label(head, text="만다라트", font=(FONT, 14, "bold"), bg=C["bg"], fg=C["text"]).pack(side="left")
        self.progress = tk.Label(head, font=(FONT, 10), bg=C["bg"], fg=C["muted"])
        self.progress.pack(side="left", padx=12)
        app._button(head, "비우기", self.clear, font=(FONT, 9), pady=2).pack(side="right")
        self.status = tk.Label(head, font=(FONT, 9), bg=C["bg"], fg=C["moss"])
        self.status.pack(side="right", padx=10)
        tk.Label(self, text="칸을 클릭해 입력 (Enter 저장 · Tab 다음 칸 · Shift+Enter 줄바꿈)   "
                            "우클릭: 완료 표시 · 오늘 할 일로 보내기 · 큰 목표로 등록",
                 font=(FONT, 8), bg=C["bg"], fg=C["faint"], anchor="w").pack(fill="x", pady=(2, 8))

        grid = tk.Frame(self, bg=C["bg"])
        grid.pack(fill="both", expand=True)
        self.cells = {}
        for b in range(9):
            for c in range(9):
                r, col = (b // 3) * 3 + c // 3, (b % 3) * 3 + c % 3
                frame = tk.Frame(grid, highlightthickness=1, cursor="hand2")
                # 블록 사이는 넓게, 블록 안은 좁게
                frame.grid(row=r, column=col, sticky="nsew",
                           padx=(s(7) if col % 3 == 0 and col else 1, 1),
                           pady=(s(7) if r % 3 == 0 and r else 1, 1))
                label = tk.Label(frame, justify="center", cursor="hand2")
                label.place(relx=0.5, rely=0.5, anchor="center")
                frame.bind("<Configure>", lambda e, lb=label: lb.config(wraplength=max(10, e.width - s(8))))
                for w in (frame, label):
                    w.bind("<Button-1>", lambda e, b=b, c=c: self.edit(b, c))
                    w.bind("<Button-3>", lambda e, b=b, c=c: self.menu(e, b, c))
                self.cells[(b, c)] = (frame, label)
        for i in range(9):
            grid.rowconfigure(i, weight=1, uniform="row", minsize=s(60))
            grid.columnconfigure(i, weight=1, uniform="col", minsize=s(64))

        self.bind("<Escape>", lambda e: self.cancel_edit() if self.editing else self.destroy())
        self.draw()
        self.geometry(f"{s(820)}x{s(790)}")
        self.update_idletasks()
        app._window_chrome(self)

    # --- 데이터 ---
    @staticmethod
    def kind(b, c):
        if b == 4 and c == 4:
            return "center", None, None
        if b == 4:
            return "sub", sub_index(c), None
        if c == 4:
            return "sub", sub_index(b), None
        return "action", sub_index(b), sub_index(c)

    def get(self, kind, s, a):
        d = self.app.mandala
        return d["center"] if kind == "center" else d["subs"][s] if kind == "sub" else d["actions"][s][a]

    def put(self, kind, s, a, value):
        d = self.app.mandala
        if kind == "center":
            d["center"] = value
        elif kind == "sub":
            d["subs"][s] = value
        else:
            d["actions"][s][a] = value
            if not value:
                d["done"][s][a] = False
        self.app.save_mandala()

    # --- 그리기 ---
    def draw(self):
        d = self.app.mandala
        total = sum(1 for s in range(8) for a in range(8) if d["actions"][s][a].strip())
        done = sum(1 for s in range(8) for a in range(8) if d["actions"][s][a].strip() and d["done"][s][a])
        self.progress.config(text=f"실천 {done}/{total} 완료" if total else "")
        for (b, c), (frame, label) in self.cells.items():
            kind, s, a = self.kind(b, c)
            text = self.get(kind, s, a).strip()
            if kind == "center":
                bg, fg, font = C["moss"], C["ink"], (FONT, 12, "bold")
                shown = text or "핵심 목표"
            elif kind == "sub":
                bg, fg, font = C["moss_bg"], C["text"] if text else C["faint"], (FONT, 10, "bold")
                shown = text or f"세부 목표 {s + 1}"
                filled = [x for x in range(8) if d["actions"][s][x].strip()]
                if c == 4 and filled:  # 바깥 블록 가운데에 진행도
                    shown += f"\n{sum(d['done'][s][x] for x in filled)}/{len(filled)}"
            else:
                is_done = d["done"][s][a] and text
                bg = C["done_bg"] if is_done else C["card"]
                fg, font = (C["moss"], (FONT, 9, "overstrike")) if is_done else (C["text"], (FONT, 9))
                shown = ("✓ " + text) if is_done else text
            frame.config(bg=bg, highlightbackground=C["moss"] if kind == "center" else C["border"])
            label.config(text=shown, bg=bg, fg=fg, font=font)

    # --- 편집 ---
    def edit(self, b, c):
        if self.editing:
            self.commit()
        kind, s, a = self.kind(b, c)
        frame, label = self.cells[(b, c)]
        txt = tk.Text(frame, wrap="word", font=label["font"], bg=C["card"], fg=C["text"], relief="flat", bd=0,
                      highlightthickness=2, highlightbackground=C["moss"], highlightcolor=C["moss"],
                      insertbackground=C["moss"], padx=4, pady=4, undo=True)
        txt.insert("1.0", self.get(kind, s, a))
        txt.tag_add("sel", "1.0", "end-1c")
        txt.place(relx=0, rely=0, relwidth=1, relheight=1)
        txt.focus_set()
        txt.bind("<Return>", lambda e: self.commit() or "break")
        txt.bind("<Shift-Return>", lambda e: None)  # 줄바꿈은 그대로
        txt.bind("<Tab>", lambda e: self.commit(move=True) or "break")
        txt.bind("<Escape>", lambda e: self.cancel_edit() or "break")
        txt.bind("<FocusOut>", lambda e: self.commit())
        self.editing = (b, c, txt)

    def commit(self, move=False):
        if not self.editing:
            return
        b, c, txt = self.editing
        self.editing = None
        value = txt.get("1.0", "end-1c").strip()
        txt.destroy()
        self.put(*self.kind(b, c), value)
        self.draw()
        if move:  # 같은 블록의 다음 칸 (가운데 칸은 건너뜀)
            order = [0, 1, 2, 5, 8, 7, 6, 3]  # 시계 방향
            nxt = order[(order.index(c) + 1) % 8] if c in order else 0
            self.edit(b, nxt)

    def cancel_edit(self):
        if self.editing:
            _, _, txt = self.editing
            self.editing = None
            txt.destroy()

    def clear(self):
        if messagebox.askyesno("비우기", "만다라트를 모두 비울까요?\n(오늘 할 일로 보낸 항목은 그대로 남아요)",
                               parent=self):
            self.app.mandala = normalize_mandala({})
            self.app.save_mandala()

    # --- 우클릭 ---
    def menu(self, e, b, c):
        self.commit()
        kind, s, a = self.kind(b, c)
        text = self.get(kind, s, a).strip()
        if not text:
            return
        d, app = self.app.mandala, self.app
        m = tk.Menu(self, tearoff=0, **app.menu_style)
        if kind == "action":
            m.add_command(label="완료 해제" if d["done"][s][a] else "완료 표시", command=lambda: self.toggle_done(s, a))
            m.add_command(label="오늘 할 일로 보내기", command=lambda: self.to_today(s, [a]))
            m.add_separator()
            m.add_command(label="지우기", command=lambda: (self.put(kind, s, a, ""), self.draw()))
        else:
            if kind == "sub":
                m.add_command(label="실천 항목 모두 오늘 할 일로", command=lambda: self.to_today(s, range(8)))
            registered = any(g["title"] == text for g in app.goals)
            m.add_command(label="큰 목표에 등록됨 ✓" if registered else "큰 목표로 등록 (시간 누적)",
                          state="disabled" if registered else "normal",
                          command=lambda: (app.add_goal(text), self.status.config(text=f"'{text}' 큰 목표 등록")))
        m.tk_popup(e.x_root, e.y_root)

    def toggle_done(self, s, a):
        self.app.mandala["done"][s][a] = not self.app.mandala["done"][s][a]
        self.app.save_mandala()

    def to_today(self, s, actions):
        """실천 칸 → 오늘 할 일 ('세부 목표 > 실천' 묶음). 이미 있거나 완료한 칸은 건너뜀."""
        app, d = self.app, self.app.mandala
        tasks = app.store.tasks(app.today)
        sub = d["subs"][s].strip()
        parent = next((t for t in tasks if t["title"] == sub and not t.get("parent")), None) if sub else None
        added = 0
        for a in actions:
            title = d["actions"][s][a].strip()
            if not title or d["done"][s][a]:
                continue
            if any(t.get("mandala") == [s, a] and not t["done"] for t in tasks):
                continue
            if sub and parent is None:
                parent = new_task(sub)
                tasks.append(parent)
            t = new_task(title)
            t["mandala"] = [s, a]
            if parent:
                app._attach(t, parent)
            tasks.append(t)
            added += 1
        app.refresh()
        self.status.config(text=f"오늘 할 일에 {added}개 추가" if added else "추가할 항목이 없어요 (이미 있거나 완료)")
