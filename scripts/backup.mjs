import { backup } from "node:sqlite";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { db, dataDir } from "../server/db.mjs";
import { cloudStorage } from "../server/media.mjs";
const dir = path.join(dataDir, "backups");
await mkdir(dir, { recursive: true });
const name = `music-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`;
await backup(db, path.join(dir, name));
if (cloudStorage)
  await cloudStorage.upload(path.join(dir, name), {
    destination: `backups/${name}`,
    metadata: { cacheControl: "no-store" },
  });
for (const name of await readdir(dir))
  if (
    /^music-.*\.sqlite$/.test(name) &&
    Date.now() - (await stat(path.join(dir, name))).mtimeMs > 30 * 86400000
  )
    await rm(path.join(dir, name));
console.log("数据库已安全备份。本地保留 30 天，云端保留由存储桶生命周期管理。");
