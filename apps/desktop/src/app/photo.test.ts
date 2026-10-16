import { describe, expect, it } from "vitest";
import { exifTakenAt, fitSize } from "./photo.ts";

/** 가장 작은 JPEG + EXIF(APP1): IFD0 에 ExifIFD 포인터, ExifIFD 에 DateTimeOriginal */
function jpegWithExif(date: string, le = true): Uint8Array {
  const tiff: number[] = [];
  const u16 = (x: number) => (le ? [x & 255, x >> 8] : [x >> 8, x & 255]);
  const u32 = (x: number) => (le ? [x & 255, (x >> 8) & 255, (x >> 16) & 255, x >>> 24] : [x >>> 24, (x >> 16) & 255, (x >> 8) & 255, x & 255]);
  // 헤더(8) + IFD0(2+12+4=18) → ExifIFD 는 26 에서, 문자열은 26+18=44 에서
  tiff.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8));
  tiff.push(...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0));
  tiff.push(...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0));
  tiff.push(...[...date].map((c) => c.charCodeAt(0)), 0);
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = app1.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xd9]);
}

describe("사진", () => {
  it("EXIF 촬영 시각 (리틀 · 빅 엔디안)", () => {
    const want = new Date(2026, 9, 15, 12, 40, 3).getTime();
    expect(exifTakenAt(jpegWithExif("2026:10:15 12:40:03"))).toBe(want);
    expect(exifTakenAt(jpegWithExif("2026:10:15 12:40:03", false))).toBe(want);
  });

  it("EXIF 가 없거나 JPEG 이 아니면 null", () => {
    expect(exifTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
    expect(exifTakenAt(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2]))).toBeNull(); // 잘린 파일
  });

  it("긴 변 맞추기", () => {
    expect(fitSize(4032, 3024, 2048)).toEqual({ w: 2048, h: 1536 });
    expect(fitSize(3024, 4032, 400)).toEqual({ w: 300, h: 400 });
    expect(fitSize(800, 600, 2048)).toEqual({ w: 800, h: 600 }); // 작은 사진은 그대로
  });
});
