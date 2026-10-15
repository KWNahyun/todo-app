"""날짜 아래 상단: 일정 타임라인 · 마감(디데이) · 큰 목표."""
import tkinter as tk
import uuid
from datetime import date, datetime, timedelta

from .config import C, DEADLINE_FILE, EVENT_FILE, FONT, GOAL_FILE, MONO, SECTIONS, WEEKDAYS
from .core import children, dday_colors, dday_text, event_dt, fmt_hours, fmt_until, goal_seconds
from .storage import save_json
from .dialogs import EditDeadlineDialog, EventDialog
from .schedule import ScheduleWindow


class TopMixin:
    """App 의 일부 — 날짜 아래 상단: 일정 타임라인 · 마감(디데이) · 큰 목표."""

    # ---------- 상단 (일정 · 마감 · 목표) ----------
    def section_cfg(self, name):
        return self.settings.setdefault("sections", {}).setdefault(name, {"show": True, "open": True})

    def toggle_section(self, name):
        cfg = self.section_cfg(name)
        cfg["open"] = not cfg["open"]
        self._save_settings()
        self.render_top()

    def set_section_shown(self, name, shown):
        self.section_cfg(name)["show"] = shown
        self.section_vars[name].set(shown)
        self._save_settings()
        self.render_top()

    def _chip(self, name, label, info=None, info_fg=None, info_bg=None):
        """접기/펼치기 버튼: '▸ 마감 2 [D-2]'."""
        is_open = self.section_cfg(name)["open"]
        bg = C["btn_hi"] if is_open else C["btn"]
        chip = tk.Frame(self.chip_bar, bg=bg, cursor="hand2")
        chip.pack(side="left", padx=(0, 6))
        tk.Label(chip, text=("▾ " if is_open else "▸ ") + label, font=(FONT, 9, "bold" if is_open else "normal"),
                 bg=bg, fg=C["text"], padx=8, pady=3, cursor="hand2").pack(side="left")
        if info:
            tk.Label(chip, text=info, font=(FONT, 8, "bold"), bg=info_bg or bg, fg=info_fg or C["muted"],
                     padx=5, cursor="hand2").pack(side="left", padx=(0, 6), pady=3, fill="y")
        self._bind_tree(chip, "<Button-1>", lambda e: self.toggle_section(name))

    def _add_link(self, parent, text, cmd, side="left"):
        link = tk.Label(parent, text=text, font=(FONT, 9), bg=C["bg"], fg=C["muted"], cursor="hand2")
        link.pack(side=side, padx=(0, 8) if side == "left" else (8, 0))
        link.bind("<Button-1>", lambda e: cmd())

    def render_top(self):
        for box in (self.chip_bar, self.event_box, self.dday_box, self.goal_box):
            for w in box.winfo_children():
                w.destroy()
            box.pack_forget()
        cfg = {n: dict(self.section_cfg(n), show=self.section_cfg(n)["show"] and self.has(n)) for n, _ in SECTIONS}
        now = datetime.now()
        is_today = self.day == self.today
        evs = sorted(self.events.get(self.day.isoformat(), []), key=lambda e: e["time"])
        upcoming = sorted((d for d in self.deadlines if d["date"] >= self.today.isoformat()),
                          key=lambda d: d["date"])

        # 버튼 줄: 접혀 있어도 다음 일정 시간 / 가장 가까운 마감은 보이게
        if cfg["events"]["show"] and evs:
            nxt = next((e for e in evs if e["time"] and event_dt(self.day, e) >= now), None) if is_today else None
            self._chip("events", f"일정 {len(evs)}", nxt["time"] if nxt else None, C["moss"])
        if cfg["deadlines"]["show"]:
            if upcoming:
                n = (date.fromisoformat(upcoming[0]["date"]) - self.today).days
                bg, fg = dday_colors(n)
                self._chip("deadlines", f"마감 {len(upcoming)}", dday_text(n), fg, bg)
            else:
                self._add_link(self.chip_bar, "+ 마감", self.open_deadlines)
        if cfg["goals"]["show"]:
            if self.goals:
                self._chip("goals", f"목표 {len(self.goals)}")
            else:
                self._add_link(self.chip_bar, "+ 목표", self.open_goals)
        # 오른쪽 끝: 주·2주·한 달 일정을 한 번에 보는 일정표
        if self.has("events"):
            self._add_link(self.chip_bar, "일정표 ›", self.open_schedule, side="right")
        self.chip_bar.pack(fill="x", pady=(0, 6))

        if cfg["events"]["show"] and cfg["events"]["open"] and evs:
            self.event_box.pack(fill="x", pady=(0, 4))
            self._render_event_rows(evs, now, is_today)
        if cfg["deadlines"]["show"] and cfg["deadlines"]["open"] and upcoming:
            self.dday_box.pack(fill="x", pady=(0, 4))
            self._render_deadline_rows(upcoming)
        if cfg["goals"]["show"] and cfg["goals"]["open"] and self.goals:
            self.goal_box.pack(fill="x", pady=(0, 4))
            self._render_goal_rows()

    render_events = render_ddays = render_top  # 일정/마감/목표가 바뀌면 상단 전체를 다시 그림

    def _render_event_rows(self, evs, now, is_today):
        box = self.event_box
        upcoming = [e for e in evs if e["time"] and event_dt(self.day, e) >= now] if is_today else []
        nxt = upcoming[0] if upcoming else None
        for ev in evs:
            dt = event_dt(self.day, ev)  # 시간 미정이면 None — 오늘 안에서는 '지난 일정'으로 흐리지 않음
            past = self.day < self.today or (is_today and dt is not None and dt < now)
            is_next = ev is nxt
            row = tk.Frame(box, bg=C["card"], highlightthickness=1,
                           highlightbackground=C["moss"] if is_next else C["border"], cursor="hand2")
            row.pack(fill="x", pady=(0, 3))
            tk.Frame(row, bg=C["moss"] if is_next else C["card"], width=self._s(3)).pack(side="left", fill="y")
            if ev["time"]:
                tk.Label(row, text=ev["time"], font=(MONO, 11, "bold"), bg=C["card"], width=6,
                         fg=C["moss"] if is_next else C["faint"] if past else C["text"]).pack(side="left", pady=4)
            else:
                tk.Label(row, text="미정", font=(FONT, 9, "bold"), bg=C["card"], width=7,
                         fg=C["faint"] if past else C["muted"]).pack(side="left", pady=4)
            self._button(row, "✕", lambda ev=ev: self.delete_event(self.day, ev), bg=C["card"], fg=C["faint"],
                         hover=C["danger_bg"], padx=6, font=(FONT, 9)).pack(side="right")
            if is_today and not past and dt is not None:
                tk.Label(row, text=fmt_until(dt - now), font=(FONT, 9, "bold" if is_next else "normal"),
                         bg=C["card"], fg=C["moss"] if is_next else C["muted"]).pack(side="right", padx=6)
            title = tk.Label(row, text=ev["title"], anchor="w", bg=C["card"], cursor="hand2",
                             font=(FONT, 10, "bold" if is_next else "normal"),
                             fg=C["faint"] if past else C["text"])
            title.pack(side="left", fill="x", expand=True, padx=(4, 0))
            for w in (row, title):
                w.bind("<Button-1>", lambda e, ev=ev: self.edit_event(self.day, ev))

    def save_events(self):
        save_json(EVENT_FILE, {k: v for k, v in sorted(self.events.items()) if v})
        self._redraw_schedule()

    def _redraw_schedule(self):
        win = getattr(self, "schedule_win", None)
        if win and win.winfo_exists():
            self.after_idle(self._draw_if_open, win)

    def open_schedule(self):
        win = getattr(self, "schedule_win", None)
        if win and win.winfo_exists():
            win.deiconify()
            win.lift()
            win.focus_force()
            return
        self.schedule_win = ScheduleWindow(self)

    def add_event(self, day, hhmm, title):
        self.events.setdefault(day.isoformat(), []).append(
            {"id": uuid.uuid4().hex, "time": hhmm, "title": title, "reminded": False})
        self.save_events()
        self.render_events()

    def delete_event(self, day, ev):
        self.snapshot()
        self.events[day.isoformat()].remove(ev)
        self.save_events()
        self.render_events()
        self.show_snack(f"일정 '{ev['title']}' 삭제했어요")

    def edit_event(self, day, ev):
        self._open_window("event_win", EventDialog, day, ev)

    def _event_reminders(self):
        # 다음 일정 강조·남은 시간은 분이 바뀔 때마다 다시 그림
        now = datetime.now()
        if now.minute != self._event_minute:
            self._event_minute = now.minute
            self.render_events()
        if not self.settings.get("event_remind_on", True) or not self.has("events"):
            return
        mins = int(self.settings.get("event_remind", 10))
        changed = False
        for ev in self.events.get(self.today.isoformat(), []):
            dt = event_dt(self.today, ev)
            if dt is None:  # 시간 미정은 알림 없음
                continue
            if not ev.get("reminded") and dt - timedelta(minutes=mins) <= now < dt:
                ev["reminded"] = True
                changed = True
                self.notify(f"{fmt_until(dt - now)} · {ev['time']} {ev['title']}", "일정 알림")
        if changed:
            self.save_events()

    def _render_deadline_rows(self, upcoming):
        for dl in upcoming[:3]:
            d = date.fromisoformat(dl["date"])
            n = (d - self.today).days
            bg, fg = dday_colors(n)
            sub = None
            status = self._group_status(dl.get("group"))
            if status:
                left, total = status
                if left == 0:
                    sub = f"↳ {dl['group']} · 할 일 모두 완료"
                else:
                    pace = left / max(n, 1)
                    pace_s = f"{pace:.1f}".rstrip("0").rstrip(".")
                    sub = f"↳ {dl['group']} · 남은 {left}/{total}개 · 하루 {pace_s}개"
            self._strip_row(self.dday_box, dday_text(n), bg, fg, dl["title"],
                            f"{d.month}/{d.day} ({WEEKDAYS[d.weekday()]})", sub,
                            lambda dl=dl: self.edit_deadline(dl))  # 누르면 그 마감 수정
        links = tk.Frame(self.dday_box, bg=C["bg"])
        links.pack(fill="x")
        more = f"{len(upcoming) - 3}개 더 · " if len(upcoming) > 3 else ""
        self._add_link(links, f"{more}마감 관리", self.open_deadlines, side="right")

    def _render_goal_rows(self):
        week_ago = (self.today - timedelta(days=6)).isoformat()
        for g in self.goals[:3]:
            total = goal_seconds(g, self.store.data)
            week = goal_seconds(g, self.store.data, since=week_ago)
            right = f"누적 {fmt_hours(total)}"
            ratio = None
            if g.get("target_hours"):
                right = f"{fmt_hours(total)} / {g['target_hours']}시간"
                ratio = min(1.0, total / 3600 / g["target_hours"])
            self._strip_row(self.goal_box, "목표", C["btn"], C["moss"], g["title"], right,
                            f"최근 7일 {fmt_hours(week)}", self.open_goals, ratio)
        links = tk.Frame(self.goal_box, bg=C["bg"])
        links.pack(fill="x")
        more = f"{len(self.goals) - 3}개 더 · " if len(self.goals) > 3 else ""
        self._add_link(links, f"{more}목표 관리", self.open_goals, side="right")

    def _strip_row(self, parent, badge_text, bg, fg, title, right, sub, on_click, ratio=None):
        row = tk.Frame(parent, bg=C["card"], highlightthickness=1,
                       highlightbackground=C["border"], cursor="hand2")
        row.pack(fill="x", pady=(0, 4))
        tk.Label(row, text=badge_text, width=6, font=(FONT, 9, "bold"), bg=bg, fg=fg,
                 pady=3).pack(side="left", fill="y")
        tk.Label(row, text=right, font=(FONT, 9), bg=C["card"], fg=C["muted"]).pack(side="right", padx=8)
        col = tk.Frame(row, bg=C["card"])
        col.pack(side="left", fill="x", expand=True, padx=8, pady=2)
        tk.Label(col, text=title, anchor="w", font=(FONT, 10), bg=C["card"], fg=C["text"]).pack(fill="x")
        if sub:
            tk.Label(col, text=sub, anchor="w", font=(FONT, 8), bg=C["card"], fg=C["faint"]).pack(fill="x")
        if ratio is not None:
            bar = tk.Canvas(col, height=self._s(3), bg=C["btn"], highlightthickness=0)
            bar.pack(fill="x", pady=(2, 2))
            bar.bind("<Configure>", lambda e: (bar.delete("all"), bar.create_rectangle(
                0, 0, e.width * ratio, e.height, fill=C["moss"], width=0)))
        self._bind_tree(row, "<Button-1>", lambda e: on_click())

    def _group_status(self, title):
        """묶음(상위 할 일)의 (남은 하위 수, 전체 하위 수). 오늘 없으면 가장 최근 날짜 기준."""
        if not title:
            return None
        for key in sorted((k for k in self.store.data if k <= self.today.isoformat()), reverse=True):
            ts = self.store.data[key]
            g = next((t for t in ts if t["title"] == title and not t.get("parent")), None)
            if g:
                kids = children(g, ts) or [g]  # 하위가 없으면 그 할 일 하나로 계산
                return sum(not c["done"] for c in kids), len(kids)
        return None

    def save_goals(self):
        save_json(GOAL_FILE, self.goals)
        self.render_ddays()

    def save_deadlines(self):
        self.deadlines.sort(key=lambda d: d["date"])
        save_json(DEADLINE_FILE, self.deadlines)
        self.render_ddays()
        self._redraw_schedule()

    def _linked_deadline(self, title):
        today = self.today.isoformat()
        linked = [d for d in self.deadlines if d.get("group") == title and d["date"] >= today]
        return min(linked, key=lambda d: d["date"]) if linked else None

    def edit_deadline(self, dl, anchor=None):
        self._open_window("dl_edit_win", EditDeadlineDialog, dl, anchor=anchor)

    def add_deadline(self, day, title, group=None):
        dl = {"id": uuid.uuid4().hex, "title": title, "date": day.isoformat(), "group": group}
        self.deadlines.append(dl)
        self.save_deadlines()
        self.refresh()
        return dl

    def link_deadline(self, dl, title):
        dl["group"] = None if dl.get("group") == title else title
        self.save_deadlines()
        self.refresh()

    def link_goal(self, g, title):
        if title == g["title"]:
            return  # 목표와 같은 이름은 항상 연결됨
        titles = g.setdefault("titles", [])
        titles.remove(title) if title in titles else titles.append(title)
        self.save_goals()

    def add_goal(self, title, target_hours=None):
        if any(g["title"] == title for g in self.goals):
            return
        self.goals.append({"id": uuid.uuid4().hex, "title": title, "target_hours": target_hours,
                           "titles": [], "created": self.today.isoformat()})
        self.save_goals()
