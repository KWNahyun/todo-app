"""주간 통계 창."""
import tkinter as tk
from datetime import timedelta

from .config import C, FONT, MOODS, WEEKDAYS
from .core import elapsed, fmt_hm, fmt_hours, goal_seconds, over_estimate, total_time
from .widgets import draw_face


class StatsWindow(tk.Toplevel):
    """최근 7일 막대그래프 + 오래 한 일 + 예상 시간 적중률."""

    def __init__(self, app):
        super().__init__(app)
        self.app = app
        self.end = app.today
        self.title("주간 통계")
        self.configure(bg=C["bg"])
        self.resizable(False, False)

        top = tk.Frame(self, bg=C["bg"], pady=12)
        top.pack(fill="x", padx=16)
        nav = dict(bg=C["bg"], fg=C["muted"], hover=C["btn"], padx=10, pady=0, font=(FONT, 16))
        app._button(top, "‹", lambda: self.shift(-7), **nav).pack(side="left")
        self.range_lbl = tk.Label(top, font=(FONT, 13, "bold"), bg=C["bg"], fg=C["text"])
        self.range_lbl.pack(side="left", expand=True)
        self.next_btn = app._button(top, "›", lambda: self.shift(7), **nav)
        self.next_btn.pack(side="right")
        # 기준: 기록한 시간 / 완료한 할 일 개수 (선택은 기억)
        seg = tk.Frame(self, bg=C["bg"])
        seg.pack(fill="x", padx=16, pady=(0, 10))
        tk.Label(seg, text="기준", font=(FONT, 9, "bold"), bg=C["bg"], fg=C["muted"]).pack(side="left", padx=(0, 6))
        self.basis_btns = {}
        for key, label in (("time", "시간"), ("done", "완료한 일")):
            b = app._button(seg, label, lambda k=key: self.set_basis(k), font=(FONT, 9), pady=2, padx=12)
            b.pack(side="left", padx=(0, 2))
            self.basis_btns[key] = b
        self.body = tk.Frame(self, bg=C["bg"])
        self.body.pack(fill="both", expand=True, padx=16, pady=(0, 16))
        self.bind("<Escape>", lambda e: self.destroy())
        self.draw()
        self.update_idletasks()
        app._window_chrome(self)

    def shift(self, days):
        self.end = min(self.end + timedelta(days=days), self.app.today)
        self.draw()

    @property
    def basis(self):
        return self.app.settings.get("stats_basis", "time")

    def set_basis(self, key):
        self.app.settings["stats_basis"] = key
        self.app._save_settings()
        self.draw()

    def _section(self, text, parent, top=14):
        tk.Label(parent, text=text, font=(FONT, 10, "bold"), bg=C["bg"], fg=C["moss"],
                 anchor="w").pack(fill="x", pady=(top, 6))

    def draw(self):
        a, s = self.app, self.app._s
        for w in self.body.winfo_children():
            w.destroy()
        days = [self.end - timedelta(days=i) for i in range(6, -1, -1)]
        isos = [d.isoformat() for d in days]
        per_day = [a.store.data.get(iso, []) for iso in isos]
        tasks = [t for ts in per_day for t in ts]
        parent_ids = {t.get("parent") for t in tasks}
        leaves = [t for t in tasks if t["id"] not in parent_ids]  # 상위 할 일은 개수에서 제외
        done = sum(t["done"] for t in leaves)
        pomos = sum(t.get("pomos", 0) for t in tasks)
        self.range_lbl.config(text=f"{days[0]:%m.%d} – {days[-1]:%m.%d}")
        self.next_btn.config(state="disabled" if self.end >= a.today else "normal")
        by_time = self.basis == "time"
        for key, b in self.basis_btns.items():
            on = key == self.basis
            b.config(bg=C["moss"] if on else C["btn"], fg=C["ink"] if on else C["text"])
            b.bind("<Leave>", lambda e, b=b, on=on: b.config(bg=C["moss"] if on else C["btn"]))

        # 기준에 따라: 하루 값, 값 표시, 한 할 일의 몫
        def done_leaves(ts):
            pids = {t.get("parent") for t in ts}
            return [t for t in ts if t["id"] not in pids and t["done"]]
        if by_time:
            values = [sum(elapsed(t) for t in ts) for ts in per_day]
            show = lambda v: f"{int(v) // 3600}:{int(v) // 60 % 60:02d}"
        else:
            values = [len(done_leaves(ts)) for ts in per_day]
            show = lambda v: f"{v}개"
        active = sum(1 for v in values if v > 0)

        # 왼쪽: 시간 · 완료 / 오른쪽: 습관 · 목표 (내용이 있을 때만)
        left = tk.Frame(self.body, bg=C["bg"])
        left.pack(side="left", fill="y", anchor="n")
        right = tk.Frame(self.body, bg=C["bg"], width=s(300))

        kpi = tk.Frame(left, bg=C["bg"])
        kpi.pack(fill="x")
        if by_time:
            tiles = [("총 시간", fmt_hm(sum(values))),
                     ("하루 평균", fmt_hm(sum(values) / active) if active else "–"),
                     ("완료", f"{done} / {len(leaves)}")]
        else:
            days_with_tasks = sum(1 for ts in per_day if ts)
            tiles = [("완료한 일", f"{done}개"),
                     ("하루 평균", f"{done / days_with_tasks:.1f}개".replace(".0개", "개") if days_with_tasks else "–"),
                     ("완료율", f"{done * 100 // len(leaves)}%" if leaves else "–")]
        if pomos:
            tiles.append(("뽀모", f"{pomos}회"))
        for i, (label, value) in enumerate(tiles):
            f = tk.Frame(kpi, bg=C["card"], padx=12, pady=8, highlightthickness=1,
                         highlightbackground=C["border"])
            f.pack(side="left", fill="x", expand=True, padx=(0 if i == 0 else 8, 0))
            tk.Label(f, text=label, font=(FONT, 9), bg=C["card"], fg=C["muted"]).pack(anchor="w")
            tk.Label(f, text=value, font=(FONT, 14, "bold"), bg=C["card"], fg=C["text"]).pack(anchor="w")

        # 날짜별 막대그래프 + 그날의 기분
        self._section("날짜별 시간 · 기분" if by_time else "날짜별 완료한 일 · 기분", left)
        W, H = s(520), s(222)
        cv = tk.Canvas(left, width=W, height=H, bg=C["bg"], highlightthickness=0)
        cv.pack()
        base = H - s(70)
        chart_h = base - s(24)
        peak = max(values) or 1
        slot = W / 7
        face = s(20)
        cv.create_line(0, base, W, base, fill=C["border"], width=s(1))
        for i, (d, v) in enumerate(zip(days, values)):
            cx = slot * i + slot / 2
            is_today = d == a.today
            if v > 0:
                h = max(s(2), chart_h * v / peak)
                cv.create_rectangle(cx - slot * 0.28, base - h, cx + slot * 0.28, base,
                                    fill=C["moss_hi"] if is_today else C["moss"], width=0)
                cv.create_text(cx, base - h - s(4), text=show(v), anchor="s", fill=C["text"], font=(FONT, 9))
            cv.create_text(cx, base + s(6), text=WEEKDAYS[d.weekday()], anchor="n",
                           fill=C["moss"] if is_today else C["muted"], font=(FONT, 10, "bold"))
            cv.create_text(cx, base + s(22), text=f"{d.month}/{d.day}", anchor="n",
                           fill=C["faint"], font=(FONT, 8))
            mood = a.moods.get(d.isoformat()) if a.has("mood") else None
            if mood:
                draw_face(cv, cx - face / 2, base + s(44), face, mood, MOODS[mood - 1][2], True, C["ink"])
            else:
                cv.create_text(cx, base + s(44) + face / 2, text="·", fill=C["border"], font=(FONT, 10))

        # 가장 오래 한 일 / 가장 많이 끝낸 일 — 하위 할 일은 상위 묶음(예: 'KAMP 경진대회')으로 합산
        self._section("가장 오래 한 일" if by_time else "가장 많이 끝낸 일", left)
        agg = {}
        for ts in per_day:
            by_id = {t["id"]: t for t in ts}
            for t in (ts if by_time else done_leaves(ts)):
                key = by_id[t["parent"]]["title"] if t.get("parent") in by_id else t["title"]
                agg[key] = agg.get(key, 0) + (elapsed(t) if by_time else 1)
        top = sorted(((v, k) for k, v in agg.items() if v >= (60 if by_time else 1)), reverse=True)[:5]
        if not top:
            tk.Label(left, text="아직 기록된 시간이 없어요" if by_time else "이 기간에 끝낸 일이 없어요",
                     font=(FONT, 9), bg=C["bg"], fg=C["faint"], anchor="w").pack(fill="x")
        for v, k in top:
            r = tk.Frame(left, bg=C["bg"])
            r.pack(fill="x", pady=(0, 4))
            tk.Label(r, text=fmt_hm(v) if by_time else f"{v}개", font=(FONT, 9), bg=C["bg"],
                     fg=C["muted"]).pack(side="right")
            tk.Label(r, text=k, font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")
            bar = tk.Canvas(left, width=W, height=s(4), bg=C["card"], highlightthickness=0)
            bar.pack(fill="x", pady=(0, 6))
            bar.create_rectangle(0, 0, W * v / top[0][0], s(4), fill=C["moss"], width=0)

        # 습관: 7일 체크 격자
        has_right = False
        habits = a.habits["habits"] if a.has("habits") else []
        if habits:
            has_right = True
            self._section("습관", right, top=0)
            head = tk.Frame(right, bg=C["bg"])
            head.pack(fill="x")
            cell = s(18)
            grid_w = cell * 7 + s(3) * 6
            hc = tk.Canvas(head, width=grid_w, height=s(16), bg=C["bg"], highlightthickness=0)
            hc.pack(side="right", padx=(0, s(34)))
            for i, d in enumerate(days):
                hc.create_text(i * (cell + s(3)) + cell / 2, s(8), text=WEEKDAYS[d.weekday()],
                               fill=C["faint"], font=(FONT, 8))
            for h in habits:
                r = tk.Frame(right, bg=C["bg"])
                r.pack(fill="x", pady=(2, 2))
                n = sum(h["id"] in a.habits["log"].get(iso, []) for iso in isos)
                tk.Label(r, text=f"{n}/7", font=(FONT, 9), bg=C["bg"], fg=C["muted"], width=4).pack(side="right")
                gc = tk.Canvas(r, width=grid_w, height=cell, bg=C["bg"], highlightthickness=0)
                gc.pack(side="right")
                for i, iso in enumerate(isos):
                    on = h["id"] in a.habits["log"].get(iso, [])
                    x = i * (cell + s(3))
                    gc.create_rectangle(x, 0, x + cell, cell, width=0,
                                        fill=C["moss"] if on else C["btn"])
                tk.Label(r, text=h["name"], font=(FONT, 10), bg=C["bg"], fg=C["text"],
                         anchor="w").pack(side="left", fill="x", expand=True)

        # 큰 목표: 이번 주에 쌓은 시간
        if a.goals and a.has("goals"):
            has_right = True
            self._section("큰 목표 (이번 기간)", right, top=14 if habits else 0)
            for g in a.goals:
                week = goal_seconds(g, {iso: ts for iso, ts in zip(isos, per_day)})
                total = goal_seconds(g, {k: v for k, v in a.store.data.items() if k <= isos[-1]})
                r = tk.Frame(right, bg=C["bg"])
                r.pack(fill="x", pady=(0, 4))
                tk.Label(r, text=f"+{fmt_hours(week)}  (누적 {fmt_hours(total)})", font=(FONT, 9),
                         bg=C["bg"], fg=C["muted"]).pack(side="right")
                tk.Label(r, text=g["title"], font=(FONT, 10), bg=C["bg"], fg=C["text"],
                         anchor="w").pack(side="left", fill="x", expand=True)

        # 예상 시간 적중률 (완료 + 목표가 있는 일만)
        est = [(t, total_time(t, ts)) for ts in per_day for t in ts if t["done"] and t.get("estimate")]
        if est:
            has_right = True
            self._section("예상 시간", right, top=14 if (habits or a.goals) else 0)
            within = sum(not over_estimate(t, secs) for t, secs in est)
            tk.Label(right, text=f"목표 안에 끝낸 일  {within} / {len(est)}   ({within * 100 // len(est)}%)",
                     font=(FONT, 10), bg=C["bg"], fg=C["text"], anchor="w").pack(fill="x")

        if has_right:
            right.pack(side="left", fill="y", anchor="n", padx=(s(12), 0))
