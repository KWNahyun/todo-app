import { describe, expect, it } from "vitest";
import { MemoryFs, Replica } from "@dailytodo/core";
import { AuthError, GraphFs, ROOT, TokenSource, pollDeviceLogin, startDeviceLogin, type Fetch } from "./graph.ts";

/** 가짜 Graph: 앱 전용 폴더 = MemoryFs (PC 의 동기화 폴더와 같은 내용이라고 봄) */
function fakeGraph(disk: MemoryFs, opts: { flaky?: number } = {}) {
  const calls: string[] = [];
  let flaky = opts.flaky ?? 0;
  const res = (status: number, body: unknown = null, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n] ?? null },
    json: async () => body,
    text: async () => String(body),
    arrayBuffer: async () => (body instanceof Uint8Array ? body : new TextEncoder().encode(String(body ?? ""))).slice().buffer,
  });
  const uploads = new Map<string, { path: string; parts: Uint8Array[] }>();
  const f: Fetch = async (url, init = {}) => {
    calls.push(`${init.method ?? "GET"} ${url.replace(ROOT, "")}`);
    if (flaky > 0) {
      flaky--;
      return res(429, null, { "Retry-After": "0" });
    }
    if (url.startsWith("upload:")) {
      const u = uploads.get(url)!;
      u.parts.push(init.body as Uint8Array);
      const total = Number(/\/(\d+)$/.exec(init.headers!["Content-Range"]!)![1]);
      const got = u.parts.reduce((a, p) => a + p.length, 0);
      if (got < total) return res(202);
      const all = new Uint8Array(got);
      let at = 0;
      for (const p of u.parts) { all.set(p, at); at += p.length; }
      await disk.write(u.path, new TextDecoder().decode(all));
      return res(201);
    }
    const m = /^:\/(.+):\/(content|children|createUploadSession)/.exec(url.replace(ROOT, "").split("?")[0]!);
    const rootChildren = url.replace(ROOT, "").startsWith("/children");
    if (rootChildren || m?.[2] === "children") {
      const dir = rootChildren ? "" : decodeURIComponent(m![1]!);
      const names = new Map<string, { size: number; folder: boolean }>();
      for (const p of [...disk.files.keys(), ...disk.bins.keys()]) {
        if (dir && !p.startsWith(`${dir}/`)) continue;
        const rest = dir ? p.slice(dir.length + 1) : p;
        const [head, ...tail] = rest.split("/");
        names.set(head!, tail.length ? { size: 0, folder: true } : { size: new TextEncoder().encode(disk.files.get(p) ?? "").length || (disk.bins.get(p)?.length ?? 0), folder: false });
      }
      if (!names.size && dir) return res(404, { error: { code: "itemNotFound" } });
      return res(200, { value: [...names].map(([name, x]) => ({ name, size: x.size, ...(x.folder ? { folder: {} } : { file: {} }) })) });
    }
    const path = decodeURIComponent(m![1]!);
    if (m![2] === "createUploadSession") {
      const id = `upload:${uploads.size}`;
      uploads.set(id, { path, parts: [] });
      return res(200, { uploadUrl: id });
    }
    if ((init.method ?? "GET") === "GET") {
      const t = await disk.read(path);
      const b = await disk.readBytes(path);
      return t != null ? res(200, t) : b ? res(200, b) : res(404);
    }
    const body = init.body!;
    if (typeof body === "string") await disk.write(path, body);
    else if ((init.headers?.["Content-Type"] ?? "").startsWith("text/")) await disk.write(path, new TextDecoder().decode(body));
    else await disk.writeBytes(path, body);
    return res(201, {});
  };
  return { f, calls };
}

const token = async () => "tok";

