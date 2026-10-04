import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { wav, document } from "../tests/helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/browser-"));
process.env.PORT = "8790";
process.env.HOST = "127.0.0.1";
process.env.SITE_ORIGIN = "http://localhost:8790";
process.env.NODE_ENV = "test";
process.env.STORAGE_DRIVER = "local";
process.env.NO_LISTEN = "1";
const { setPassword } = await import("../server/security.mjs");
await setPassword("browser-test-only-password");
const { saveTrack, savePlaylist, getTrack } = await import("../server/db.mjs");
const { ingest } = await import("../server/media.mjs");
const ids = [];
for (const [i, title] of ["月光漫游", "落日来信", "潮汐之间"].entries()) {
  const id = randomUUID(),
    file = path.join(process.env.DATA_DIR, `${i}.wav`);
  ids.push(id);
  await writeFile(file, wav(12));
  saveTrack({
    ...document,
    id,
    title,
    tags: ["浏览器测试"],
    artwork: ["violet", "amber", "aqua"][i],
    genre: ["氛围电子", "轻爵士", "环境音乐"][i],
    mood: ["静谧", "温暖", "放松"][i],
    source: "本地合成样例",
    status: "draft",
    processing: "queued",
    createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    duration: 0,
    hasCover: false,
  });
  await ingest(id, file);
}
while (
  ids.some((id) => ["queued", "processing"].includes(getTrack(id)?.processing))
)
  await new Promise((r) => setTimeout(r, 100));
for (const id of ids) {
  const t = getTrack(id);
  if (t.processing !== "ready") throw new Error(t.processingError);
  saveTrack({ ...t, status: "published" });
}
savePlaylist({
  id: "focus",
  title: "专注时刻",
  description: "找到自己的节奏",
  artwork: "violet",
  trackIds: ids,
});
const { app } = await import("../server/index.mjs");
app.listen(8790, "127.0.0.1", () => console.log("E2E ready"));
