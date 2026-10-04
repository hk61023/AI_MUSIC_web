import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { db, setting, setSetting } from "./db.mjs";
import { mfaEnabled, mfaRequired } from "./mfa.mjs";
const scrypt = promisify(scryptCb);
const digest = (token) => createHash("sha256").update(token).digest("hex");
export async function setPassword(password) {
  if (password.length < 12) throw new Error("管理员密码至少 12 个字符");
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  setSetting("adminHash", `${salt}:${hash.toString("hex")}`);
  db.exec("DELETE FROM sessions");
}
export async function checkPassword(password) {
  const value = setting("adminHash");
  const [salt, hex] = (value || "0000000000000000:" + "00".repeat(64)).split(
    ":",
  );
  const candidate = await scrypt(password, salt, 64);
  return Boolean(value) && timingSafeEqual(Buffer.from(hex, "hex"), candidate);
}
export function sessionToken(req) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("tingyu_session="))
      ?.slice(15) || ""
  );
}
export const sessionHash = (req) => digest(sessionToken(req));
export function activeSession(req) {
  const token = sessionToken(req);
  return token.length === 64
    ? db
        .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
        .get(digest(token), Date.now())
    : null;
}
export function isAdmin(req) {
  const session = activeSession(req);
  return Boolean(
    session && (mfaEnabled() ? session.verified === 1 : !mfaRequired()),
  );
}
export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: "请先登录管理后台" });
  next();
}
export function login(res, verified = false) {
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("hex");
  const duration =
    !verified && (mfaRequired() || mfaEnabled()) ? 600000 : 12 * 60 * 60 * 1000;
  db.prepare("INSERT INTO sessions(token,expires,verified) VALUES(?,?,?)").run(
    digest(token),
    Date.now() + duration,
    verified ? 1 : 0,
  );
  res.cookie("tingyu_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: duration,
    path: "/",
  });
}
export function logout(req, res) {
  db.prepare("DELETE FROM sessions WHERE token=?").run(
    digest(sessionToken(req)),
  );
  res.clearCookie("tingyu_session", {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  });
}
export function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = process.env.SITE_ORIGIN || "http://localhost:5173";
  if (req.headers.origin !== origin)
    return res.status(403).json({ error: "请求来源不受信任" });
  next();
}
