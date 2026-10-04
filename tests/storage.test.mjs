import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { document, wav } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/storage-"));
process.env.STORAGE_DRIVER = "gcs";
process.env.GCS_BUCKET = "isolated-test-bucket";
process.env.NODE_ENV = "test";
process.env.NO_LISTEN = "1";
process.env.SITE_ORIGIN = "http://localhost";
const { cloudStorage, ingest } = await import("../server/media.mjs");
const { saveTrack, getTrack, db } = await import("../server/db.mjs");
const { setPassword } = await import("../server/security.mjs");
const { app } = await import("../server/index.mjs");
await setPassword("cloud-branch-test-only");
const operations = [],
  objects = new Set([
    "private/test-cloud/play.mp3",
    "private/test-cloud/cover.jpg",
  ]);
let failCopy = false,
  failDelete = false;
cloudStorage.file = (key) => ({
  name: key,
  async exists() {
    return [objects.has(key)];
  },
  async copy(target) {
    if (failCopy) throw new Error("simulated copy failure");
    assert.ok(objects.has(key));
    objects.add(target.name);
    operations.push(["copy", key, target.name]);
  },
  async setMetadata() {},
  async delete() {
    if (failDelete) throw new Error("simulated deletion failure");
    objects.delete(key);
    operations.push(["delete", key]);
  },
  async getSignedUrl(options) {
    assert.ok(objects.has(key));
    operations.push(["sign", key, options]);
    return [
      `https://storage.googleapis.com/isolated-test-bucket/${key}?test=1`,
    ];
  },
});
cloudStorage.upload = async (file, options) => {
  operations.push([
    "upload",
    options.destination,
    Buffer.from(await readFile(file)),
    options.metadata,
  ]);
  objects.add(options.destination);
};
saveTrack({
  ...document,
  id: "test-cloud",
  createdAt: new Date().toISOString(),
  status: "draft",
  processing: "ready",
  duration: 60,
  hasCover: true,
  artwork: "violet",
});
test("原始音频逐字节保留，GCS 仅一份，发布不复制，下架仍私有，原格式下载", async () => {
  const id = randomUUID();
  const source = path.join(process.env.DATA_DIR, "raw-fixture.wav");
  const original = wav(2);
  await writeFile(source, original);
  saveTrack({
    ...document,
    id,
    createdAt: new Date().toISOString(),
    status: "draft",
    processing: "queued",
    hasCover: false,
    downloadAllowed: true,
    rightsConfirmed: true,
    rightsEvidence: "本地合成测试",
    licenseText: "仅用于测试",
  });
  const start = operations.length;
  await ingest(id, source);
  for (let i = 0; i < 150 && getTrack(id).processing !== "ready"; i++) {
    assert.notEqual(getTrack(id).processing, "failed");
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(getTrack(id).processing, "ready");
  const upload = operations.slice(start).filter((op) => op[0] === "upload");
  assert.equal(upload.length, 1);
  assert.equal(upload[0][1], `private/${id}/original`);
  assert.deepEqual(upload[0][2], original);
  assert.equal(upload[0][3].contentType, "audio/wav");
  assert.equal((await change(`/api/admin/tracks/${id}/publish`)).status, 200);
  const playback = await fetch(origin + `/media/${id}/audio`, {
    redirect: "manual",
  });
  assert.match(
    playback.headers.get("location"),
    new RegExp(`private/${id}/original`),
  );
  const download = await fetch(origin + `/api/tracks/${id}/download`, {
    redirect: "manual",
  });
  assert.equal(download.status, 302);
  assert.ok(
    operations.some(
      (op) =>
        op[0] === "sign" &&
        op[1] === `private/${id}/original` &&
        op[2].responseDisposition?.endsWith('.wav"'),
    ),
  );
  assert.equal(
    operations.slice(start).filter((op) => op[0] === "copy").length,
    0,
  );
  assert.equal((await change(`/api/admin/tracks/${id}/unpublish`)).status, 200);
  assert.equal(
    (await fetch(origin + `/media/${id}/audio`, { redirect: "manual" })).status,
    404,
  );
  assert.ok(objects.has(`private/${id}/original`));
  const removed = await fetch(origin + `/api/admin/tracks/${id}`, {
    method: "DELETE",
    headers: { Origin: "http://localhost", Cookie: cookie },
  });
  assert.equal(removed.status, 200);
  assert.ok(!objects.has(`private/${id}/original`));
});
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const login = await fetch(origin + "/api/admin/login", {
  method: "POST",
  headers: { Origin: "http://localhost", "Content-Type": "application/json" },
  body: JSON.stringify({ password: "cloud-branch-test-only" }),
});
const cookie = login.headers.get("set-cookie").split(";")[0];
const change = (path) =>
  fetch(origin + path, {
    method: "POST",
    headers: { Origin: "http://localhost", Cookie: cookie },
  });
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
});
test("GCS 路径：发布失败保持草稿，签名直读，撤销失败停止新签名并可重试", async () => {
  failCopy = true;
  assert.equal(
    (await change("/api/admin/tracks/test-cloud/publish")).status,
    400,
  );
  assert.equal(
    (await fetch(origin + "/media/test-cloud/audio", { redirect: "manual" }))
      .status,
    404,
  );
  failCopy = false;
  assert.equal(
    (await change("/api/admin/tracks/test-cloud/publish")).status,
    200,
  );
  const audio = await fetch(origin + "/media/test-cloud/audio", {
    redirect: "manual",
  });
  assert.equal(audio.status, 302);
  assert.match(
    audio.headers.get("location"),
    /published\/test-cloud\/play.mp3/,
  );
  const signed = operations.find((op) => op[0] === "sign");
  assert.equal(signed[2].action, "read");
  assert.ok(signed[2].expires - Date.now() <= 120000);
  const preview = await fetch(
    origin + "/api/admin/tracks/test-cloud/preview/audio",
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
  assert.match(
    preview.headers.get("location"),
    /private\/test-cloud\/play.mp3/,
  );
  failDelete = true;
  assert.equal(
    (await change("/api/admin/tracks/test-cloud/unpublish")).status,
    400,
  );
  assert.equal(
    (await fetch(origin + "/media/test-cloud/audio", { redirect: "manual" }))
      .status,
    404,
  );
  failDelete = false;
  assert.equal(
    (await change("/api/admin/tracks/test-cloud/unpublish")).status,
    200,
  );
  assert.ok(!objects.has("published/test-cloud/play.mp3"));
  assert.ok(objects.has("private/test-cloud/play.mp3"));
});
