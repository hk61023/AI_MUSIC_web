import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/security-"));
process.env.NODE_ENV = "test";
process.env.NO_LISTEN = "1";
process.env.SITE_ORIGIN = "http://localhost";
process.env.STORAGE_DRIVER = "local";
process.env.MFA_REQUIRED = "1";
const { app } = await import("../server/index.mjs");
const { db } = await import("../server/db.mjs");
const { setPassword } = await import("../server/security.mjs");
const { base32, totp, matchStep } = await import("../server/mfa.mjs");
const { recordVisit, visitStats, lookupIP } =
  await import("../server/visits.mjs");
await setPassword("security-test-only-password");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}`;
let cookie = "";
async function request(route, method = "GET", body, auth = true) {
  const res = await fetch(url + route, {
    method,
    headers: {
      Origin: "http://localhost",
      Cookie: auth ? cookie : "",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.headers.get("set-cookie"))
    cookie = res.headers.get("set-cookie").split(";")[0];
  return res;
}
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  db.close();
});
test("RFC 6238 SHA1 测试向量、时间窗口及非法验证码", () => {
  const secret = base32(Buffer.from("12345678901234567890"));
  for (const [seconds, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ])
    assert.equal(totp(secret, seconds * 1000, 8), expected);
  assert.equal(matchStep(secret, totp(secret, 60000), 90000), 2);
  assert.equal(matchStep(secret, "abcdef", 90000), -1);
  assert.equal(matchStep(secret, totp(secret, 60000), 150000), -1);
});
test("访问去重、时长上限、多个会话汇总、最新事件、IP缓存和隐私隔离", async () => {
  const id = randomUUID(),
    second = randomUUID(),
    ip = "8.8.8.8",
    at = Date.now();
  const send = (id, duration, event, now, path = "/music?private=1") =>
    recordVisit({ id, duration, event, path }, ip, now);
  send(id, 0, "page_view", at);
  send(id, 15000, "heartbeat", at + 15000);
  send(id, 15000, "heartbeat", at + 15000);
  let data = visitStats({});
  assert.equal(data.summary.visits, 1);
  assert.equal(data.summary.duration, 15000);
  assert.equal(data.rows[0].path, "/music");
  assert.equal(data.rows[0].event, "page_view");
  send(second, 0, "page_view", at + 16000, "/");
  send(id, 16000, "leave", at + 17000);
  data = visitStats({});
  assert.equal(data.summary.visits, 2);
  assert.equal(data.summary.duration, 16000);
  assert.equal(data.rows[0].latest_duration, 0);
  assert.equal(data.rows[0].path, "/");
  send(second, 999999, "play", at + 31000);
  data = visitStats({});
  assert.equal(data.rows[0].latest_duration, 16000);
  assert.equal(data.rows[0].event, "play");
  recordVisit(
    { id: randomUUID(), duration: 0, event: "page_view", path: "/admin" },
    ip,
    at,
  );
  assert.equal(visitStats({}).summary.visits, 2);
  assert.equal(visitStats({ search: "does-not-exist" }).total, 0);
  const savedFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        success: true,
        country: "测试地区",
        city: "测试城市",
        connection: { isp: "测试运营商" },
      }),
    };
  };
  try {
    await lookupIP(ip);
    await lookupIP(ip);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(
    (await request("/api/admin/visits", "GET", undefined, false)).status,
    401,
  );
  const response = await fetch(url + "/api/visits", {
    method: "POST",
    headers: {
      Origin: "http://localhost",
      "Content-Type": "application/json",
      "X-Forwarded-For": "1.2.3.4",
    },
    body: JSON.stringify({
      id: randomUUID(),
      duration: 0,
      event: "page_view",
      path: "/",
      ip: "1.2.3.4",
    }),
  });
  assert.equal(response.status, 204);
  assert.ok(db.prepare("SELECT ip FROM visitors WHERE ip='127.0.0.1'").get());
  assert.equal(
    db.prepare("SELECT ip FROM visitors WHERE ip='1.2.3.4'").get(),
    undefined,
  );
});
test("强制绑定、密码加验证码、旧会话撤销、重复验证码拒绝与恢复码单次使用", async () => {
  let res = await request("/api/admin/login", "POST", {
    password: "security-test-only-password",
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).setupRequired, true);
  const unverified = cookie;
  assert.equal((await request("/api/admin/catalog")).status, 401);
  const { secret, qr } = await (
    await request("/api/admin/mfa/setup", "POST", {})
  ).json();
  assert.ok(qr.startsWith("data:image/png;base64,"));
  assert.equal(
    (await request("/api/admin/mfa/confirm", "POST", { code: "bad" })).status,
    400,
  );
  res = await request("/api/admin/mfa/confirm", "POST", { code: totp(secret) });
  assert.equal(res.status, 200);
  const { codes } = await res.json();
  assert.equal(codes.length, 10);
  assert.equal((await request("/api/admin/catalog")).status, 200);
  const full = cookie;
  cookie = unverified;
  assert.equal((await request("/api/admin/catalog")).status, 401);
  cookie = full;
  assert.equal((await request("/api/admin/mfa/setup", "POST", {})).status, 403);
  await request("/api/admin/logout", "POST", {});
  assert.equal(
    (
      await request("/api/admin/login", "POST", {
        password: "security-test-only-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/admin/login", "POST", {
        password: "security-test-only-password",
        code: totp(secret),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/admin/login", "POST", {
        password: "wrong",
        code: codes[0],
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await request("/api/admin/login", "POST", {
        password: "security-test-only-password",
        code: codes[0],
      })
    ).status,
    200,
  );
  assert.equal((await (await request("/api/admin/mfa")).json()).remaining, 9);
  await request("/api/admin/logout", "POST", {});
  assert.equal(
    (
      await request("/api/admin/login", "POST", {
        password: "security-test-only-password",
        code: codes[0],
      })
    ).status,
    401,
  );
  const encrypted = db
    .prepare("SELECT value FROM settings WHERE key='mfaSecret'")
    .get().value;
  assert.ok(!encrypted.includes(secret));
  assert.equal(
    (await readFile(path.join(process.env.DATA_DIR, "mfa.key"))).length,
    32,
  );
});

test("二次验证备份恢复必须携带原密钥，恢复后会话清空且统计保留", async () => {
  const source = path.join(process.env.DATA_DIR, "snapshot.sqlite");
  const target = path.join(process.env.DATA_DIR, "restored");
  await backup(db, source);
  const missing = spawnSync(
    process.execPath,
    ["scripts/restore.mjs", source, target],
    { encoding: "utf8" },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /二次验证/);
  assert.equal(await stat(target).catch(() => null), null);
  const restored = spawnSync(
    process.execPath,
    [
      "scripts/restore.mjs",
      source,
      target,
      path.join(process.env.DATA_DIR, "mfa.key"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(restored.status, 0, restored.stderr);
  assert.deepEqual(
    await readFile(path.join(target, "mfa.key")),
    await readFile(path.join(process.env.DATA_DIR, "mfa.key")),
  );
  const copy = new DatabaseSync(path.join(target, "music.sqlite"));
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  assert.ok(
    copy.prepare("SELECT value FROM settings WHERE key='mfaSecret'").get()
      .value,
  );
  assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM visitors").get().n, 2);
  copy.close();
});
