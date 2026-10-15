"""Daily Todo 회귀 테스트.

실행:  python -m unittest discover -s tests -v
- 임시 폴더의 데이터로만 동작해서 실제 할 일·일기는 건드리지 않음
- 전역 단축키는 끔 (실행 중인 앱과 겹치지 않게)
- 테스트 중 창이 잠깐 깜빡일 수 있음
"""
import importlib
import json
import os
import shutil
import sys
import tempfile
import time
import types
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path

# 패키지를 불러오기 전에 데이터 경로를 임시 폴더로 (config 가 불러올 때 읽음)
DATA_DIR = Path(tempfile.mkdtemp(prefix="dailytodo-test-"))
os.environ["DAILY_TODO_DATA"] = str(DATA_DIR / "tasks.json")
os.environ["DAILY_TODO_NO_HOTKEYS"] = "1"

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
MODULES = ["config", "core", "storage", "winapi", "widgets", "dialogs", "schedule", "mandala", "stats",
           "lists", "records", "ui_window", "ui_journal", "ui_top", "ui_tasks", "ui_timers", "app"]
mods = {m: importlib.import_module(f"dailytodo.{m}") for m in MODULES}
dialogs, winapi = mods["dialogs"], mods["winapi"]
# 테스트에서 읽기 편하게 모든 공개 이름을 todo.이름 으로 (바꿔치기는 실제 모듈에서)
todo = types.SimpleNamespace(**{k: v for mod in mods.values() for k, v in vars(mod).items()
                                if not k.startswith("__")})

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


class DeadlineEditTest(AppCase):
    files = {"deadlines.json": [{"id": "d", "title": "KAMP 제출", "date": iso(5), "group": None}],
             "tasks.json": {iso(): [task("K", "KAMP 경진대회"), task("k1", "모델링", parent="K")]}}

    def test_parse_deadline(self):
        p = lambda s, d=None: todo.parse_deadline(s, d, TODAY)
        target = TODAY + timedelta(days=10)
        self.assertEqual(p(f"마감 {target.month}/{target.day} KAMP 제출")[0], (target, "KAMP 제출"))
        self.assertEqual(p("보고서", TODAY)[0], (TODAY, "보고서"))  # 일정표: 선택한 날짜
        self.assertIsNone(p("마감 보고서")[0])  # 위젯: 날짜 꼭 필요
        self.assertIsNone(p("마감 2/30 x")[0])
        self.assertTrue(todo.is_deadline_text("마감 10/20 x"))
        self.assertFalse(todo.is_deadline_text("마감하기 연습"))

    def test_edit_title_date_group(self):
        a = self.app
        dl = a.deadlines[0]
        d = todo.EditDeadlineDialog(a, dl)
        a.update()
        d.title_e.delete(0, "end")
        d.title_e.insert(0, "KAMP 최종 제출")
        d._set_date(TODAY + timedelta(days=2))
        self.assertIn("KAMP 경진대회", d._group_choices())
        d._set_group("KAMP 경진대회")
        d.save()
        a.update()
        self.assertEqual((dl["title"], dl["date"], dl["group"]), ("KAMP 최종 제출", iso(2), "KAMP 경진대회"))
        saved = json.loads((DATA_DIR / "deadlines.json").read_text(encoding="utf-8"))[0]
        self.assertEqual(saved["date"], iso(2))
        self.assertEqual(a._linked_deadline("KAMP 경진대회")["id"], "d")  # 묶음 옆 D-배지

    def test_widget_input_adds_deadline(self):
        target = TODAY + timedelta(days=7)
        self.type(f"마감 {target.month}/{target.day} 장학금 서류")
        self.assertIn(("장학금 서류", target.isoformat()), [(d["title"], d["date"]) for d in self.app.deadlines])
        self.assertEqual(self.tasks(), [t for t in self.tasks() if t["title"] != "장학금 서류"])  # 할 일로 안 들어감
        self.type("마감 날짜없음")
        self.assertNotIn("날짜없음", [d["title"] for d in self.app.deadlines])

    def test_schedule_add_and_edit(self):
        a = self.app
        a.open_schedule()
        w = a.schedule_win
        w.select(TODAY + timedelta(days=3))
        w.set_kind("deadline")
        w.entry.insert(0, "중간 발표")
        w.add()
        self.assertIn(("중간 발표", iso(3)), [(d["title"], d["date"]) for d in a.deadlines])
        w.set_kind("event")
        w.entry.insert(0, "마감 10/1 다른 것")  # 일정 모드여도 '마감'으로 시작하면 마감
        w.add()
        self.assertIn("다른 것", [d["title"] for d in a.deadlines])
        opened = []
        a.edit_deadline = lambda dl, anchor=None: opened.append((dl["title"], anchor is w))
        w._draw_list(w.days() if w.mode != "month" else [])
        w.edit_deadline(next(d for d in a.deadlines if d["title"] == "KAMP 제출"))
        self.assertEqual(opened, [("KAMP 제출", True)])
        w.destroy()


