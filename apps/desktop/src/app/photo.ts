/**
 * 사진 줄이기 (설계 13장): 긴 변 2048px · WebP 품질 80 + 400px 썸네일.
 * 캔버스에 다시 그려 저장하므로 위치(GPS) 등 EXIF 는 모두 빠지고, 촬영 시각만 따로 읽어 남김.
 * 방향(EXIF Orientation)은 createImageBitmap 이 맞춰 줌.
 */
import { putBlob, type Photo, type VaultFs } from "@dailytodo/core";

export const FULL_PX = 2048;
export const THUMB_PX = 400;

/** JPEG 의 EXIF DateTimeOriginal("2026:10:15 12:40:03") → 이 기기 현지 시각 ms. 없으면 null */
export function exifTakenAt(bytes: Uint8Array): number | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= v.byteLength) {
    const marker = v.getUint16(p);
    const len = v.getUint16(p + 2);
    if (marker === 0xffe1 && p + 10 <= v.byteLength && v.getUint32(p + 4) === 0x45786966) return readTiff(v, p + 10, len - 8);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
    p += 2 + len;
  }
  return null;
}

function readTiff(v: DataView, start: number, size: number): number | null {
  const end = Math.min(v.byteLength, start + size);
  if (start + 8 > end) return null;
  const le = v.getUint16(start) === 0x4949;
  const u16 = (o: number) => v.getUint16(start + o, le);
  const u32 = (o: number) => v.getUint32(start + o, le);
  const ifd = (off: number, tag: number): number | null => {
    if (start + off + 2 > end) return null;
    const n = u16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (start + e + 12 > end) return null;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const str = (entry: number): string | null => {
    const count = u32(entry + 4);
    const off = count > 4 ? u32(entry + 8) : entry + 8;
    if (start + off + count > end) return null;
    let s = "";
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(v.getUint8(start + off + i));
    return s;
  };
  const ifd0 = u32(4);
  const exifPtr = ifd(ifd0, 0x8769);
  let raw: string | null = null;
  if (exifPtr != null) {
    const e = ifd(u32(exifPtr + 8), 0x9003); // DateTimeOriginal
    if (e != null) raw = str(e);
  }
  if (!raw) {
    const e = ifd(ifd0, 0x0132); // DateTime
    if (e != null) raw = str(e);
  }
  const m = raw && /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const t = new Date(y, mo - 1, d, h, mi, s).getTime();
  return Number.isFinite(t) ? t : null;
}

/** 긴 변이 max 를 넘지 않게 */
export function fitSize(w: number, h: number, max: number): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function encode(bmp: ImageBitmap, max: number): Promise<Uint8Array> {
  const { w, h } = fitSize(bmp.width, bmp.height, max);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.8));
  if (!blob || blob.type !== "image/webp") throw new Error("이 환경에선 WebP 로 저장할 수 없어요");
  return new Uint8Array(await blob.arrayBuffer());
}

/** 그림 파일 하나 → 보관함에 저장한 Photo */
export async function savePhoto(fs: VaultFs, file: Blob): Promise<Photo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const takenAt = exifTakenAt(bytes);
  const bmp = await createImageBitmap(new Blob([bytes]), { imageOrientation: "from-image" });
  try {
    const full = fitSize(bmp.width, bmp.height, FULL_PX);
    const [big, small] = [await encode(bmp, FULL_PX), await encode(bmp, THUMB_PX)];
    return { id: await putBlob(fs, big, "webp"), thumb: await putBlob(fs, small, "webp"), w: full.w, h: full.h, takenAt };
  } finally {
    bmp.close();
  }
}
