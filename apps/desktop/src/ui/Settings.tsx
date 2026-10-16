/** 설정 (P2 범위): 모양 · 데이터(보관함 · 동기화 · 기기) · v1 가져오기 */
import { useEffect, useState } from "react";
import { dayTotalsMs, importV1, type DeviceInfo, type V1Data, type V1Summary } from "@dailytodo/core";
import { clock } from "../app/dates.ts";
import { useApp, useSync } from "../app/store.tsx";

function Devices() {
  const { rep } = useApp();
  const [list, setList] = useState<DeviceInfo[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: DeviceInfo[] = [];
      for (const p of await rep.fs.list("devices/")) {
        try {
          out.push(JSON.parse((await rep.fs.read(p)) ?? "") as DeviceInfo);
        } catch {
          // 받는 중인 파일
        }
      }
      if (alive) setList(out.sort((a, b) => b.lastSeen - a.lastSeen));
    })();
    return () => {
      alive = false;
    };
  }, [rep]);
  if (!list.length) return null;
  return (
    <table className="cmp">
      <tbody>
        {list.map((d) => (
          <tr key={d.id}>
            <td>{d.name}</td>
            <td className="faint num">{d.id}</td>
            <td className="muted">{new Date(d.lastSeen).toLocaleString("ko-KR")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type ImportStep =
  | { s: "idle" }
  | { s: "none" }
  | { s: "ready"; dir: string; data: V1Data }
  | { s: "running" }
  | { s: "done"; summary: V1Summary; v2: Record<string, number> }
  | { s: "error"; message: string };

function V1Import() {
  const { platform, rep, engine } = useApp();
  const [step, setStep] = useState<ImportStep>({ s: "idle" });

  const find = async () => {
    try {
      const r = await platform.readV1();
      setStep(r ? { s: "ready", ...r } : { s: "none" });
    } catch (e) {
      setStep({ s: "error", message: String(e) });
    }
  };
  const run = async (data: V1Data) => {
    setStep({ s: "running" });
    try {
      const now = Date.now();
      const summary = await importV1(rep.fs, data, { now, deviceId: `import-${rep.deviceId}` });
      await engine.pull();
      setStep({ s: "done", summary, v2: dayTotalsMs(rep, now) });
    } catch (e) {
      setStep({ s: "error", message: String(e) });
    }
  };

  const count = (d: V1Data) => [
    ["할 일", Object.values(d.tasks ?? {}).flat().length],
    ["일정", Object.values(d.events ?? {}).flat().length],
    ["마감", d.deadlines?.length ?? 0],
    ["일기", Object.values(d.journal ?? {}).filter((t) => t.trim()).length],
    ["기록장", Object.values(d.collections ?? {}).flat().length],
  ] as const;

  return (
    <section>
      <h2>v1 기록 가져오기</h2>
      <p>지금 쓰는 v1 앱의 기록을 읽어서 옮겨요. v1 파일은 건드리지 않고, 여러 번 가져와도 중복되지 않아요 (v1 의 최신 값으로 맞춰짐).</p>
      {step.s === "idle" && <div className="row"><button className="btn" onClick={find}>v1 기록 찾기</button></div>}
      {step.s === "none" && <p>이 PC 에서 v1 기록을 찾지 못했어요.</p>}
      {step.s === "ready" && (
        <>
          <div className="path">{step.dir}</div>
          <table className="cmp"><tbody>{count(step.data).map(([k, n]) => <tr key={k}><td>{k}</td><td className="n">{n}</td></tr>)}</tbody></table>
          <div className="row">
            <button className="btn btn-accent" onClick={() => run(step.data)}>가져오기</button>
            <button className="btn btn-ghost" onClick={() => setStep({ s: "idle" })}>취소</button>
          </div>
        </>
      )}
      {step.s === "running" && <p>가져오는 중…</p>}
      {step.s === "done" && (
        <>
          <p>가져왔어요. 날짜별 잰 시간을 v1 과 맞춰 봤어요.</p>
          <table className="cmp">
            <thead><tr><th>날짜</th><th>v1</th><th>v2</th></tr></thead>
            <tbody>
              {Object.keys(step.summary.secondsByDay).sort().map((d) => {
                const a = step.summary.secondsByDay[d]! * 1000;
                const b = step.v2[d] ?? 0;
                return (
                  <tr key={d}>
                    <td className="num">{d}</td>
                    <td className="n">{clock(a)}</td>
                    <td className="n">{clock(b)}{Math.abs(a - b) >= 1000 ? " ← 다름" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>{Object.entries(step.summary.counts).map(([k, n]) => `${k} ${n}`).join(" · ")}</p>
        </>
      )}
      {step.s === "error" && <p role="alert">가져오지 못했어요: {step.message}</p>}
    </section>
  );
}

export function Settings() {
  const { config, saveConfig, rep, engine } = useApp();
  const sync = useSync();
  const [root, setRoot] = useState(config.vaultRoot ?? "");
  const [name, setName] = useState(config.deviceName);
  const [remind, setRemind] = useState(String(config.remindMin ?? 10));
  const theme = config.theme ?? "minimal";

  return (
    <div className="settings">
      <section>
        <h2>모양</h2>
        <div className="seg" role="group" aria-label="테마">
          {(["minimal", "dark"] as const).map((t) => (
            <button key={t} aria-pressed={theme === t} onClick={() => void saveConfig({ theme: t })}>
              {t === "minimal" ? "미니멀" : "다크 숲"}
            </button>
          ))}
        </div>
        <p>숲 우드 · 파스텔 · 고대비와 글꼴 · 글자 크기는 다음 단계(P3)에서.</p>
      </section>

      <section>
        <h2>알림</h2>
        <label className="label" htmlFor="remind">일정 알림 (분 전, 0 이면 끔)</label>
        <div className="row">
          <input id="remind" className="field" style={{ width: 120 }} inputMode="numeric" value={remind}
            onChange={(e) => setRemind(e.target.value.replace(/\D/g, ""))}
            onBlur={() => remind !== "" && Number(remind) !== (config.remindMin ?? 10) && void saveConfig({ remindMin: Number(remind) })} />
          <span className="muted" style={{ fontSize: 13 }}>일정마다 따로 정하려면 일정을 눌러 상세에서.</span>
        </div>
      </section>

      <section>
        <h2>데이터 · 동기화</h2>
        <p>기록은 아래 폴더에만 저장돼요. OneDrive 앱 폴더라면 다른 PC · 휴대폰과 저절로 맞춰져요. 우리 서버는 없어요.</p>
        <label className="label" htmlFor="root">보관함 폴더</label>
        <div className="row">
          <input id="root" className="field" style={{ flex: 1, minWidth: 240 }} value={root} onChange={(e) => setRoot(e.target.value)} />
          <button className="btn" disabled={!root.trim() || root === config.vaultRoot} onClick={() => void saveConfig({ vaultRoot: root.trim() })}>
            바꾸기
          </button>
        </div>
        <p>바꾸면 두 창이 새 폴더로 다시 열려요. 원래 폴더의 기록은 그대로 남아요.</p>
        <label className="label" htmlFor="pcname">이 PC 이름</label>
        <div className="row">
          <input id="pcname" className="field" style={{ maxWidth: 240 }} value={name} onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== config.deviceName && void saveConfig({ deviceName: name.trim() })} />
        </div>
        <div className="row">
          <button className="btn" onClick={() => void engine.syncNow()}>지금 맞추기</button>
          <span className="muted" style={{ fontSize: 13 }}>
            {sync.state === "error" ? `문제: ${sync.error}` : sync.last ? `마지막 동기화 ${new Date(sync.last).toLocaleTimeString("ko-KR")}` : "맞추는 중…"}
            {rep.pendingCount() ? ` · 보낼 변경 ${rep.pendingCount()}` : ""}
          </span>
        </div>
        <span className="label">이 보관함을 쓰는 기기</span>
        <Devices />
      </section>

      <V1Import />

      <section>
        <h2>정보</h2>
        <p>Daily Todo v2 (P2 미리보기) · 이 창 ID <span className="num">{rep.deviceId}</span></p>
      </section>
    </div>
  );
}