class StatsBasisTest(AppCase):
    files = {"tasks.json": {
        iso(-1): [task("K", "KAMP"), task("k1", "EDA", 3600.0, parent="K", done=True),
                  task("k2", "모델링", 1800.0, parent="K", done=True), task("x", "빨래", 60.0, done=True)],
        iso(0): [task("a", "코테", 7200.0), task("b", "메일", 0.0, done=True)]}}

    def labels(self, w):
        """화면에 놓인 순서대로 글자 모으기."""
        out = []

        def walk(widget):
            for c in widget.winfo_children():
                if isinstance(c, todo.tk.Label):
                    out.append(c.cget("text"))
                walk(c)
        walk(w.body)
        return out

    def test_switch_basis(self):
        a = self.app
        a.open_stats()
        w = a.stats_win
        w.set_basis("time")
        texts = self.labels(w)
        self.assertIn("가장 오래 한 일", texts)
        self.assertIn("코테", texts[texts.index("가장 오래 한 일"):][:3])  # 2시간이 1위
        w.set_basis("done")
        texts = self.labels(w)
        self.assertIn("가장 많이 끝낸 일", texts)
        self.assertIn("4개", texts)  # 완료한 일 4개 (상위 할 일 KAMP 는 세지 않음)
        self.assertIn("80%", texts)  # 4/5
        top = texts[texts.index("가장 많이 끝낸 일"):]
        self.assertEqual(top[1:3], ["2개", "KAMP"])  # 묶음으로 합산
        self.assertEqual(a.settings["stats_basis"], "done")  # 선택 기억
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
        self._orig, dialogs.AwayDialog = dialogs.AwayDialog, FakeAway

    def tearDown(self):
        dialogs.AwayDialog = self._orig
        super().tearDown()

    def test_idle_cut_and_continue(self):
        a = self.app
        self.type("모델링")
        t = self.find("모델링")
        t["started_at"] = time.time() - 1800
        orig = winapi.idle_seconds
        try:
            winapi.idle_seconds = lambda: 1200
            a._guard_timers()
            winapi.idle_seconds = lambda: 1
            a._guard_timers()
        finally:
            winapi.idle_seconds = orig
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


# ---------------------------------------------------------------- 되돌리기
class UndoTest(AppCase):
    files = {"tasks.json": {iso(): [task("a", "A"), task("K", "K"), task("k1", "k1", parent="K"),
                                    task("b", "B")]},
             "events.json": {iso(): [{"id": "e", "time": "13:00", "title": "회의"}]}}

    def titles(self):
        return [t["title"] for t in self.tasks()]

    def test_delete_without_dialog_then_undo(self):
        a = self.app
        a.delete(self.find("K"))  # 확인 창 없이 바로 (하위 포함)
        self.assertEqual(self.titles(), ["A", "B"])
        self.assertTrue(a.snack.winfo_ismapped() or a.snack.place_info())
        a.undo()
        self.assertEqual(self.titles(), ["A", "K", "k1", "B"])

    def test_undo_check_and_event_delete(self):
        a = self.app
        a.set_done(self.find("A"), True)
        a.delete_event(TODAY, a.events[iso()][0])
        a.undo()
        self.assertEqual(len(a.events[iso()]), 1)
        a.undo()
        self.assertFalse(self.find("A")["done"])

    def test_undo_keeps_timer_time(self):
        """되돌려도 그 사이에 잰 시간은 사라지지 않음."""
        a = self.app
        a.delete(self.find("B"))
        t = self.find("A")
        t["elapsed"] = 999.0
        a.undo()
        self.assertEqual(self.find("A")["elapsed"], 999.0)
        self.assertIn("B", self.titles())

    def test_ctrl_z_in_entry_is_ignored(self):
        a = self.app
        a.delete(self.find("B"))
        self.assertIsNone(a.undo(E.__new__(type("Ev", (), {"widget": a.entry}))))
        self.assertNotIn("B", self.titles())


