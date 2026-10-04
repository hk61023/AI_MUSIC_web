import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { document } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/storage-"));
process.env.STORAGE_DRIVER = "gcs";
process.env.GCS_BUCKET = "isolated-test-bucket";
process.env.NODE_ENV = "test";
process.env.NO_LISTEN = "1";
process.env.SITE_ORIGIN = "http://localhost";
const { cloudStorage } = await import("../server/media.mjs");
const { saveTrack, db } = await import("../server/db.mjs");
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
