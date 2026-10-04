import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { wav, document } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/api-"));
process.env.NO_LISTEN = "1";
process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "local";
process.env.SITE_ORIGIN = "http://localhost";
const { app } = await import("../server/index.mjs");
const { db } = await import("../server/db.mjs");
const { setPassword } = await import("../server/security.mjs");
await setPassword("test-only-long-password");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function request(
  route,
  method = "GET",
  body,
  authenticated = true,
  origin = "http://localhost",
) {
  return fetch(url + route, {
    method,
    headers: {
      Origin: origin,
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
}
const json = async (...args) => {
  const res = await request(...args);
  return { res, body: await res.json() };
};
async function ready(id) {
  for (let i = 0; i < 160; i++) {
    const c = await (await request("/api/admin/catalog")).json(),
      t = c.tracks.find((t) => t.id === id);
    if (t.processing === "ready") return t;
    if (t.processing === "failed") throw new Error(t.processingError);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("转码超时");
}
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
});
test("完整上传发布流程、权限隔离、范围请求、统计、下架与备份恢复", async (t) => {
  await t.test("未登录无法读写后台，跨域登录被拒绝", async () => {
    assert.equal(
      (await request("/api/admin/catalog", "GET", undefined, false)).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/api/admin/login",
          "POST",
          { password: "test-only-long-password" },
          false,
          "https://attacker.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("/api/admin/login", "POST", { password: "wrong" }, false))
        .status,
      401,
    );
    const res = await request(
      "/api/admin/login",
      "POST",
      { password: "test-only-long-password" },
      false,
    );
    assert.equal(res.status, 200);
    cookie = res.headers.get("set-cookie").split(";")[0];
    assert.match(res.headers.get("set-cookie"), /HttpOnly/);
    assert.match(res.headers.get("set-cookie"), /SameSite=Strict/);
  });
  let id;
  await t.test("下载必须明确许可；草稿与原始文件不公开", async () => {
    assert.equal(
      (
        await request("/api/admin/tracks", "POST", {
          ...document,
          downloadAllowed: true,
        })
      ).status,
      400,
    );
    const { res, body } = await json("/api/admin/tracks", "POST", document);
    assert.equal(res.status, 201);
    id = body.id;
    assert.equal(
      (await (await request("/api/catalog")).json()).tracks.length,
      0,
    );
    assert.equal((await request(`/media/${id}/audio`)).status, 404);
    assert.equal((await request(`/media/${id}/original`)).status, 404);
    assert.equal(
      (await request(`/api/admin/tracks/${id}/publish`, "POST")).status,
      409,
    );
  });
  await t.test("实际解码失败可重新上传；转码完成可预览", async () => {
    let body = new FormData();
    body.append("audio", new Blob(["invalid-audio"]), "bad.wav");
    assert.equal(
      (await request(`/api/admin/tracks/${id}/upload`, "POST", body)).status,
      202,
    );
    for (let i = 0; i < 100; i++) {
      const c = await (await request("/api/admin/catalog")).json();
      if (c.tracks[0].processing === "failed") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    body = new FormData();
    body.append("audio", new Blob([wav()], { type: "audio/wav" }), "tone.wav");
    assert.equal(
      (await request(`/api/admin/tracks/${id}/upload`, "POST", body)).status,
      202,
    );
    const track = await ready(id);
    assert.ok(track.duration >= 2.9);
    const preview = await request(`/api/admin/tracks/${id}/preview/audio`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type"), /audio\/mpeg/);
    assert.equal(
      (
        await request(
          `/api/admin/tracks/${id}/preview/audio`,
          "GET",
          undefined,
          false,
        )
      ).status,
      401,
    );
  });
  let playlistId;
  await t.test(
    "发布后公开元信息排除后台字段，歌单排除草稿，20 路范围请求正常",
    async () => {
      const { body: p } = await json("/api/admin/playlists", "POST", {
        title: "测试歌单",
        description: "test",
        artwork: "violet",
        trackIds: [id],
      });
      playlistId = p.id;
      assert.equal(
        (await (await request("/api/catalog")).json()).playlists[0].trackIds
          .length,
        0,
      );
      assert.equal(
        (await request(`/api/admin/tracks/${id}/publish`, "POST")).status,
        200,
      );
      const { body } = await json(`/api/tracks/${id}`);
      assert.equal(body.title, document.title);
      assert.ok(!("rightsEvidence" in body));
      assert.ok(!("originalName" in body));
      const r = await Promise.all(
        Array.from({ length: 20 }, () =>
          fetch(`${url}/media/${id}/audio`, {
            headers: { Range: "bytes=0-1023" },
          }),
        ),
      );
      for (const res of r) {
        assert.equal(res.status, 206);
        assert.equal((await res.arrayBuffer()).byteLength, 1024);
      }
      assert.equal((await request(`/api/tracks/${id}/download`)).status, 403);
      assert.equal(
        (await (await request("/api/catalog")).json()).playlists[0].trackIds
          .length,
        1,
      );
    },
  );
  await t.test("保存后稳定 ID；许可允许下载；统计事件去重", async () => {
    const editable = {
      ...document,
      title: "重命名月光",
      downloadAllowed: true,
      rightsConfirmed: true,
      rightsEvidence: "测试音频由程序合成",
      licenseText: "测试许可",
    };
    assert.equal(
      (await request(`/api/admin/tracks/${id}`, "PUT", editable)).status,
      200,
    );
    const download = await request(`/api/tracks/${id}/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition"), /attachment/);
    const playId = randomUUID();
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await request(
            "/api/events",
            "POST",
            { trackId: id, playId, kind: "start" },
            false,
          )
        ).status,
        204,
      );
    const stats = await (await request("/api/admin/stats")).json();
    assert.equal(stats.counts.find((e) => e.kind === "start").count, 1);
    const seo = await request(`/tracks/${id}`);
    assert.equal(seo.status, 200);
    assert.match(await seo.text(), /重命名月光/);
    assert.match(await (await request("/sitemap.xml")).text(), new RegExp(id));
  });
  await t.test("下架撤销新播放、下载、详情及旧静态作品路径", async () => {
    assert.equal(
      (await request(`/api/admin/tracks/${id}/unpublish`, "POST")).status,
      200,
    );
    for (const p of [
      `/media/${id}/audio`,
      `/api/tracks/${id}/download`,
      `/api/tracks/${id}`,
      `/tracks/${id}`,
      `/tracks/${id}/index.html`,
    ])
      assert.equal((await request(p)).status, 404, p);
    assert.equal(
      (await (await request("/api/catalog")).json()).playlists[0].trackIds
        .length,
      0,
    );
    assert.ok(!(await (await request("/sitemap.xml")).text()).includes(id));
  });
  await t.test("备份完整，恢复不覆盖已有目录，旧会话被清理", async () => {
    const snapshot = path.join(process.env.DATA_DIR, "snapshot.sqlite"),
      target = path.join(process.env.DATA_DIR, "restored");
    await backup(db, snapshot);
    const child = spawnSync(
      process.execPath,
      ["scripts/restore.mjs", snapshot, target],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(child.status, 0, child.stderr);
    const restored = new DatabaseSync(path.join(target, "music.sqlite"));
    assert.equal(
      restored.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
    );
    assert.equal(
      restored.prepare("SELECT COUNT(*) AS n FROM tracks").get().n,
      1,
    );
    assert.equal(
      restored.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
      0,
    );
    restored.close();
    assert.notEqual(
      spawnSync(process.execPath, ["scripts/restore.mjs", snapshot, target], {
        windowsHide: true,
      }).status,
      0,
    );
  });
  await t.test("退出后后台访问被拒绝", async () => {
    assert.equal((await request("/api/admin/logout", "POST")).status, 204);
    assert.equal((await request("/api/admin/catalog")).status, 401);
  });
});
