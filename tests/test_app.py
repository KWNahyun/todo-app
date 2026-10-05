"""Daily Todo 회귀 테스트.

실행:  python -m unittest discover -s tests -v
- 임시 폴더의 데이터로만 동작해서 실제 할 일·일기는 건드리지 않음
- 전역 단축키는 끔 (실행 중인 앱과 겹치지 않게)
- 테스트 중 창이 잠깐 깜빡일 수 있음
"""
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import time
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

DATA_DIR = Path(tempfile.mkdtemp(prefix="dailytodo-test-"))
os.environ["DAILY_TODO_DATA"] = str(DATA_DIR / "tasks.json")
os.environ["DAILY_TODO_NO_HOTKEYS"] = "1"

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("todo", ROOT / "todo.pyw")
todo = importlib.util.module_from_spec(_spec)
sys.modules["todo"] = todo
_spec.loader.exec_module(todo)

TODAY = date.today()


def iso(n=0):
    return (TODAY + timedelta(days=n)).isoformat()


def task(id_, title, elapsed=0.0, started=None, **kw):
    return {"id": id_, "title": title, "done": False, "elapsed": elapsed, "started_at": started, **kw}


class E:
    """가짜 마우스 이벤트."""

    def __init__(self, y=0, x=0):
        self.x_root, self.y_root = x, y


