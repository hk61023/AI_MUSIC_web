import {
  randomBytes,
  createHmac,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { db, dataDir, setting, setSetting } from "./db.mjs";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
function decode(secret) {
  let bits = 0,
    value = 0;
  const out = [];
  for (const c of secret) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw new Error("验证码密钥无效");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totp(secret, now = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", decode(secret)).update(counter).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(
    digits,
    "0",
  );
}
export function matchStep(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(code || "")) return -1;
  for (const shift of [0, -1, 1]) {
    const t = now + shift * 30000;
    if (
      t >= 0 &&
      timingSafeEqual(Buffer.from(totp(secret, t)), Buffer.from(code))
    )
      return Math.floor(t / 30000);
  }
  return -1;
}
// The key is stored outside the SQLite database; production uses a persistent protected directory.
const keyFile = process.env.MFA_KEY_FILE || path.join(dataDir, "mfa.key");
let key;
try {
  key = readFileSync(keyFile);
} catch (e) {
  if (e.code !== "ENOENT" || setting("mfaSecret"))
    throw new Error("二次验证加密密钥缺失，请恢复原密钥文件");
  key = randomBytes(32);
  writeFileSync(keyFile, key, { mode: 0o600, flag: "wx" });
}
if (key.length !== 32) throw new Error("二次验证加密密钥必须为 32 字节");
function encrypt(value) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    c.update(value),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
function decrypt(value) {
  const b = Buffer.from(value, "base64"),
    c = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  c.setAuthTag(b.subarray(-16));
  return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
}
export const mfaEnabled = () => Boolean(setting("mfaSecret"));
export const mfaRequired = () =>
  process.env.NODE_ENV === "production" || process.env.MFA_REQUIRED === "1";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export function verifyFactor(code) {
  if (!mfaEnabled()) return false;
  const secret = decrypt(setting("mfaSecret"));
  const step = matchStep(secret, code);
  if (step >= 0 && step > Number(setting("mfaLastStep") || -1)) {
    setSetting("mfaLastStep", String(step));
    return true;
  }
  const codes = JSON.parse(setting("mfaRecovery") || "[]"),
    digest = hash((code || "").replace(/\s/g, "").toLowerCase());
  const index = codes.indexOf(digest);
  if (index < 0) return false;
  codes.splice(index, 1);
  setSetting("mfaRecovery", JSON.stringify(codes));
  return true;
}
export function recoveryCodes() {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(12).toString("hex"),
  );
  setSetting("mfaRecovery", JSON.stringify(codes.map(hash)));
  return codes;
}
export const recoveryRemaining = () =>
  JSON.parse(setting("mfaRecovery") || "[]").length;
export async function enrollment(sessionHash) {
  const entry = JSON.parse(setting("mfaPending") || "null");
  const secret =
    entry?.session === sessionHash && entry.expires > Date.now()
      ? decrypt(entry.secret)
      : base32(randomBytes(20));
  setSetting(
    "mfaPending",
    JSON.stringify({
      session: sessionHash,
      secret: encrypt(secret),
      expires: Date.now() + 600000,
    }),
  );
  const uri = `otpauth://totp/${encodeURIComponent("听屿:管理员")}?secret=${secret}&issuer=${encodeURIComponent("听屿")}&algorithm=SHA1&digits=6&period=30`;
  return { secret, qr: await QRCode.toDataURL(uri, { width: 240, margin: 2 }) };
}
export function confirmEnrollment(sessionHash, code) {
  const entry = JSON.parse(setting("mfaPending") || "null");
  if (!entry || entry.session !== sessionHash || entry.expires < Date.now())
    return null;
  const secret = decrypt(entry.secret),
    step = matchStep(secret, code);
  if (step < 0) return null;
  setSetting("mfaSecret", encrypt(secret));
  setSetting("mfaLastStep", String(step));
  setSetting("mfaPending", "null");
  const codes = recoveryCodes();
  db.exec("DELETE FROM sessions");
  return codes;
}
