import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { document } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/bulk-playlists-"));
process.env.NODE_ENV = "test";
process.env.NO_LISTEN = "1";
process.env.SITE_ORIGIN = "http://localhost";
process.env.STORAGE_DRIVER = "local";
const { app } = await import("../server/index.mjs"),
  { db, saveTrack, savePlaylist } = await import("../server/db.mjs"),
  { setPassword } = await import("../server/security.mjs");
await setPassword("bulk-playlists-test-password");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function call(route, body, method = "POST", auth = true) {
  return fetch(url + route, {
    method,
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/json",
      Cookie: auth ? cookie : "",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
});
test("自动歌单编号避让、追加去重、改名删除后不复用编号，拒绝草稿", async () => {
  const a = randomUUID(),
    b = randomUUID(),
    draft = randomUUID();
  for (const id of [a, b, draft])
    saveTrack({
      ...document,
      id,
      status: id === draft ? "draft" : "published",
      processing: "ready",
      rawAudio: true,
      createdAt: new Date().toISOString(),
    });
  assert.equal(
    (
      await call(
        "/api/admin/playlists/auto",
        { trackIds: [a], requestId: randomUUID() },
        "POST",
        false,
      )
    ).status,
    401,
  );
  const login = await call("/api/admin/login", {
    password: "bulk-playlists-test-password",
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
  savePlaylist({
    id: randomUUID(),
    title: "导入歌单 001",
    description: "",
    artwork: "violet",
    trackIds: [],
  });
  const requestId = randomUUID();
  let response = await call("/api/admin/playlists/auto", {
    trackIds: [a, a],
    requestId,
  });
  assert.equal(response.status, 201);
  const first = await response.json();
  assert.equal(first.title, "导入歌单 002");
  assert.deepEqual(first.trackIds, [a]);
  response = await call("/api/admin/playlists/auto", {
    trackIds: [a, b],
    requestId,
  });
  const repeated = await response.json();
  assert.equal(repeated.id, first.id);
  assert.deepEqual(repeated.trackIds, [a, b]);
  const { id, ...editable } = repeated;
  await call(
    `/api/admin/playlists/${id}`,
    { ...editable, title: "我的精选" },
    "PUT",
  );
  const next = await (
    await call("/api/admin/playlists/auto", {
      trackIds: [b],
      requestId: randomUUID(),
    })
  ).json();
  assert.equal(next.title, "导入歌单 003");
  await call(`/api/admin/playlists/${next.id}`, undefined, "DELETE");
  assert.equal(
    (
      await call("/api/admin/playlists/auto", {
        trackIds: [draft],
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
  const last = await (
    await call("/api/admin/playlists/auto", {
      trackIds: [a],
      requestId: randomUUID(),
    })
  ).json();
  assert.equal(last.title, "导入歌单 004");
  assert.equal(
    (await call(`/api/admin/tracks/${a}/unpublish`, {})).status,
    200,
  );
  assert.equal(
    (
      await call("/api/admin/playlists/auto", {
        trackIds: [a],
        requestId: randomUUID(),
      })
    ).status,
    409,
  );
});
