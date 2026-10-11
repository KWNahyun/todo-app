"""화면과 상관없는 순수 로직: 시간 계산, 입력 해석, 할 일 구조."""
import re
import time
import uuid
from datetime import date, datetime, timedelta

from .config import C


# '13:30 회의', '오후 1시 30분 회의', '6시 반 저녁' → 일정. '3시간 공부' 처럼 뒤에 글자가 붙으면 할 일.
UNTIMED_RE = re.compile(r"^(?:미정|종일|하루\s*종일)\s+(\S.*)$")  # '미정 KAMP 회의' → 시간 미정 일정


EVENT_RE = re.compile(r"^(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})|시\s*(?:(\d{1,2})분|(반))?)\s+(\S.*)$")


def dday_text(n):
    return "D-DAY" if n == 0 else f"D-{n}" if n > 0 else f"D+{-n}"


def dday_colors(n):
    """(배경, 글자) — 3일 이내 빨강, 7일 이내 앰버, 그 외 초록, 지난 일정은 회색."""
    if n < 0:
        return C["btn"], C["faint"]
    if n <= 3:
        return C["danger"], C["ink"]
    if n <= 7:
        return C["sun"], C["on_sun"]
    return C["moss"], C["ink"]


def fmt(sec):
    h, r = divmod(int(sec), 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}"


def fmt_hm(sec):
    h, m = divmod(int(sec) // 60, 60)
    return f"{h}시간 {m}분" if h and m else f"{h}시간" if h else f"{m}분"


def new_task(title, note="", estimate=None):
    return {"id": uuid.uuid4().hex, "title": title, "done": False, "elapsed": 0.0, "started_at": None,
            "note": note, "estimate": estimate}


def elapsed(t):
    return t["elapsed"] + (time.time() - t["started_at"] if t["started_at"] else 0)


def children(t, tasks):
    return [c for c in tasks if c.get("parent") == t["id"]]


def total_time(t, tasks):
    """상위 할 일이면 자기 시간 + 하위 시간 합계."""
    return elapsed(t) + sum(elapsed(c) for c in children(t, tasks))


def goal_seconds(goal, data, since=None):
    """목표에 연결된 제목(상위 묶음 또는 일반 할 일)의 시간을 모든 날짜에서 합산."""
    names = set(goal.get("titles") or []) | {goal["title"]}
    total = 0.0
    for key, ts in data.items():
        if since and key < since:
            continue
        by_id = {t["id"]: t for t in ts}
        for t in ts:
            if by_id.get(t.get("parent"), t)["title"] in names:
                total += elapsed(t)
    return total


def fmt_hours(sec):
    h = sec / 3600
    return f"{h:.1f}".rstrip("0").rstrip(".") + "시간" if h < 10 else f"{int(h)}시간"


def over_estimate(t, secs=None):
    return bool(t.get("estimate")) and (elapsed(t) if secs is None else secs) > t["estimate"] * 60


def start(t):
    if not t["started_at"]:
        t["started_at"] = time.time()


def stop(t):
    if t["started_at"]:
        t["elapsed"] += time.time() - t["started_at"]
        t["started_at"] = None


def parse_event(text):
    """'13:30 회의' → ('13:30', '회의'), '미정 회의'·'종일 MT' → ('', ...) 시간 미정. 일정 형식이 아니면 None."""
    m0 = UNTIMED_RE.match(text.strip())
    if m0:
        return "", m0[1].strip()
    m = EVENT_RE.match(text.strip())
    if not m:
        return None
    ampm, h, mm_colon, mm_bun, half, title = m.groups()
    h, mnt = int(h), int(mm_colon or mm_bun or (30 if half else 0))
    if ampm == "오후" and h < 12:
        h += 12
    elif ampm == "오전" and h == 12:
        h = 0
    elif not ampm and not mm_colon and 1 <= h <= 6:
        h += 12  # '3시 회의'처럼 오전/오후 없이 1~6시는 보통 오후 (13:30 같은 표기는 그대로)
    if h > 23 or mnt > 59:
        return None
    return f"{h:02d}:{mnt:02d}", title.strip()


def event_dt(day, ev):
    """일정 시작 시각. 시간 미정이면 None."""
    if not ev.get("time"):
        return None
    return datetime.combine(day, datetime.strptime(ev["time"], "%H:%M").time())


def fmt_until(delta):
    mins = int(delta.total_seconds() // 60) + 1
    if mins < 60:
        return f"{mins}분 후"
    h, m = divmod(mins, 60)
    return f"{h}시간 {m}분 후" if m else f"{h}시간 후"


def parse_duration(text):
    """'1:25:00', '1:25'(시:분), '90'(분) → 초. 형식이 틀리면 None."""
    text = text.strip()
    if text.isdigit():
        return int(text) * 60
    m = re.fullmatch(r"(\d+):(\d{1,2})(?::(\d{1,2}))?", text)
    if not m or int(m[2]) > 59 or (m[3] and int(m[3]) > 59):
        return None
    return int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3] or 0)


def normalize_mandala(d):
    """저장 파일이 없거나 모양이 어긋나도 9x9 구조를 보장."""
    d = d or {}
    subs = (list(d.get("subs") or []) + [""] * 8)[:8]
    actions = [(list(row) + [""] * 8)[:8] for row in (list(d.get("actions") or []) + [[]] * 8)[:8]]
    done = [[bool(x) for x in (list(row) + [False] * 8)[:8]] for row in (list(d.get("done") or []) + [[]] * 8)[:8]]
    return {"center": d.get("center", ""), "subs": subs, "actions": actions, "done": done}


DATE_PREFIX_RE = re.compile(r"^(?:(\d{1,2})[/.](\d{1,2})|(\d{1,2})월\s*(\d{1,2})일)\s+(.+)$")


def parse_dated_event(text, default_day, today):
    """'10/5 13:30 회의' · '10월 5일 오후 3시 회의' · '13:30 회의'(→ default_day).
    일정표에서는 시간이 없으면 시간 미정: 'KAMP 회의', '10/7 MT'. 실패하면 (None, 이유)."""
    if not text.strip():
        return None, "일정 내용을 적어 주세요."
    day, m = default_day, DATE_PREFIX_RE.match(text.strip())
    if m:
        month, dd = int(m[1] or m[3]), int(m[2] or m[4])
        text = m[5]
        try:
            day = date(today.year, month, dd)
        except ValueError:
            return None, f"{month}월 {dd}일은 없는 날짜예요."
        if day < today - timedelta(days=60):  # 두 달 넘게 지난 날짜면 내년으로
            day = date(today.year + 1, month, dd)
    ev = parse_event(text) or ("", text.strip())  # 시간이 없으면 시간 미정
    return (day, *ev), None


def sub_index(k):
    """3x3 블록 안의 칸 번호(가운데 4 제외) → 0~7."""
    return k if k < 4 else k - 1
