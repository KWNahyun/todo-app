import { describe, expect, it } from "vitest";
import { getBlob, isBlobName, putBlob, sha256Hex } from "../src/blobs.ts";
import { MemoryFs } from "../src/vault.ts";

describe("사진 blobs", () => {
  it("내용 해시가 이름 · 같은 내용은 한 번만 씀", async () => {
    const fs = new MemoryFs();
    const bytes = new TextEncoder().encode("가짜 사진");
    const name = await putBlob(fs, bytes, "webp");
    expect(name).toBe(`${await sha256Hex(bytes)}.webp`);
    expect(isBlobName(name)).toBe(true);
    let writes = 0;
    const orig = fs.writeBytes.bind(fs);
    fs.writeBytes = async (p, b) => {
      writes++;
      return orig(p, b);
    };
    expect(await putBlob(fs, bytes, "webp")).toBe(name);
    expect(writes).toBe(0);
    expect(await getBlob(fs, name)).toEqual(bytes);
    expect(await fs.list("blobs/")).toEqual([`blobs/${name}`]);
  });

  it("이상한 이름은 거부 (경로 넘어가기 방지)", async () => {
    const fs = new MemoryFs();
    await expect(getBlob(fs, "../vault.json")).rejects.toThrow();
    expect(isBlobName("ABC.webp")).toBe(false);
  });
});
