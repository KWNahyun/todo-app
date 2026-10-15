"""Windows 전용 기능: 전역 단축키, 입력 없음 시간, 화면 영역, 아이콘 파일, 중복 실행 방지."""
import ctypes
import os
import queue
import sys
import threading
from ctypes import wintypes


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds():
    """마지막 키보드·마우스 입력 후 지난 초."""
    info = LASTINPUTINFO(ctypes.sizeof(LASTINPUTINFO), 0)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def work_area(win):
    """작업 표시줄을 뺀 화면 영역 (left, top, right, bottom)."""
    try:
        rect = wintypes.RECT()
        ctypes.windll.user32.SystemParametersInfoW(0x30, 0, ctypes.byref(rect), 0)
        return rect.left, rect.top, rect.right, rect.bottom
    except Exception:
        return 0, 0, win.winfo_screenwidth(), win.winfo_screenheight()


def colorref(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return ctypes.c_int(r | g << 8 | b << 16)


class HotkeyListener(threading.Thread):
    """RegisterHotKey 로 전역 단축키를 받는 스레드. 눌리면 queue 에 동작 이름을 넣음."""

    def __init__(self, bindings):
        super().__init__(daemon=True)
        self.bindings = bindings  # {action: (mods, vk)}
        self.queue = queue.Queue()
        self.failed = []
        self.ready = threading.Event()
        self.tid = None

    def run(self):
        user32 = ctypes.windll.user32
        self.tid = ctypes.windll.kernel32.GetCurrentThreadId()
        ids = {}
        for i, (action, (mods, vk)) in enumerate(self.bindings.items(), start=1):
            if user32.RegisterHotKey(None, i, mods | 0x4000, vk):  # MOD_NOREPEAT
                ids[i] = action
            else:
                self.failed.append(action)
        self.ready.set()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == 0x0312 and msg.wParam in ids:  # WM_HOTKEY
                self.queue.put(ids[msg.wParam])
        for i in ids:
            user32.UnregisterHotKey(None, i)

    def stop(self):
        if self.tid:
            ctypes.windll.user32.PostThreadMessageW(self.tid, 0x0012, 0, 0)  # WM_QUIT
        self.join(timeout=1)


def resource(name):
    """exe(PyInstaller)로 묶였을 때와 스크립트로 실행할 때 모두 같은 파일을 찾음."""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def already_running():
    """이미 켜져 있으면 그 창을 앞으로 불러오고 True."""
    k32, u32 = ctypes.windll.kernel32, ctypes.windll.user32
    k32.CreateMutexW.restype = wintypes.HANDLE
    globals()["_instance_mutex"] = k32.CreateMutexW(None, False, "DailyTodo.SingleInstance")
    if k32.GetLastError() != 183:  # ERROR_ALREADY_EXISTS
        return False
    hwnd = u32.FindWindowW("TkTopLevel", "Daily Todo")
    if hwnd:
        u32.ShowWindow(hwnd, 9)  # SW_RESTORE
        u32.SetForegroundWindow(hwnd)
    return True


def this_pc():
    """이 컴퓨터 이름 (두 PC 동시 사용 경고에 표시)."""
    return os.environ.get("COMPUTERNAME", "이 PC")


def release_instance():
    """다시 시작하기 전에 '이미 실행 중' 표시를 내려놓음 (새로 띄운 앱이 바로 닫히지 않게)."""
    handle = globals().get("_instance_mutex")
    if handle:
        ctypes.windll.kernel32.CloseHandle(wintypes.HANDLE(handle))
        globals()["_instance_mutex"] = None
