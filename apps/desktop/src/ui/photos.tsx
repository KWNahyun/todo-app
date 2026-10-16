/** 사진 보이기 · 고르기 · 크게 보기 (보관함 blobs → 화면) */
import { useEffect, useRef, useState } from "react";
import { getBlob, type Photo } from "@dailytodo/core";
import { savePhoto } from "../app/photo.ts";
import { useApp } from "../app/store.tsx";
import { Close } from "./icons.tsx";

/** 이름 → 화면용 주소 (한 번 읽은 건 기억) */
const urls = new Map<string, Promise<string | null>>();

export function usePhotoUrl(name: string | undefined): string | null | undefined {
  const { rep } = useApp();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!name) return;
    let alive = true;
    let p = urls.get(name);
    if (!p) {
      p = getBlob(rep.fs, name).then((b) => (b ? URL.createObjectURL(new Blob([b as Uint8Array<ArrayBuffer>], { type: "image/webp" })) : null));
      urls.set(name, p);
      // 아직 드라이브가 안 받은 사진이면 다음에 다시 시도
      void p.then((u) => u == null && urls.delete(name));
    }
    void p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [name, rep]);
  return url;
}

export function Thumb({ photo, onClick, size = 88 }: { photo: Photo; onClick?: () => void; size?: number }) {
  const url = usePhotoUrl(photo.thumb);
  const inner = url ? <img src={url} alt="" /> : <span className="faint">{url === null ? "받는 중" : ""}</span>;
  // 누를 수 없을 땐 버튼이 아닌 그림 칸 (카드 버튼 안에 버튼이 겹치지 않게)
  if (!onClick) return <span className="thumb" style={{ width: size, height: size, cursor: "inherit" }}>{inner}</span>;
  return (
    <button className="thumb" style={{ width: size, height: size }} onClick={onClick} aria-label="사진 크게 보기">
      {inner}
    </button>
  );
}

export function Lightbox({ photos, index, onClose }: { photos: Photo[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  const p = photos[i]!;
  const url = usePhotoUrl(p.id);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [photos.length, onClose]);
  return (
    <div className="lightbox" role="dialog" aria-label="사진" onClick={onClose}>
      {url && <img src={url} alt="" onClick={(e) => e.stopPropagation()} />}
      <div className="lb-bar">
        <span>{i + 1} / {photos.length}{p.takenAt ? ` · ${new Date(p.takenAt).toLocaleString("ko-KR")}` : ""}</span>
        <button className="icon-btn" aria-label="닫기" onClick={onClose}><Close /></button>
      </div>
    </div>
  );
}

/** "사진" 버튼: 여러 장 골라 줄여서 저장 → onAdd */
export function PhotoButton({ onAdd, label = "사진" }: { onAdd: (photos: Photo[]) => void; label?: string }) {
  const { rep } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    const out: Photo[] = [];
    setError(null);
    try {
      for (const [i, f] of [...files].entries()) {
        setBusy(`${i + 1}/${files.length}`);
        out.push(await savePhoto(rep.fs, f));
      }
    } catch (e) {
      setError(`사진을 넣지 못했어요 (${String(e)})`);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
      if (out.length) onAdd(out);
    }
  };
  return (
    <>
      <button className="btn" disabled={!!busy} onClick={() => input.current?.click()}>{busy ? `줄이는 중 ${busy}` : label}</button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />
      {error && <span className="input-msg" role="alert">{error}</span>}
    </>
  );
}

/** 같은 칸을 두 기기에서 동시에 고쳐 묻힌 글 → 보여 주고 고르게 (설계 6장) */
export function ConflictNotice({ id, field, current }: { id: string; field: string; current: string }) {
  const { rep } = useApp();
  const lost = rep.conflicts(id).filter((c) => c.field === field);
  const [open, setOpen] = useState(false);
  if (!lost.length) return null;
  const other = String(lost[lost.length - 1]!.value ?? "");
  return (
    <div className="notice" role="status">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>다른 기기에서 동시에 고친 내용이 있어요.</span>
        <button className="btn btn-ghost" onClick={() => setOpen(!open)}>{open ? "접기" : "보기"}</button>
      </div>
      {open && (
        <>
          <pre className="other">{other}</pre>
          <div className="row">
            <button className="btn" onClick={() => rep.resolve(id, field, `${current}\n\n${other}`)}>둘 다 남기기</button>
            <button className="btn" onClick={() => rep.resolve(id, field, other)}>이걸로 바꾸기</button>
            <button className="btn btn-ghost" onClick={() => rep.resolve(id, field, current)}>지금 글 그대로</button>
          </div>
        </>
      )}
    </div>
  );
}
