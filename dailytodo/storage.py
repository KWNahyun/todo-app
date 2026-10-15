"""JSON 파일 저장, 날짜별 할 일 저장소, 자동 백업."""
import json
import os
import re
import shutil
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

from .config import (
    BACKUP_DIR, BACKUP_KEEP_DAILY, BACKUP_KEEP_OTHER, DATA_FILE, LOCAL_DIR, LOCAL_ONLY, LOCATION_FILE,
)
from .core import new_task


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        # 깨진 파일은 덮어쓰지 않고 따로 보관
        path.replace(path.with_suffix(f".corrupt-{int(time.time())}.json"))
        return {}


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _data_files(folder=None):
    """백업 · 옮기기 대상: 데이터 폴더의 기록 .json (깨진 파일, 이 PC 전용 파일 제외)."""
    folder = folder or DATA_FILE.parent
    return [f for f in sorted(folder.glob("*.json")) if ".corrupt-" not in f.name and f.name not in LOCAL_ONLY]


def has_data(folder):
    """그 폴더에 Daily Todo 기록이 이미 있는지 (다른 PC 에서 쓰던 폴더 등)."""
    return any((folder / n).exists() for n in ("tasks.json", "journal.json", "collections.json"))


def copy_data(src, dst):
    """기록 파일과 backups 폴더를 src → dst 로 복사 (src 는 그대로 둠)."""
    dst.mkdir(parents=True, exist_ok=True)
    for f in _data_files(src):
        shutil.copy2(f, dst / f.name)
    if (src / "backups").is_dir():
        shutil.copytree(src / "backups", dst / "backups", dirs_exist_ok=True)


def set_data_location(folder):
    """데이터 폴더 위치를 이 PC 에 기억. None 이나 기본 폴더면 기본 위치로."""
    if folder is None or Path(folder).resolve() == LOCAL_DIR.resolve():
        LOCATION_FILE.unlink(missing_ok=True)
    else:
        save_json(LOCATION_FILE, {"data_dir": str(Path(folder).resolve())})


def backup_folder(folder, name):
    """folder 의 기록을 folder/backups/name.zip 으로."""
    (folder / "backups").mkdir(parents=True, exist_ok=True)
    path = folder / "backups" / f"{name}.zip"
    tmp = path.with_suffix(".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for f in _data_files(folder):
            z.write(f, f.name)
    os.replace(tmp, path)
    return path


def make_backup(name):
    path = backup_folder(BACKUP_DIR.parent, name)
    prune_backups()
    return path


def prune_backups():
    """자동(날짜 이름) 백업은 최근 14개, 수동·복원 전 백업은 최근 10개만 남김."""
    zips = sorted(BACKUP_DIR.glob("*.zip"), key=lambda p: p.stat().st_mtime)
    daily = [p for p in zips if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem)]
    other = [p for p in zips if p not in daily]
    for p in daily[:-BACKUP_KEEP_DAILY] + other[:-BACKUP_KEEP_OTHER]:
        p.unlink(missing_ok=True)


def daily_backup(today):
    if not _data_files() or (BACKUP_DIR / f"{today.isoformat()}.zip").exists():
        return None
    try:
        return make_backup(today.isoformat())
    except OSError:  # 백업 실패가 앱 실행을 막지 않게
        return None


def restore_backup(path):
    """백업의 데이터 파일로 되돌림. 설정(settings.json)은 그대로 두고, 백업에 없던 데이터 파일은 지움."""
    with zipfile.ZipFile(path) as z:
        names = {n for n in z.namelist() if n.endswith(".json") and "/" not in n and n not in LOCAL_ONLY}
        for f in _data_files():
            if f.name not in names:
                f.unlink()
        for n in names:
            save_json(DATA_FILE.parent / n, json.loads(z.read(n).decode("utf-8")))


class Store:
    """{"YYYY-MM-DD": [task, ...]} 형태로 JSON 파일에 저장."""

    def __init__(self, path):
        self.path = path
        self.data = load_json(path)

    def tasks(self, day):
        return self.data.setdefault(day.isoformat(), [])

    def all_tasks(self):
        return [t for ts in self.data.values() for t in ts]

    def save(self):
        save_json(self.path, {k: v for k, v in sorted(self.data.items()) if v})

    def split_at_midnight(self, today):
        """자정을 넘긴 타이머는 그날 몫까지만 기록하고, 다음 날 같은 할 일로 이어서 측정."""
        changed = False
        while True:
            found = None
            for key in sorted(k for k in self.data if k < today.isoformat()):
                nxt = date.fromisoformat(key) + timedelta(days=1)
                boundary = datetime.combine(nxt, datetime.min.time()).timestamp()
                t = next((t for t in self.data[key] if t["started_at"] and t["started_at"] < boundary), None)
                if t:
                    found = (t, key, nxt, boundary)
                    break
            if not found:
                return changed
            t, key, nxt, boundary = found
            t["elapsed"] += boundary - t["started_at"]
            t["started_at"] = None
            cont = self.copy_task(t, self.data[key], self.tasks(nxt))
            cont["done"] = False
            if not cont["started_at"]:
                cont["started_at"] = boundary
            changed = True

    def copy_task(self, t, src, dst):
        """src 목록의 t에 대응하는 할 일을 dst 목록에서 찾거나 만든다. 하위 할 일이면 상위도 함께."""
        parent_id = None
        p = next((x for x in src if x["id"] == t.get("parent")), None)
        if p:
            parent_id = self.copy_task(p, src, dst)["id"]
        found = next((x for x in dst if x["title"] == t["title"] and x.get("parent") == parent_id), None)
        if found:
            return found
        c = new_task(t["title"], t.get("note", ""), t.get("estimate"))
        c["parent"] = parent_id
        if t.get("mandala"):  # 만다라트에서 온 할 일은 연결 유지
            c["mandala"] = t["mandala"]
        dst.append(c)
        return c
