import { mkdtemp, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { getTrack, allTracks, saveTrack, db } from "../server/db.mjs";
import { cloudStorage as bucket, inspectOriginal } from "../server/media.mjs";
if (!bucket) throw new Error("迁移仅适用于配置好的私有 GCS 存储");
const directory = await mkdtemp(
  path.join(tmpdir(), "tingyu-original-migration-"),
);
const source = path.join(directory, "original");
const converted = [];
let failed = 0;
try {
  for (const initial of allTracks()) {
    if (initial.rawAudio || initial.processing !== "ready") continue;
    try {
      const object = bucket.file(`private/${initial.id}/original`);
      await object.download({ destination: source });
      const info = await inspectOriginal(source);
      await object.setMetadata({
        contentType: info.audioMime,
        cacheControl: "private,no-store",
      });
      if (initial.hasCover) {
        const [exists] = await bucket
          .file(`private/${initial.id}/cover.jpg`)
          .exists();
        if (!exists) throw new Error("私有封面缺失，保留旧版播放");
      }
      const current = getTrack(initial.id);
      if (!current || current.processing !== "ready" || current.rawAudio)
        continue;
      saveTrack({ ...current, ...info, mediaVersion: Date.now() });
      converted.push(initial.id);
      console.log(`ORIGINAL_AUDIO_ENABLED ${initial.id}`);
    } catch (error) {
      failed++;
      console.error(`MIGRATION_SKIPPED ${initial.id}: ${error.message}`);
    } finally {
      await rm(source, { force: true });
    }
  }
  if (converted.length) {
    // Previously issued signed links last at most 120 seconds. Keep their targets until they expire.
    console.log("WAITING_FOR_OLD_SIGNED_LINKS_TO_EXPIRE");
    await new Promise((r) => setTimeout(r, 125000));
  }
  let removedBytes = 0;
  for (const id of converted) {
    if (!getTrack(id)?.rawAudio) continue;
    for (const name of [
      `private/${id}/play.mp3`,
      `published/${id}/play.mp3`,
      `published/${id}/cover.jpg`,
    ]) {
      const object = bucket.file(name);
      const [exists] = await object.exists();
      if (!exists) continue;
      const [metadata] = await object.getMetadata();
      await object.delete({ ignoreNotFound: true });
      removedBytes += Number(metadata.size || 0);
    }
  }
  console.log(
    JSON.stringify({
      migrated: converted.length,
      skipped: failed,
      redundantBytesRemoved: removedBytes,
    }),
  );
  if (failed) process.exitCode = 1;
} finally {
  await rm(source, { force: true });
  await rmdir(directory);
  db.close();
}