# ---------------------------------------------------------------- 기능 켜고 끄기 · 사용법
class FeatureTest(AppCase):
    def menu_labels(self):
        m = self.app._build_menu()
        return [m.entrycget(i, "label") for i in range(m.index("end") + 1) if m.type(i) != "separator"]

    def test_turn_off_hides_everywhere(self):
        a = self.app
        self.assertIn("만다라트", self.menu_labels())
        for f in ("mandala", "events", "mood", "habits", "stats", "review", "pomodoro"):
            a.set_feature(f, False)
        a.update()
        labels = self.menu_labels()
        for gone in ("만다라트", "일정표 (주 · 2주 · 한 달)", "주간 통계", "오늘 정리하기", "뽀모도로 모드"):
            self.assertNotIn(gone, labels)
        self.assertFalse(a.mood_picker.winfo_ismapped())
        self.assertFalse(a.habit_bar.winfo_ismapped())
        self.assertFalse(a.stats_btn.winfo_ismapped())
        self.type("13:30 회의")  # 일정 기능이 꺼지면 그냥 할 일
        self.assertEqual(self.find("13:30 회의")["title"], "13:30 회의")
        self.assertFalse(a.events)

    def test_turn_back_on_keeps_records(self):
        a = self.app
        a.set_mood(iso(), 4)
        a.set_feature("mood", False)
        a.set_feature("mood", True)
        a.update()
        self.assertEqual(a.moods[iso()], 4)
        self.assertTrue(a.mood_picker.winfo_ismapped())

    def test_help_and_feature_dialogs_open(self):
        for cls in (todo.HelpDialog, todo.FeatureDialog):
            d = cls(self.app)
            self.app.update()
            self.assertTrue(d.winfo_exists())
            d.destroy()


# ---------------------------------------------------------------- 기록장 · 다이어리
class DiaryTest(AppCase):
    files = {"journal.json": {iso(-1): "어제는 KAMP 발표를 했다.\n떨렸지만 잘 끝났다.",
                              iso(-40): "한 달 전 일기: 코테 공부 시작"},
             "moods.json": {iso(-1): 5},
             "tasks.json": {iso(-1): [task("a", "발표", 3600.0, done=True), task("b", "빨래")]}}

    def open(self, n=0):
        self.app.open_records(TODAY + timedelta(days=n))
        self.app.update()
        return self.app.records_win.views["diary"]

    def write(self, view, text):
        view.text.delete("1.0", "end")
        view.text.insert("1.0", text)
        view.text.edit_modified(True)
        view._changed(None)
        view.save_now()

    def test_write_syncs_with_widget(self):
        a = self.app
        v = self.open()
        self.write(v, "기록장에서 쓴 오늘 일기")
        self.assertEqual(a.journal[iso()], "기록장에서 쓴 오늘 일기")
        self.assertEqual(a.diary_text.get("1.0", "end-1c"), "기록장에서 쓴 오늘 일기")  # 위젯에도 바로
        a.diary_text.delete("1.0", "end")
        a.diary_text.insert("1.0", "위젯에서 고침")
        a._save_diary()
        a.update()
        self.assertEqual(v.text.get("1.0", "end-1c"), "위젯에서 고침")  # 기록장에도 바로

    def test_day_summary_and_mood(self):
        v = self.open(-1)
        self.assertIn("할 일 1/2 완료", v.summary.cget("text"))
        self.assertIn("1시간", v.summary.cget("text"))
        self.assertEqual(self.app.moods[iso(-1)], 5)
        self.assertFalse(v.prompt.winfo_ismapped())  # 글이 있으면 질문 안 보임
        v.select(TODAY)
        self.app.update()
        self.assertTrue(v.prompt.winfo_ismapped())
        v.use_prompt()
        self.assertTrue(v.text.get("1.0", "end-1c").startswith("Q. "))

    def test_search_across_months(self):
        v = self.open()
        v.query.set("코테")
        self.app.update()
        self.assertEqual(v.month_lbl.cget("text"), "검색 결과 1개")

    def test_export(self):
        v = self.open()
        out = DATA_DIR / "export.md"
        v.export(str(out))
        text = out.read_text(encoding="utf-8")
        self.assertIn("기분: 최고", text)
        self.assertIn("떨렸지만 잘 끝났다.", text)
        self.assertLess(text.index(iso(-40)), text.index(iso(-1)))  # 날짜순

    def test_unsaved_text_saved_on_close(self):
        a = self.app
        v = self.open()
        v.text.insert("1.0", "저장 버튼 없이 닫기")
        v.text.edit_modified(True)
        v._changed(None)  # 0.7초 뒤 저장 예약만 된 상태
        a.records_win.close()
        self.assertEqual(a.journal[iso()], "저장 버튼 없이 닫기")


