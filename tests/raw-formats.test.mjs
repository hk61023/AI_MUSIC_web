import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { document } from "./helpers.mjs";
await mkdir("artifacts", { recursive: true });
process.env.DATA_DIR = await mkdtemp(path.resolve("artifacts/raw-formats-"));
process.env.STORAGE_DRIVER = "local";
const { ingest, filePath, trackDir } = await import("../server/media.mjs");
const { saveTrack, getTrack, db } = await import("../server/db.mjs");
after(() => db.close());
test("FLAC、Ogg Vorbis／Opus、AAC 原样保留，无播放副本", async () => {
  for (const [extension, codec, mime] of [
    ["flac", "flac", "audio/flac"],
    ["ogg", "libvorbis", "audio/ogg"],
    ["ogg", "libopus", "audio/ogg"],
    ["aac", "aac", "audio/aac"],
  ]) {
    const id = randomUUID(),
      input = path.join(process.env.DATA_DIR, `${id}.${extension}`);
    const result = spawnSync(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:a",
        codec,
        input,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const original = await readFile(input);
    saveTrack({
      ...document,
      id,
      createdAt: new Date().toISOString(),
      status: "draft",
      processing: "queued",
      hasCover: false,
    });
    await ingest(id, input);
    for (let i = 0; i < 150 && getTrack(id).processing !== "ready"; i++) {
      assert.notEqual(
        getTrack(id).processing,
        "failed",
        getTrack(id).processingError,
      );
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(getTrack(id).processing, "ready");
    assert.equal(getTrack(id).audioMime, mime);
    assert.equal(getTrack(id).audioExtension, extension);
    assert.deepEqual(await readFile(filePath(id, "audio")), original);
    assert.equal(
      await stat(path.join(trackDir(id), "play.mp3")).catch(() => null),
      null,
    );
  }
});
