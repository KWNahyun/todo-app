/**
 * 휴대폰 첫 실행: 보관함 폴더 준비.
 * 휴대폰의 DailyTodo 폴더를 Syncthing 이 PC 의 OneDrive/앱/DailyTodo 와 맞춰 줌 →
 * ① 이 앱에 '모든 파일 접근' 허용 ② PC 에서 보관함이 넘어올 때까지 기다림.
 * 보관함(vault.json)이 오기 전엔 열지 않음 — 휴대폰이 따로 새 보관함을 만들면 PC 와 갈라짐.
 */
import { useEffect, useState } from "react";
import type { Platform, PhoneSetup as Status } from "../platform/index.ts";

export function PhoneSetup({ platform, status, onReady }: { platform: Platform; status: Status; onReady: () => void }) {
  const [now, setNow] = useState(status);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () =>
      platform.phoneSetup!().then(
        (s) => {
          if (!alive) return;
          setErr(null);
          setNow(s);
          if (s === "ok") onReady();
        },
        (e: unknown) => alive && setErr(String(e)),
      );
    // 설정 · Syncthing 에 다녀오면 바로, 그 밖엔 3초마다
    const h = setInterval(check, 3000);
    const vis = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", vis);
    return () => {
      alive = false;
      clearInterval(h);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [platform, onReady]);

  return (
    <div className="p-login">
      <h1>❦ Daily Todo</h1>
      {now === "permission" ? (
        <>
          <p>PC 와 같은 기록을 보려면 휴대폰의 <b>DailyTodo</b> 폴더를 써요. 이 폴더를 읽고 쓰도록 <b>'모든 파일 접근'</b>을 허용해 주세요.</p>
          <button className="btn btn-accent big" onClick={() => platform.openStorageSettings?.()}>권한 설정 열기</button>
          <p className="muted" style={{ fontSize: 13 }}>허용하고 돌아오면 저절로 이어져요.</p>
        </>
      ) : (
        <>
          <p>PC 의 기록이 아직 이 휴대폰에 안 왔어요. Syncthing 으로 폴더를 맞춰 주세요.</p>
          <ol className="p-steps">
            <li>PC 에서 <b>OneDrive\앱\DailyTodo</b> 폴더를 Syncthing 으로 공유</li>
            <li>휴대폰 Syncthing 에서 공유를 받고, 폴더 위치를 <b className="num">/storage/emulated/0/DailyTodo</b> 로</li>
            <li>다 받아지면 이 화면이 저절로 넘어가요</li>
          </ol>
          <p className="muted" style={{ fontSize: 13 }}>기다리는 중… (PC 와 휴대폰이 둘 다 켜져 있어야 주고받아요)</p>
        </>
      )}
      {err && <p className="input-msg" role="alert">{err}</p>}
    </div>
  );
}