# ---------------------------------------------------------------- 버킷리스트 (목록형 모음)
class BucketTest(AppCase):
    files = {"collections.json": {"bucket": [
        {"id": "a", "title": "스카이다이빙", "tags": ["경험"], "done": True, "done_on": iso(-30), "note": "",
         "created": iso(-90)},
        {"id": "b", "title": "오로라 보기", "tags": ["여행"], "done": False, "done_on": None, "note": "",
         "created": iso(-10)}]}}

    def open(self):
        a = self.app
        a.open_records()
        a.records_win.show("bucket")
        a.update()
        return a.records_win.views["bucket"]

    def titles(self, v):
        return [x["title"] for x in v.visible()]

    def test_split_tags(self):
        self.assertEqual(todo.split_tags("#여행 오로라 보기 #겨울"), ("오로라 보기", ["여행", "겨울"]))
        self.assertEqual(todo.split_tags("마라톤 완주"), ("마라톤 완주", []))

    def test_add_with_tags_and_filters(self):
        v = self.open()
        v.entry.insert(0, "#여행 산티아고 순례길")
        v.add()
        self.assertEqual(self.titles(v), ["오로라 보기", "산티아고 순례길", "스카이다이빙"])  # 남은 것 먼저
        self.assertEqual(v.sel_id, self.app.collections["bucket"][-1]["id"])  # 새 항목이 바로 선택
        v.set_tag("여행")
        self.assertEqual(self.titles(v), ["오로라 보기", "산티아고 순례길"])
        v.set_tag(None)
        v.set_filter("done")
        self.assertEqual(self.titles(v), ["스카이다이빙"])
        v.set_filter("all")
        v.query.set("오로라")
        self.assertEqual(self.titles(v), ["오로라 보기"])
        self.assertEqual(v.progress_lbl.cget("text"), "3개 중 1개 이룸")

    def test_done_note_saved_and_celebrated(self):
        v = self.open()
        v.select("b")
        it = v.item("b")
        v.set_done(it, True)
        self.assertEqual(it["done_on"], iso())
        self.assertTrue(any("이뤘어요" in n for n in self.notes))
        v.note.insert("1.0", "드디어!")
        v.note.edit_modified(True)
        v._note_changed(None)
        self.app.records_win.close()  # 저장 예약 상태로 닫아도 저장
        saved = json.loads((DATA_DIR / "collections.json").read_text(encoding="utf-8"))
        self.assertEqual(next(x for x in saved["bucket"] if x["id"] == "b")["note"], "드디어!")

    def test_to_today_and_goal(self):
        v = self.open()
        v.select("b")
        v.to_today(v.item("b"))
        v.to_today(v.item("b"))  # 두 번 보내도 하나
        group = self.find("버킷리스트")
        self.assertEqual([t["title"] for t in todo.children(group, self.tasks())], ["오로라 보기"])
        v.to_goal(v.item("b"))
        self.assertIn("오로라 보기", [g["title"] for g in self.app.goals])

    def test_feature_off_hides_collection(self):
        a = self.app
        self.open()
        self.assertIn("bucket", a.records_win.side_btns)
        a.set_feature("bucket", False)
        a.update()
        self.assertNotIn("bucket", a.records_win.side_btns)
        self.assertEqual(a.records_win.current, "diary")


