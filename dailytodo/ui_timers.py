"""시간 관련: 자리 비움 · 절전 확인, 뽀모도로, 알림, 전역 단축키."""
import os
import queue
import time
import tkinter as tk
from datetime import date, datetime

from .config import C, DEFAULT_HOTKEYS, FONT, MONO, POMO_DEFAULTS
from .core import children, elapsed, fmt, fmt_hm, start, stop
from .winapi import HotkeyListener
from .widgets import Toast
from . import dialogs, winapi


class TimerMixin:
    """App 의 일부 — 시간 관련: 자리 비움 · 절전 확인, 뽀모도로, 알림, 전역 단축키."""

    def _set_single(self):
        self.settings["single_timer"] = self.single_var.get()
        self._save_settings()

    def _set_pomo(self):
        self.settings["pomo_on"] = self.pomo_var.get()
        if not self.pomo_var.get():
            self.pomo_end()
        self._save_settings()

    def _running(self):
        return [t for t in self.store.all_tasks() if t["started_at"]]

    def _guard_timers(self):
        """타이머 깜빡 방지: 절전 복귀 · 자리 비움 · 너무 오래 켜진 타이머."""
        now = time.time()
        gap, self._last_tick = now - self._last_tick, now
        if self._pending_away:  # 시작할 때 '꺼져 있던 동안' 확인이 먼저
            return
        running = self._running()
        if not running or self._away_open:
            self._idle_since = None
        elif gap > 120:  # 이벤트 루프가 멈춰 있었음 = 절전/최대 절전
            self._idle_since = None
            self._ask_away(now - gap, "절전 모드였던 동안")
            return
        elif self.settings.get("idle_on", True):
            idle = winapi.idle_seconds()
            if self._idle_since is None and idle >= int(self.settings.get("idle_min", 10)) * 60:
                self._idle_since = now - idle  # 자리 비움 시작 — 돌아오면 물어봄
            elif self._idle_since is not None and idle < 5:
                since, self._idle_since = self._idle_since, None
                self._ask_away(since, "입력이 없던 동안")
                return
        if self.settings.get("long_on", True):
            limit = float(self.settings.get("long_hours", 2)) * 3600
            for t in running:
                if now - t["started_at"] >= limit and self._long_notified.get(t["id"]) != t["started_at"]:
                    self._long_notified[t["id"]] = t["started_at"]
                    self.notify(f"'{t['title']}' 타이머가 {fmt_hm(now - t['started_at'])}째 켜져 있어요",
                                "계속하는 중이 아니라면 정지해 주세요", ("정지", lambda t=t: self.toggle_timer(t)))
        # 1분마다 살아 있다는 표시 — 강제 종료·재부팅 뒤 켜진 타이머를 알아채는 데 사용
        if now - (self.settings.get("heartbeat") or 0) >= 60:
            self.settings["heartbeat"] = now
            self._save_settings()

    def _task_day(self, t):
        return next(date.fromisoformat(k) for k, ts in self.store.data.items() if any(x is t for x in ts))

    def _ask_away(self, since, reason):
        self._pending_away = False
        running = self._running()
        away = time.time() - since
        if not running or away < 60 or self._away_open:
            if self.store.split_at_midnight(self.today):
                self.store.save()
            return
        self._away_open = self._dialog_open = True
        try:
            d = dialogs.AwayDialog(self, since, reason, running)
            self.wait_window(d)
        finally:
            self._away_open = self._dialog_open = False
        if d.choice in ("cut", "cut_stop"):
            for t in running:  # 자리를 비운 시점에 멈춘 것으로
                t["elapsed"] += max(0, since - t["started_at"])
                t["started_at"] = None
            if d.choice == "cut":  # 지금부터 다시 (날짜가 바뀌었으면 오늘 목록의 같은 할 일로)
                for t in running:
                    day = self._task_day(t)
                    if day != self.today:
                        t = self.store.copy_task(t, self.store.data[day.isoformat()], self.store.tasks(self.today))
                        t["done"] = False
                    start(t)
            self.pomo = None
        self._last_tick = time.time()
        self.store.split_at_midnight(self.today)
        self.refresh()

    # ---------- 뽀모도로 ----------
    def _pomo_min(self, key):
        return int(self.settings.get(key, POMO_DEFAULTS[key]))

    def _pomo_tick(self):
        p = self.pomo
        if not p:
            return
        if p["phase"] in ("focus", "break") and time.time() >= p["ends"]:
            self._pomo_advance()
        elif p["phase"] in ("focus", "break"):
            left = max(0, int(p["ends"] - time.time()))
            self.pomo_clock.config(text=f"{left // 60:02d}:{left % 60:02d}")

    def _pomo_advance(self):
        p = self.pomo
        t = self._find(p["tid"])
        title = t["title"] if t else ""
        if p["phase"] == "focus":
            if t:
                stop(t)
                t["pomos"] = t.get("pomos", 0) + 1
            p["count"] += 1
            long_break = p["count"] % self._pomo_min("pomo_every") == 0
            mins = self._pomo_min("pomo_long" if long_break else "pomo_break")
            p.update(phase="break", ends=time.time() + mins * 60)
            self.notify(f"집중 {self._pomo_min('pomo_focus')}분 끝!",
                        f"'{title}' 뽀모 {p['count']}회째 완료 · {mins}분 쉬어요")
        else:
            p.update(phase="ready", ends=None)
            self.notify("휴식 끝!", f"'{title}' 다시 집중해 볼까요?", ("집중 시작", self.pomo_next))
        self.refresh()

    def pomo_next(self):
        t = self.pomo and self._find(self.pomo["tid"])
        if t and not t["done"]:
            if not t["started_at"]:
                self.toggle_timer(t)
        else:
            self.pomo_end()

    def pomo_skip(self):
        if self.pomo:
            self.pomo.update(phase="ready", ends=None)
            self._render_pomo()

    def pomo_end(self):
        if self.pomo and self.pomo["phase"] == "focus":
            t = self._find(self.pomo["tid"])
            self.pomo = None
            if t and t["started_at"]:
                self.toggle_timer(t)
        self.pomo = None
        self._render_pomo()

    def _render_pomo(self):
        bar = self.pomo_bar
        for w in bar.winfo_children():
            w.destroy()
        p = self.pomo
        if not p:
            bar.pack_forget()
            return
        t = self._find(p["tid"])
        focus = p["phase"] == "focus"
        bg = C["running"] if focus else C["card"]
        bar.config(bg=bg, highlightbackground=C["sun"] if focus else C["moss"])
        bar.pack(fill="x", padx=16, pady=(0, 8), before=self.body)
        inner = tk.Frame(bar, bg=bg, padx=10, pady=6)
        inner.pack(fill="x")
        phase = {"focus": "집중", "break": "휴식", "ready": "휴식 끝"}[p["phase"]]
        tk.Label(inner, text=phase, font=(FONT, 10, "bold"), bg=bg,
                 fg=C["sun_text"] if focus else C["moss"]).pack(side="left")
        cycle = self._pomo_min("pomo_every")
        dots = "●" * (p["count"] % cycle) + "○" * (cycle - p["count"] % cycle)
        tk.Label(inner, text=dots, font=(FONT, 8), bg=bg, fg=C["faint"]).pack(side="left", padx=6)
        btn = dict(font=(FONT, 9), pady=2, padx=8)
        if p["phase"] == "ready":
            self._button(inner, "끝내기", self.pomo_end, **btn).pack(side="right")
            self._button(inner, "▶ 집중 시작", self.pomo_next, bg=C["moss"], fg=C["ink"],
                         hover=C["moss_hi"], activebackground=C["moss_hi"], activeforeground=C["ink"],
                         **btn).pack(side="right", padx=(0, 6))
        else:
            self._button(inner, "그만" if focus else "건너뛰기",
                         self.pomo_end if focus else self.pomo_skip, **btn).pack(side="right")
            self.pomo_clock = tk.Label(inner, font=(MONO, 13, "bold"), bg=bg,
                                       fg=C["sun_text"] if focus else C["moss"])
            self.pomo_clock.pack(side="right", padx=8)
        tk.Label(inner, text=t["title"] if t else "", font=(FONT, 9), bg=bg, fg=C["muted"],
                 anchor="w").pack(side="left", fill="x", expand=True)
        self._pomo_tick()

    # ---------- 알림 ----------
    def notify(self, title, body="", action=None):
        """화면 오른쪽 아래 토스트 + 알림음. action = (버튼 글자, 콜백)."""
        self.bell()
        if self.toast and self.toast.winfo_exists():
            self.toast.destroy()
        self.toast = Toast(self, title, body, action)

    def _review_nudge(self):
        if not self.settings.get("review_on", True) or not self.has("review"):
            return
        today = self.today.isoformat()
        if today in (self.settings.get("reviewed"), self.settings.get("nudged")):
            return
        if datetime.now().strftime("%H:%M") >= self.settings.get("review_time", "22:00"):
            self.settings["nudged"] = today
            self._save_settings()
            self.notify("오늘 하루를 정리해 볼까요?", "한 일 · 습관 · 기분 · 한 줄 회고",
                        ("정리하기", self.open_review))

    # ---------- 전역 단축키 ----------
    def register_hotkeys(self, startup=False):
        if self.hotkeys:
            self.hotkeys.stop()
            self.hotkeys = None
        if os.environ.get("DAILY_TODO_NO_HOTKEYS"):  # 자동 테스트: 실행 중인 앱의 단축키와 겹치지 않게
            return []
        keys = self.settings.get("hotkeys", DEFAULT_HOTKEYS)
        bindings = {a: (k["mods"], k["vk"]) for a, k in keys.items() if k}
        self.hotkeys = HotkeyListener(bindings)
        self.hotkeys.start()
        self.hotkeys.ready.wait(1.0)
        failed = [keys[a]["label"] for a in self.hotkeys.failed]
        if failed and startup:
            self.after(800, lambda: self.notify("단축키를 등록하지 못했어요",
                                                f"{', '.join(failed)} — 다른 프로그램이 사용 중이에요. "
                                                "⋯ > 설정에서 바꿀 수 있어요"))
        return failed

    def _poll_hotkeys(self):
        try:
            while self.hotkeys:
                action = self.hotkeys.queue.get_nowait()
                {"show": self.summon, "timer": self.hotkey_timer, "review": self.hotkey_review}[action]()
        except queue.Empty:
            pass
        self._hotkey_job = self.after(80, self._poll_hotkeys)

    def hotkey_timer(self):
        running = [t for t in self.store.all_tasks() if t["started_at"]]
        if running:
            for t in running:
                self.toggle_timer(t)
            self.notify("타이머 정지", ", ".join(f"{t['title']} ({fmt(elapsed(t))})" for t in running))
            return
        tid, title = (self.settings.get("last_task") or [None, None])
        tasks = self.store.tasks(self.today)
        t = (next((x for x in tasks if x["id"] == tid), None)
             or next((x for x in tasks if x["title"] == title and not x["done"]), None))
        if t and not t["done"] and not children(t, tasks):
            if self.day != self.today:
                self.go(0)
            self.toggle_timer(t)
            self.notify("타이머 시작", t["title"])
        else:
            self.summon()
            self.notify("다시 시작할 할 일이 없어요", "할 일 옆의 ▶ 시작을 눌러 주세요")

    def hotkey_review(self):
        self.summon()
        if not self.has("review"):
            return
        self.open_review()
