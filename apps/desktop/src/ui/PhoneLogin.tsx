/**
 * 휴대폰 첫 실행: OneDrive 연결 (기기 코드 로그인).
 * 코드를 복사 → Microsoft 로그인 페이지에 붙여 넣고 로그인 → 앱이 알아서 이어감.
 * 권한은 'OneDrive 의 이 앱 폴더만' — 사진 · 문서 등 다른 파일은 못 봄.
 */
import { useEffect, useRef, useState } from "react";
import { pollDeviceLogin, startDeviceLogin, type DeviceCode } from "../platform/graph.ts";
import { GRAPH_CLIENT_ID, fetchViaRust, saveTokens } from "../platform/phone.ts";
import type { Platform } from "../platform/index.ts";

export function PhoneLogin({ platform }: { platform: Platform }) {
  const [dc, setDc] = useState<DeviceCode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const start = async () => {
    setErr(null);
    try {
      const d = await startDeviceLogin(fetchViaRust, GRAPH_CLIENT_ID);
      setDc(d);
      // 사용자가 로그인할 때까지 기다림
      while (alive.current && Date.now() < d.expiresAt) {
        await new Promise((r) => setTimeout(r, d.interval * 1000));
        const t = await pollDeviceLogin(fetchViaRust, GRAPH_CLIENT_ID, d.deviceCode);
        if (t !== "pending") {
          await saveTokens(t);
          location.reload();
          return;
        }
      }
      if (alive.current) {
        setDc(null);
        setErr("코드 시간이 지났어요. 다시 시작해 주세요.");
      }
    } catch (e) {
      setDc(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const open = async () => {
    if (!dc) return;
    try {
      await navigator.clipboard.writeText(dc.userCode);
      setCopied(true);
    } catch {
      // 복사가 안 되면 화면의 코드를 보고 입력
    }
    void platform.openUrl(dc.verificationUri);
  };

  return (
    <div className="p-login">
      <h1>❦ Daily Todo</h1>
      <p>PC 와 같은 기록을 보려면 OneDrive 에 연결해요. 이 앱은 <b>OneDrive 의 '앱/DailyTodo' 폴더만</b> 볼 수 있어요 — 사진 · 문서 등 다른 파일은 못 봐요.</p>
      {!GRAPH_CLIENT_ID ? (
        <p className="notice">아직 Microsoft 앱 등록 ID 가 들어 있지 않은 시험판이에요.</p>
      ) : !dc ? (
        <button className="btn btn-accent big" onClick={() => void start()}>OneDrive 에 연결</button>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          <span className="label">아래 코드를 로그인 페이지에 넣어 주세요</span>
          <div className="p-code num" aria-label="로그인 코드">{dc.userCode}</div>
          <button className="btn btn-accent big" onClick={() => void open()}>{copied ? "코드 복사됨 · 로그인 페이지 열기" : "코드 복사하고 로그인 페이지 열기"}</button>
          <p className="muted" style={{ fontSize: 13 }}>로그인하고 '예'를 누른 뒤 이 앱으로 돌아오면 저절로 이어져요.</p>
        </div>
      )}
      {err && <p className="input-msg" role="alert">{err}</p>}
    </div>
  );
}