describe("휴대폰 OneDrive (Graph)", () => {
  it("읽기 · 쓰기 · 덧붙이기 · 목록과 크기", async () => {
    const disk = new MemoryFs();
    const { f } = fakeGraph(disk);
    const fs = new GraphFs(f, token);
    expect(await fs.read("vault.json")).toBeNull();
    await fs.write("vault.json", "{}");
    await fs.append("log/phone-1/2026-10.ndjson", "a\n");
    await fs.append("log/phone-1/2026-10.ndjson", "한글\n");
    await disk.append("log/pc-1-main/2026-10.ndjson", "x\n");
    expect(await fs.read("log/phone-1/2026-10.ndjson")).toBe("a\n한글\n");
    expect(await fs.listSizes("log/")).toEqual([
      { path: "log/pc-1-main/2026-10.ndjson", size: 2 },
      { path: "log/phone-1/2026-10.ndjson", size: 9 },
    ]);
    expect(await fs.list("snapshots/")).toEqual([]);
    await fs.writeBytes("blobs/a.webp", new Uint8Array([1, 2, 3]));
    expect(await fs.readBytes("blobs/a.webp")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("큰 파일은 업로드 세션으로 나눠 올림", async () => {
    const disk = new MemoryFs();
    const { f, calls } = fakeGraph(disk);
    const big = "가".repeat(2_000_000); // 6MB
    await new GraphFs(f, token).write("snapshots/phone-1.json", big);
    expect(await disk.read("snapshots/phone-1.json")).toBe(big);
    expect(calls.some((c) => c.includes("createUploadSession"))).toBe(true);
  });

  it("429 는 기다렸다 다시, 401 은 다시 로그인 안내", async () => {
    const disk = new MemoryFs();
    const { f } = fakeGraph(disk, { flaky: 2 });
    const fs = new GraphFs(f, token, async () => {});
    await fs.write("vault.json", "{}");
    expect(await disk.read("vault.json")).toBe("{}");
    const f401: Fetch = async () => ({ status: 401, headers: { get: () => null }, json: async () => ({}), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(new GraphFs(f401, token).read("x")).rejects.toBeInstanceOf(AuthError);
  });

  it("PC(폴더) ↔ 휴대폰(Graph) 이 같은 보관함으로 맞춰짐", async () => {
    const disk = new MemoryFs(); // OneDrive 앱 폴더 = PC 의 동기화 폴더
    const { f } = fakeGraph(disk);
    const pc = await Replica.open(disk, { deviceId: "pc-1-main" });
    const id = pc.create("task", { day: "2026-10-16", title: "KAMP 제출", done: false });
    await pc.sync();
    const phone = await Replica.open(new GraphFs(f, token), { deviceId: "phone-1", kind: "phone" });
    await phone.pull();
    expect(phone.get<"task">(id)!.title).toBe("KAMP 제출");
    phone.update<"task">(id, { done: true });
    phone.create("event", { day: "2026-10-16", time: "19:00", title: "저녁" });
    await phone.sync();
    await pc.pull();
    expect(pc.get<"task">(id)!.done).toBe(true);
    expect(pc.list("event").map((e) => e.title)).toEqual(["저녁"]);
    expect(await disk.read("devices/phone-1.json")).toContain("phone");
  });

  it("기기 코드 로그인 · 토큰 새로 받기 (만료 2분 전, 동시에 와도 한 번)", async () => {
    let refreshes = 0;
    const f: Fetch = async (url, init) => {
      const body = String(init?.body ?? "");
      const json = (status: number, o: unknown) => ({ status, headers: { get: () => null }, json: async () => o, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) });
      if (url.endsWith("/devicecode")) return json(200, { device_code: "D", user_code: "ABCD-EFGH", verification_uri: "https://microsoft.com/devicelogin", interval: 5, expires_in: 900 });
      if (body.includes("device_code=D") && body.includes("grant_type=urn")) return json(400, { error: "authorization_pending" });
      if (body.includes("grant_type=refresh_token")) {
        refreshes++;
        return json(200, { access_token: `A${refreshes}`, refresh_token: "R2", expires_in: 3600 });
      }
      return json(400, { error: "invalid_grant" });
    };
    const dc = await startDeviceLogin(f, "cid", 0);
    expect(dc).toMatchObject({ userCode: "ABCD-EFGH", expiresAt: 900_000 });
    expect(await pollDeviceLogin(f, "cid", "D")).toBe("pending");
    let now = 0;
    const saved: string[] = [];
    const ts = new TokenSource(f, "cid", { access: "A0", refresh: "R1", expires: 3_600_000 }, async (t) => void saved.push(t.access), () => now);
    expect(await ts.get()).toBe("A0");
    now = 3_500_000; // 만료 100초 전
    const [a, b] = await Promise.all([ts.get(), ts.get()]);
    expect([a, b, refreshes, saved]).toEqual(["A1", "A1", 1, ["A1"]]);
  });
});