class CollectionsTest(AppCase):
    """가고 싶은 곳 · 콘텐츠 리뷰 · 취미 기록 (같은 ListView, 다른 설정)."""

    def open(self, key):
        a = self.app
        a.open_records()
        a.records_win.show(key)
        a.update()
        return a.records_win.views[key]

    def add(self, v, text):
        v.entry.insert(0, text)
        v.add()
        return v.item(v.sel_id)

    def test_all_collections_in_sidebar(self):
        self.open("bucket")
        self.assertEqual(list(self.app.records_win.side_btns),
                         ["diary", "bucket", "places", "reviews", "date", "hobby"])

    def test_date_diary(self):
        v = self.open("date")
        it = self.add(v, "#기념일 100일 기념 데이트")
        self.assertEqual((it["title"], it["tags"], it["date"]), ("100일 기념 데이트", ["기념일"], iso()))
        v.field_entries["where"].insert(0, "성수 → 서울숲")
        v.field_entries["cost"].insert(0, "52,000원")
        v._commit_fields()
        v.set_field(it, "rating", 5)
        self.assertEqual(v._subtitle(it), "성수 → 서울숲  ·  ★★★★★")
        older = self.add(v, "한강 피크닉")
        v.set_date(older, "date", TODAY - timedelta(days=20))
        self.assertEqual([x["title"] for x in v.visible()], ["100일 기념 데이트", "한강 피크닉"])
        saved = json.loads((DATA_DIR / "collections.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["date"][0]["cost"], "52,000원")

    def test_places_done_rating_where(self):
        v = self.open("places")
        it = self.add(v, "#카페 블루보틀 성수")
        v.field_entries["where"].insert(0, "서울 성동구")
        v._commit_fields()
        self.assertEqual(it["where"], "서울 성동구")
        v.set_done(it, True)
        self.assertTrue(any("다녀왔어요" in n for n in self.notes))
        v.set_field(it, "rating", 4)
        self.assertIn("서울 성동구", v._subtitle(it))
        self.assertEqual(v.progress_lbl.cget("text"), "1개 중 1개 다녀옴")

    def test_reviews_stages_kind_filter(self):
        v = self.open("reviews")
        v.set_choice("영화")
        movie = self.add(v, "듄 파트2")
        self.assertEqual(movie["kind"], "영화")  # 거르던 종류로 기본값
        v.set_choice(None)
        book = self.add(v, "#추천 데미안")
        self.assertEqual(book["kind"], "기타")
        v.set_field(book, "kind", "책")
        v.set_stage(movie, 1)  # 보는 중
        self.assertIsNone(movie["done_on"])
        v.set_stage(book, 2)  # 다 봄 → 날짜 기록
        self.assertEqual(book["done_on"], iso())
        self.assertEqual([x["title"] for x in v.visible()], ["듄 파트2", "데미안"])  # 보는 중 → 다 봄
        v.set_filter("s2")
        self.assertEqual([x["title"] for x in v.visible()], ["데미안"])
        v.set_filter("all")
        v.set_choice("책")
        self.assertEqual([x["title"] for x in v.visible()], ["데미안"])
        v.set_field(book, "rating", 5)
        v.set_field(book, "oneline", "다시 읽어도 좋다")
        self.assertEqual(v._subtitle(book), "책  ·  ★★★★★  ·  “다시 읽어도 좋다”")
        v._stage_pill(v.list_inner, book, C_BG).event_generate("<Button-1>")  # 다 봄 → 보고 싶음 순환

    def test_hobby_log_by_date(self):
        v = self.open("hobby")
        a = self.add(v, "#그림 수채화 연습")
        b = self.add(v, "#기타 코드 연습")
        v.set_date(a, "date", TODAY - timedelta(days=3))
        self.assertEqual([x["title"] for x in v.visible()], ["코드 연습", "수채화 연습"])  # 최근 날짜가 위
        self.assertEqual(v.progress_lbl.cget("text").split(" · ")[0], "기록 2개")
        v.set_field(b, "file", r"C:\없는\사진.jpg")
        v.open_file(b["file"])  # 없는 파일 → 안내만
        self.assertIn("찾을 수 없어요", v.status.cget("text"))


C_BG = "#f3e9d6"


# ---------------------------------------------------------------- 데이터 위치 (OneDrive 등)
class DataLocationTest(AppCase):
    files = {"tasks.json": {iso(): [task("a", "원래 할 일")]}, "journal.json": {iso(): "일기"}}

    def setUp(self):
        super().setUp()
        self.target = Path(tempfile.mkdtemp(prefix="dailytodo-cloud-")) / "DailyTodo"
        self.restarted = []
        self.app.restart = lambda: self.restarted.append(True)
        self._ask = (dialogs.messagebox.askyesno, dialogs.messagebox.askyesnocancel)

    def tearDown(self):
        dialogs.messagebox.askyesno, dialogs.messagebox.askyesnocancel = self._ask
        super().tearDown()

    def test_storage_helpers(self):
        st = mods["storage"]
        self.assertFalse(st.has_data(self.target))
        st.copy_data(DATA_DIR, self.target)
        names = sorted(p.name for p in self.target.iterdir())
        self.assertIn("tasks.json", names)
        self.assertIn("backups", names)  # 자동 백업도 함께
        self.assertNotIn("settings.json", names)  # PC 전용 설정은 안 옮김
        self.assertTrue(st.has_data(self.target))
        st.set_data_location(self.target)
        loc = json.loads((DATA_DIR / "location.json").read_text(encoding="utf-8"))
        self.assertEqual(Path(loc["data_dir"]), self.target.resolve())
        st.set_data_location(None)
        self.assertFalse((DATA_DIR / "location.json").exists())

    def test_move_to_empty_folder(self):
        dialogs.messagebox.askyesno = lambda *a, **k: True
        d = todo.DataLocationDialog(self.app)
        d.move_to(self.target)
        self.assertEqual(self.restarted, [True])
        self.assertEqual(json.loads((self.target / "journal.json").read_text(encoding="utf-8")), {iso(): "일기"})
        self.assertTrue((DATA_DIR / "tasks.json").exists())  # 원래 폴더는 그대로

    def test_existing_data_use_or_overwrite(self):
        self.target.mkdir(parents=True)
        (self.target / "tasks.json").write_text(json.dumps({iso(): [task("z", "다른 PC 할 일")]}, ensure_ascii=False),
                                                encoding="utf-8")
        # 예 = 그 폴더 기록 사용 → 덮어쓰지 않음
        dialogs.messagebox.askyesnocancel = lambda *a, **k: True
        todo.DataLocationDialog(self.app).move_to(self.target)
        self.assertIn("다른 PC 할 일", (self.target / "tasks.json").read_text(encoding="utf-8"))
        # 아니요 = 지금 기록으로 덮어쓰기 → 그 폴더 기록은 백업
        dialogs.messagebox.askyesnocancel = lambda *a, **k: False
        todo.DataLocationDialog(self.app).move_to(self.target)
        self.assertIn("원래 할 일", (self.target / "tasks.json").read_text(encoding="utf-8"))
        self.assertTrue(any(p.name.startswith("덮어쓰기전-") for p in (self.target / "backups").iterdir()))
        # 취소 = 아무것도 안 함
        dialogs.messagebox.askyesnocancel = lambda *a, **k: None
        n = len(self.restarted)
        todo.DataLocationDialog(self.app).move_to(self.target)
        self.assertEqual(len(self.restarted), n)

    def test_other_pc_warning(self):
        a = self.app
        (DATA_DIR / "in_use.json").write_text(json.dumps({"pc": "OTHER-PC", "time": time.time()}), encoding="utf-8")
        a._check_data_location()
        self.assertTrue(any("OTHER-PC" in n for n in self.notes))
        self.assertEqual(json.loads((DATA_DIR / "in_use.json").read_text(encoding="utf-8"))["pc"],
                         winapi.this_pc())  # 이제 이 PC 표시


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
