/** 설정 (P2 범위): 모양 · 데이터(보관함 · 동기화 · 기기) · v1 가져오기 */
import { useEffect, useState } from "react";
import { dayTotalsMs, importV1, type DeviceInfo, type V1Data, type V1Summary } from "@dailytodo/core";
import { clock } from "../app/dates.ts";
import { DENSITIES, FEATURES, FONTS, SIZES, THEMES, sharedSettings } from "../app/appearance.ts";
import { ExportSection } from "./Export.tsx";
import { useApp, useData, useSync } from "../app/store.tsx";
import { DEFAULT_HOTKEYS, HOTKEY_LABELS, type HotkeyAction } from "../platform/index.ts";

/** 키 조합 → Tauri 가속기 문자열 ("Ctrl+Alt+T"). 수식키만 누른 중이면 null */
function accelerator(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  if (!mods.length) return null; // 수식키 없는 전역 단축키는 다른 프로그램 입력을 가로채서 막음
  const k = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
  return [...mods, k].join("+");
}

function Hotkeys() {
  const { config, saveConfig } = useApp();
  const [cap, setCap] = useState<HotkeyAction | null>(null);
  const keys = { ...DEFAULT_HOTKEYS, ...config.hotkeys };
  useEffect(() => {
    if (!cap) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") return setCap(null);
      const acc = accelerator(e);
      if (!acc) return;
      void saveConfig({ hotkeys: { ...config.hotkeys, [cap]: acc } });
      setCap(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cap, config.hotkeys, saveConfig]);
  return (
    <section>
      <h2>전역 단축키</h2>
      <p>다른 프로그램을 쓰는 중에도 동작해요. 칸을 누른 뒤 원하는 키 조합을 눌러요 (Ctrl · Alt · Shift 중 하나 이상).</p>
      {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((a) => (
        <div key={a} className="row">
          <span style={{ width: 210, fontSize: 14 }}>{HOTKEY_LABELS[a]}</span>
          <button className={`keycap${cap === a ? " capturing" : ""}`} onClick={() => setCap(cap === a ? null : a)}>
            {cap === a ? "키를 눌러요… (Esc 취소)" : keys[a] || "끔"}
          </button>
          {keys[a] && <button className="btn btn-ghost" onClick={() => void saveConfig({ hotkeys: { ...config.hotkeys, [a]: "" } })}>끄기</button>}
          {keys[a] !== DEFAULT_HOTKEYS[a] && <button className="btn btn-ghost" onClick={() => void saveConfig({ hotkeys: { ...config.hotkeys, [a]: DEFAULT_HOTKEYS[a] } })}>기본값</button>}
        </div>
      ))}
    </section>
  );
}

function NumberSetting({ id, label, value, onSave, hint, min = 0 }: { id: string; label: string; value: number; onSave: (v: number) => void; hint?: string; min?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} className="field" style={{ width: 120 }} inputMode="numeric" value={v}
          onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ""))}
          onBlur={() => {
            const n = Number(v);
            if (v !== "" && Number.isFinite(n) && n >= min && n !== value) onSave(n);
            else setV(String(value));
          }} />
        {hint && <span className="muted" style={{ fontSize: 13 }}>{hint}</span>}
      </div>
    </div>
  );
}

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
  const { config, saveConfig, rep, engine, actions } = useApp();
  useData();
  const sync = useSync();
  const shared = sharedSettings(rep);
  const [root, setRoot] = useState(config.vaultRoot ?? "");
  const [name, setName] = useState(config.deviceName);
  const theme = shared.theme ?? config.theme ?? "minimal";

  return (
    <div className="settings">
      <section>
        <h2>모양</h2>
        <p>모양과 켜 둔 기능은 이 보관함을 쓰는 모든 기기에 같이 적용돼요.</p>
        <div className="theme-pick" role="group" aria-label="테마">
          {THEMES.map((t) => (
            <button key={t.id} aria-pressed={theme === t.id} onClick={() => { actions.setShared({ theme: t.id }, `테마: ${t.label}`); void saveConfig({ theme: t.id }); }}>
              <i className="dot" style={{ background: t.swatch }} />{t.label}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label" style={{ width: 60 }}>글꼴</span>
          <div className="seg" role="group" aria-label="글꼴">
            {FONTS.map((f) => <button key={f.id} aria-pressed={(shared.font ?? "sans") === f.id} onClick={() => actions.setShared({ font: f.id }, `글꼴: ${f.label}`)}>{f.label}</button>)}
          </div>
        </div>
        <div className="row">
          <span className="label" style={{ width: 60 }}>글자 크기</span>
          <div className="seg" role="group" aria-label="글자 크기">
            {SIZES.map((s) => <button key={s.id} aria-pressed={(shared.fontSize ?? 14) === s.id} onClick={() => actions.setShared({ fontSize: s.id }, `글자 크기: ${s.label}`)}>{s.label}</button>)}
          </div>
        </div>
        <div className="row">
          <span className="label" style={{ width: 60 }}>간격</span>
          <div className="seg" role="group" aria-label="간격">
            {DENSITIES.map((d) => <button key={d.id} aria-pressed={(shared.density ?? "normal") === d.id} onClick={() => actions.setShared({ density: d.id }, `간격: ${d.label}`)}>{d.label}</button>)}
          </div>
        </div>
      </section>

      <section>
        <h2>기능 켜고 끄기</h2>
        <p>쓰지 않는 기능은 꺼 두면 메뉴와 화면에서 사라져요. 기록은 지워지지 않아요.</p>
        <div className="toggles">
          {FEATURES.map((f) => (
            <label key={f.id}>
              <input type="checkbox" checked={shared.features?.[f.id] !== false}
                onChange={(e) => actions.setShared({ features: { [f.id]: e.target.checked } }, `${f.label} ${e.target.checked ? "켬" : "끔"}`)} />
              {f.label}<small>{f.hint}</small>
            </label>
          ))}
        </div>
      </section>

      <Hotkeys />

      <section>
        <h2>타이머 · 알림</h2>
        <NumberSetting id="remind" label="일정 알림 (분 전, 0 이면 끔)" value={config.remindMin ?? 10} onSave={(v) => saveConfig({ remindMin: v })}
          hint="일정마다 따로 정하려면 일정을 눌러 상세에서." />
        <NumberSetting id="idle" label="자리 비움 확인 (분 동안 입력이 없으면, 0 이면 끔)" value={config.idleMin ?? 10} onSave={(v) => saveConfig({ idleMin: v })}
          hint="타이머가 켜진 채 자리를 비웠다 돌아오면, 그 시간을 뺄지 물어봐요. 절전 · 앱이 꺼져 있던 동안도." />
        <NumberSetting id="long" label="오래 켜진 타이머 알림 (시간, 0 이면 끔)" value={config.longHours ?? 2} onSave={(v) => saveConfig({ longHours: v })} />
        <label className="label" htmlFor="review">오늘 정리하기 알림 시각 (비우면 끔)</label>
        <input id="review" type="time" className="field" style={{ width: 140 }} defaultValue={config.reviewTime ?? "22:00"}
          onBlur={(e) => e.target.value !== (config.reviewTime ?? "22:00") && void saveConfig({ reviewTime: e.target.value })} />
        <label className="row" style={{ gap: 8, fontSize: 14, marginTop: 6 }}>
          <input type="checkbox" checked={!!config.pomo?.on} onChange={(e) => void saveConfig({ pomo: { ...config.pomo, on: e.target.checked } })} />
          뽀모도로 — 타이머를 켜면 집중 {config.pomo?.focus ?? 25}분 → 휴식 {config.pomo?.brk ?? 5}분 (4번마다 {config.pomo?.long ?? 15}분)
        </label>
        {config.pomo?.on && (
          <div className="form-grid">
            {(["focus", "brk", "long", "every"] as const).map((k) => (
              <NumberSetting key={k} id={`pomo-${k}`} label={{ focus: "집중 (분)", brk: "휴식 (분)", long: "긴 휴식 (분)", every: "긴 휴식 간격 (회)" }[k]}
                value={config.pomo?.[k] ?? { focus: 25, brk: 5, long: 15, every: 4 }[k]} min={1}
                onSave={(v) => saveConfig({ pomo: { on: true, ...config.pomo, [k]: v } })} />
            ))}
          </div>
        )}
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

      <ExportSection />

      <section>
        <h2>정보</h2>
        <p>Daily Todo v2 (P2 미리보기) · 이 창 ID <span className="num">{rep.deviceId}</span></p>
      </section>
    </div>
  );
}
