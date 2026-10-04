import path from "node:path";
import { mkdir, copyFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Storage } from "@google-cloud/storage";
import { dataDir, getTrack, saveTrack } from "./db.mjs";
export const trackDir = (id) => path.join(dataDir, "private", id);
export const filePath = (id, type) =>
  path.join(trackDir(id), type === "audio" ? "play.mp3" : "cover.jpg");
const bucket =
  process.env.STORAGE_DRIVER === "gcs"
    ? new Storage().bucket(process.env.GCS_BUCKET || "")
    : null;
export const cloudStorage = bucket;
function command(program, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("处理超时，请上传较短的音频"));
    }, 180000);
    child.stdout.on("data", (b) => {
      if (out.length < 100000) out += b;
    });
    child.stderr.on("data", (b) => {
      if (err.length < 20000) err += b;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 ${program}，请检查 FFmpeg 安装：${e.code}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(new Error("音频或封面无法解码，请检查文件格式"));
    });
  });
}
const queue = [];
let busy = false;
export function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  void drain();
}
async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) await processTrack(queue.shift());
  } finally {
    busy = false;
  }
}
async function processTrack(id) {
  let t = getTrack(id);
  if (!t) return;
  saveTrack({ ...t, processing: "processing", processingError: "" });
  try {
    const source = path.join(trackDir(id), "original");
    const probe = JSON.parse(
      await command(process.env.FFPROBE_PATH || "ffprobe", [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        source,
      ]),
    );
    const duration = Number(probe.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration < 1 ||
      duration > 1200 ||
      !probe.streams?.some((s) => s.codec_type === "audio")
    )
      throw new Error("音频必须包含音轨，时长为 1 秒至 20 分钟");
    await command(process.env.FFMPEG_PATH || "ffmpeg", [
      "-y",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-threads",
      "1",
      "-i",
      source,
      "-vn",
      "-map_metadata",
      "-1",
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      filePath(id, "audio"),
    ]);
    const cover = path.join(trackDir(id), "cover-original");
    if (await stat(cover).catch(() => null))
      await command(process.env.FFMPEG_PATH || "ffmpeg", [
        "-y",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-threads",
        "1",
        "-i",
        cover,
        "-vf",
        "scale=1000:1000:force_original_aspect_ratio=increase,crop=1000:1000",
        "-frames:v",
        "1",
        filePath(id, "cover"),
      ]);
    if (bucket) {
      await bucket.upload(source, {
        destination: `private/${id}/original`,
        metadata: { cacheControl: "no-store" },
      });
      await bucket.upload(filePath(id, "audio"), {
        destination: `private/${id}/play.mp3`,
        metadata: { contentType: "audio/mpeg", cacheControl: "no-store" },
      });
      if (await stat(filePath(id, "cover")).catch(() => null))
        await bucket.upload(filePath(id, "cover"), {
          destination: `private/${id}/cover.jpg`,
          metadata: { contentType: "image/jpeg", cacheControl: "no-store" },
        });
    }
    const hasCover = Boolean(
      await stat(filePath(id, "cover")).catch(() => null),
    );
    // Production media is durable in GCS; local workspace is only a processing spool.
    if (bucket) await rm(trackDir(id), { recursive: true, force: true });
    t = getTrack(id);
    saveTrack({
      ...t,
      duration,
      hasCover,
      processing: "ready",
      mediaVersion: Date.now(),
      processingError: "",
    });
  } catch (error) {
    t = getTrack(id);
    saveTrack({ ...t, processing: "failed", processingError: error.message });
  }
}
export async function ingest(id, audio, cover) {
  await mkdir(trackDir(id), { recursive: true });
  await copyFile(audio, path.join(trackDir(id), "original"));
  if (cover) await copyFile(cover, path.join(trackDir(id), "cover-original"));
  enqueue(id);
}
export async function publishMedia(t) {
  if (!bucket) return;
  for (const [file, mime] of [
    ["play.mp3", "audio/mpeg"],
    ...(t.hasCover ? [["cover.jpg", "image/jpeg"]] : []),
  ]) {
    await bucket
      .file(`private/${t.id}/${file}`)
      .copy(bucket.file(`published/${t.id}/${file}`));
    await bucket
      .file(`published/${t.id}/${file}`)
      .setMetadata({ contentType: mime, cacheControl: "private,no-store" });
  }
}
export async function unpublishMedia(t) {
  if (!bucket) return;
  await Promise.all(
    ["play.mp3", "cover.jpg"].map((f) =>
      bucket.file(`published/${t.id}/${f}`).delete({ ignoreNotFound: true }),
    ),
  );
}
export async function sendMedia(
  req,
  res,
  t,
  type,
  { preview = false, download = false } = {},
) {
  res.set("Cache-Control", "no-store");
  if (type === "cover" && !t.hasCover)
    return res.status(404).json({ error: "该作品没有上传封面" });
  if (bucket) {
    const key = `${preview ? "private" : "published"}/${t.id}/${type === "audio" ? "play.mp3" : "cover.jpg"}`;
    const [url] = await bucket.file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 120000,
      ...(download
        ? { responseDisposition: `attachment; filename="${t.id}.mp3"` }
        : {}),
    });
    return res.redirect(302, url);
  }
  if (download) res.attachment(`${t.title.replace(/[\r\n"\\/]/g, "_")}.mp3`);
  res.sendFile(filePath(t.id, type), { cacheControl: false }, (error) => {
    if (error && !res.headersSent)
      res.status(404).json({ error: "媒体文件缺失，请联系管理员" });
  });
}
