import { DatabaseSync } from "node:sqlite";
import { mkdir, copyFile, stat, readFile, chmod } from "node:fs/promises";
import path from "node:path";
const [source, target, keySource] = process.argv.slice(2);
if (!source || !target)
  throw new Error("用法：node scripts/restore.mjs 备份.sqlite 新的数据目录");
const dir = path.resolve(target);
if (await stat(dir).catch(() => null))
  throw new Error("为避免覆盖，恢复目标必须是尚不存在的新目录");
const snapshot = new DatabaseSync(path.resolve(source), { readOnly: true });
if (snapshot.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
  throw new Error("备份完整性检查失败");
const count = snapshot.prepare("SELECT COUNT(*) AS n FROM tracks").get().n;
const needsKey = snapshot
  .prepare("SELECT value FROM settings WHERE key='mfaSecret'")
  .get()?.value;
if (needsKey && (!keySource || (await readFile(keySource)).length !== 32))
  throw new Error(
    "此备份已启用二次验证，请以第三个参数提供原 32 字节 mfa.key；不会取消验证器保护",
  );
snapshot.close();
await mkdir(dir, { recursive: true });
await copyFile(source, path.join(dir, "music.sqlite"));
if (needsKey) {
  await copyFile(keySource, path.join(dir, "mfa.key"));
  await chmod(path.join(dir, "mfa.key"), 0o600);
}
const restored = new DatabaseSync(path.join(dir, "music.sqlite"));
restored.exec("DELETE FROM sessions");
restored.close();
console.log(
  `备份完整，已恢复 ${count} 首作品的元数据。生产媒体仍在私有 GCS 桶中；切换 DATA_DIR 前停止服务，并检查账号与存储配置。`,
);
