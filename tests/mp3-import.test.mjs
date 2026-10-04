import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { wav } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/import-"));
process.env.NO_LISTEN = "1";
process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "local";
process.env.SITE_ORIGIN = "http://localhost";
const { app } = await import("../server/index.mjs");
const { db, allTracks } = await import("../server/db.mjs");
const { setPassword } = await import("../server/security.mjs");
await setPassword("test-import-password-only");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function upload(buffer, name, authenticated = true, importId) {
  const body = new FormData();
  body.set("audio", new Blob([buffer]), name);
  return fetch(base + "/api/admin/import-mp3", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(importId ? { "X-Import-ID": importId } : {}),
    },
    body,
  });
}
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
});
test("MP3／M4A 标签读取、AAC／ALAC、重试去重及失败隔离", async () => {
  assert.equal((await upload(wav(), "denied.mp3", false)).status, 401);
  const login = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { Origin: "http://localhost", "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-import-password-only" }),
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
  const input = path.join(process.env.DATA_DIR, "input.wav");
  await writeFile(input, wav(3));
  async function encode(
    name,
    metadata = [],
    codec = name.endsWith(".m4a") ? "aac" : "libmp3lame",
  ) {
    const output = path.join(process.env.DATA_DIR, name);
    const r = spawnSync(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        input,
        "-codec:a",
        codec,
        ...metadata.flatMap((v) => ["-metadata", v]),
        output,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    return readFile(output);
  }
  const tagged = await encode("tagged.mp3", [
    "title=月光 <script>",
    "artist=测试艺术家",
    "album=夜航",
    "date=2024",
    "genre=Ambient",
    "comment=一段中文备注",
    "lyrics=第一行\n第二行",
  ]);
  const importId = randomUUID();
  const response = await upload(tagged, "filename.mp3", true, importId);
  assert.equal(response.status, 201);
  const track = await response.json();
  assert.equal(track.title, "月光 <script>");
  assert.match(track.description, /艺术家：测试艺术家/);
  assert.match(track.description, /专辑：夜航/);
  assert.match(track.description, /2024/);
  assert.match(track.description, /中文备注/);
  assert.equal(track.genre, "Ambient");
  assert.match(track.lyrics, /第一行/);
  assert.equal(track.source, "其他");
  assert.equal(track.generatedAt, "");
  assert.equal(track.status, "draft");
  assert.equal(track.downloadAllowed, false);
  const repeated = await (
    await upload(tagged, "filename.mp3", true, importId)
  ).json();
  assert.equal(repeated.id, track.id);
  assert.equal(allTracks().length, 1);
  const fallback = await (
    await upload(await encode("untagged.mp3"), "中文文件名.mp3")
  ).json();
  assert.equal(fallback.title, "中文文件名");
  for (const codec of ["aac", "alac"]) {
    const encoded = await encode(
      `tagged-${codec}.m4a`,
      ["title=M4A 夜航", "artist=M4A 艺术家", "album=夜航专辑"],
      codec,
    );
    const response = await upload(encoded, `${codec}.m4a`);
    assert.equal(response.status, 201);
    const imported = await response.json();
    assert.equal(imported.title, "M4A 夜航");
    assert.match(imported.description, /M4A 艺术家/);
    assert.match(imported.description, new RegExp(codec.toUpperCase()));
    assert.equal(imported.status, "draft");
    assert.equal(imported.downloadAllowed, false);
  }
  const before = allTracks().length;
  assert.equal((await upload(wav(), "fake.mp3")).status, 400);
  assert.equal((await upload(tagged, "fake.m4a")).status, 400);
  assert.equal((await upload(Buffer.from("broken"), "broken.mp3")).status, 400);
  assert.equal((await upload(tagged, "bad.wav")).status, 400);
  assert.equal(allTracks().length, before);
  assert.equal((await fetch(base + "/api/catalog")).status, 200);
  assert.equal(
    (await (await fetch(base + "/api/catalog")).json()).tracks.length,
    0,
  );
  for (let i = 0; i < 100; i++) {
    if (allTracks().every((t) => t.processing === "ready")) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(allTracks().every((t) => t.processing === "ready"));
});