class AppCase(unittest.TestCase):
    """테스트마다 빈 데이터 폴더 + 필요한 파일로 앱을 새로 띄움."""

    files = {}
    settings = {}

    def setUp(self):
        for p in DATA_DIR.iterdir():
            shutil.rmtree(p) if p.is_dir() else p.unlink()
        base = {"pin": "top", "review_on": False, "tall_widget": True, "event_remind_on": False}
        (DATA_DIR / "settings.json").write_text(json.dumps({**base, **self.settings}), encoding="utf-8")
        for name, data in self.files.items():
            (DATA_DIR / name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        self.app = todo.App()
        self.notes = []
        self.app.notify = lambda title, body="", action=None: self.notes.append(title)
        self.app.update()

    def tearDown(self):
        self.app.update()
        self.app.shutdown()

    def tasks(self, n=0):
        return self.app.store.tasks(TODAY + timedelta(days=n))

    def find(self, title, n=0):
        return next(t for t in self.tasks(n) if t["title"] == title)

    def type(self, text):
        a = self.app
        a._placeholder(False)
        a.entry.delete(0, "end")
        a.entry.insert(0, text)
        a.add()
        a.update()


# ---------------------------------------------------------------- 순수 함수
class ParsingTest(unittest.TestCase):
    def test_event_times(self):
        p = todo.parse_event
        self.assertEqual(p("13:30 회의"), ("13:30", "회의"))
        self.assertEqual(p("오후 1시 30분 회의"), ("13:30", "회의"))
        self.assertEqual(p("6시 반 저녁"), ("18:30", "저녁"))  # 오전/오후 없는 1~6시는 오후
        self.assertEqual(p("9시 스터디"), ("09:00", "스터디"))
        self.assertEqual(p("06:30 운동"), ("06:30", "운동"))
        self.assertEqual(p("오전 12시 작업"), ("00:00", "작업"))
        self.assertEqual(p("미정 KAMP 회의"), ("", "KAMP 회의"))
        self.assertEqual(p("종일 MT"), ("", "MT"))

    def test_not_events(self):
        for s in ["3시간 공부하기", "10분 스트레칭", "25:00 이상", "13:30", "KAMP > 13:30 회의", "미정"]:
            self.assertIsNone(todo.parse_event(s), s)

    def test_dated_events(self):
        f = lambda s: todo.parse_dated_event(s, TODAY, TODAY)
        self.assertEqual(f("10월 9일 오후 3시 면담")[0][1:], ("15:00", "면담"))
        self.assertEqual(f("KAMP 회의")[0], (TODAY, "", "KAMP 회의"))  # 일정표: 시간 없으면 미정
        self.assertIsNone(f("2/30 10:00 x")[0])
        far_past = TODAY - timedelta(days=90)
        self.assertEqual(f(f"{far_past.month}/{far_past.day} 09:00 x")[0][0].year, TODAY.year + 1)

    def test_duration(self):
        d = todo.parse_duration
        self.assertEqual([d("90"), d("1:25"), d("1:25:30")], [5400, 5100, 5130])
        self.assertIsNone(d("0:61"))
        self.assertIsNone(d("abc"))


# ---------------------------------------------------------------- 할 일 · 타이머
class TaskTest(AppCase):
    def test_add_and_group_syntax(self):
        self.type("KAMP > 데이터 EDA")
        self.assertEqual(self.app.entry.get(), "KAMP > ")  # 연속 입력용으로 남김
        self.type("KAMP > 모델링")
        kamp = self.find("KAMP")
        self.assertEqual([c["title"] for c in todo.children(kamp, self.tasks())], ["데이터 EDA", "모델링"])
        self.type("13:30 회의")  # 할 일이 아니라 일정
        self.assertEqual(self.app.events[iso()][0]["time"], "13:30")

    def test_single_timer(self):
        self.type("A")
        self.type("B")
        a, b = self.find("A"), self.find("B")
        self.app.toggle_timer(a)
        self.app.toggle_timer(b)
        self.assertIsNone(a["started_at"])
        self.assertIsNotNone(b["started_at"])

    def test_group_done_checks_children(self):
        self.type("G > x")
        self.type("G > y")
        g = self.find("G")
        self.app.set_done(g, True)
        self.assertTrue(all(c["done"] for c in todo.children(g, self.tasks())))


class MidnightTest(AppCase):
    mid = datetime.combine(TODAY, datetime.min.time()).timestamp()
    files = {"tasks.json": {iso(-1): [task("P", "KAMP"), task("c", "모델링", 600.0, mid - 1800, parent="P"),
                                      task("x", "빨래")]}}

    def test_split_keeps_group(self):
        y = self.app.store.data[iso(-1)][1]
        self.assertAlmostEqual(y["elapsed"], 2400, delta=1)  # 어제 몫은 자정까지
        cont = self.find("모델링")
        self.assertEqual(cont["started_at"], self.mid)
        self.assertEqual(self.find("KAMP")["id"], cont["parent"])

    def test_carry_over(self):
        self.app.carry_over()
        self.assertIn("빨래", [t["title"] for t in self.tasks()])


# ---------------------------------------------------------------- 드래그 정렬
class ReorderTest(AppCase):
    files = {"tasks.json": {iso(): [task("a", "A"), task("K", "K"), task("k1", "k1", parent="K"),
                                    task("k2", "k2", parent="K"), task("b", "B"), task("z", "Z", done=True)]}}

    def drag(self, title, y):
        a = self.app
        t = self.find(title)
        sibs = [x for x in self.tasks() if x.get("parent") == t.get("parent") and x["done"] == t["done"]]
        row = a._rows[t["id"]]
        a._rdrag_press(E(row.winfo_rooty() + 5), t, row, sibs, None)
        a._rdrag_motion(E(y))
        a._rdrag_release(E(y))
        a.update()

    def test_move_to_top_and_children(self):
        a = self.app
        self.drag("B", a._rows["a"].winfo_rooty() + 1)
        tops = [t["title"] for t in self.tasks() if not t.get("parent") and not t["done"]]
        self.assertEqual(tops, ["B", "A", "K"])
        self.drag("k2", a._rows["k1"].winfo_rooty() + 1)
        self.assertEqual([t["title"] for t in self.tasks() if t.get("parent") == "K"], ["k2", "k1"])

    def test_short_click_opens_detail(self):
        opened = []
        a = self.app
        t = self.find("A")
        a._rdrag_press(E(1), t, a._rows["a"], [], lambda: opened.append(t["title"]))
        a._rdrag_release(E(1))
        self.assertEqual(opened, ["A"])

    def test_widget_move_not_broken(self):
        """순서 바꾸기 드래그와 위젯 창 이동 드래그의 이름이 겹쳤던 회귀."""
        a = self.app
        a.apply_mode(True)
        a.update()
        x0 = a.winfo_x()
        a._drag_start(E(a.winfo_y() + 10, x0 + 50))
        a._drag_move(E(a.winfo_y() + 10, x0 - 50))
        a.update()
        self.assertEqual(a.winfo_x(), x0 - 100)


# ---------------------------------------------------------------- 일정 · 마감
class EventTest(AppCase):
    soon = (datetime.now() + timedelta(minutes=5)).strftime("%H:%M")
    files = {"events.json": {iso(): [{"id": "e", "time": soon, "title": "곧"},
                                     {"id": "u", "time": "", "title": "미정 회의"}]},
             "deadlines.json": [{"id": "p", "title": "지난", "date": iso(-2)},
                                {"id": "f", "title": "다가옴", "date": iso(3), "group": "KAMP"}]}
    settings = {"event_remind_on": True}

    def test_reminder_skips_untimed(self):
        a = self.app
        for ev in a.events[iso()]:
            ev["reminded"] = False
        a._event_reminders()
        self.assertEqual(len(self.notes), 1)
        self.assertIn("곧", self.notes[0])

    def test_past_deadlines_hidden(self):
        a = self.app
        a.open_schedule()
        w = a.schedule_win
        self.assertEqual(w._items(TODAY - timedelta(days=2))[1], [])
        self.assertEqual([d["title"] for d in w._items(TODAY + timedelta(days=3))[1]], ["다가옴"])
        w.destroy()


# ---------------------------------------------------------------- 자리 비움
class AwayTest(AppCase):
    def setUp(self):
        super().setUp()
        self.answer = "cut"
        test = self

        class FakeAway(todo.tk.Toplevel):
            def __init__(self, app, since, reason, running):
                super().__init__(app)
                self.choice = test.answer
                self.after(20, self.destroy)
        self._orig, todo.AwayDialog = todo.AwayDialog, FakeAway

    def tearDown(self):
        todo.AwayDialog = self._orig
        super().tearDown()

    def test_idle_cut_and_continue(self):
        a = self.app
        self.type("모델링")
        t = self.find("모델링")
        t["started_at"] = time.time() - 1800
        orig = todo.idle_seconds
        try:
            todo.idle_seconds = lambda: 1200
            a._guard_timers()
            todo.idle_seconds = lambda: 1
            a._guard_timers()
        finally:
            todo.idle_seconds = orig
        self.assertAlmostEqual(t["elapsed"], 600, delta=3)  # 자리 비운 20분은 빠짐
        self.assertAlmostEqual(t["started_at"], time.time(), delta=3)


# ---------------------------------------------------------------- 만다라트
class MandalartTest(AppCase):
    def test_send_and_sync(self):
        a = self.app
        a.mandala["subs"][0] = "코테"
        a.mandala["actions"][0][:2] = ["백준", "프로그래머스"]
        a.open_mandala()
        w = a.mandala_win
        w.to_today(0, range(8))
        w.to_today(0, range(8))  # 두 번 보내도 중복 없음
        self.assertEqual(len(self.tasks()), 3)
        a.set_done(self.find("백준"), True)
        self.assertTrue(a.mandala["done"][0][0])
        w.destroy()


# ---------------------------------------------------------------- 백업
class BackupTest(AppCase):
    files = {"tasks.json": {iso(): [task("a", "원래 할 일")]}, "journal.json": {iso(): "원래 일기"}}

    def test_daily_backup_made_once(self):
        zips = list(todo.BACKUP_DIR.glob("*.zip"))
        self.assertEqual([z.stem for z in zips], [iso()])
        self.assertIsNone(todo.daily_backup(TODAY))  # 같은 날 두 번은 안 만듦

    def test_restore(self):
        a = self.app
        self.type("나중 할 일")
        a.journal[iso()] = "바뀐 일기"
        a.goals.append({"id": "g", "title": "새 목표", "titles": []})
        a.save_goals()
        a.store.save()
        todo.restore_backup(todo.BACKUP_DIR / f"{iso()}.zip")
        a.reload_data()
        a.update()
        self.assertEqual([t["title"] for t in self.tasks()], ["원래 할 일"])
        self.assertEqual(a.journal[iso()], "원래 일기")
        self.assertEqual(a.goals, [])  # 백업 뒤에 생긴 파일은 지움
        self.assertTrue((DATA_DIR / "settings.json").exists())  # 설정은 그대로

    def test_prune(self):
        for i in range(20):
            p = todo.BACKUP_DIR / f"2020-01-{i + 1:02d}.zip"
            p.write_bytes(b"x")
            os.utime(p, (1_600_000_000 + i, 1_600_000_000 + i))
        todo.prune_backups()
        self.assertEqual(len([p for p in todo.BACKUP_DIR.glob("*.zip")]), todo.BACKUP_KEEP_DAILY)


if __name__ == "__main__":
    unittest.main()
