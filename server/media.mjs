import path from "node:path";
import { mkdir, copyFile, rm, stat, rmdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Storage } from "@google-cloud/storage";
import { dataDir, getTrack, saveTrack } from "./db.mjs";
export const trackDir = (id) => path.join(dataDir, "private", id);
export const filePath = (id, type) =>
  path.join(
    trackDir(id),
    type === "audio"
      ? getTrack(id)?.rawAudio
        ? "original"
        : "play.mp3"
      : "cover.jpg",
  );
const bucket =
  process.env.STORAGE_DRIVER === "gcs"
    ? new Storage().bucket(process.env.GCS_BUCKET || "")
    : null;
export const cloudStorage = bucket;
export function command(program, args) {
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
export async function inspectOriginal(source) {
  const probe = JSON.parse(
    await command(process.env.FFPROBE_PATH || "ffprobe", [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "format=duration,format_name:stream=codec_type,codec_name:stream_disposition=attached_pic",
      "-of",
      "json",
      source,
    ]),
  );
  const audio = probe.streams?.find((s) => s.codec_type === "audio");
  const formats = probe.format?.format_name?.split(",") || [];
  const duration = Number(probe.format?.duration);
  let extension, mime;
  if (formats.includes("mp3") && audio?.codec_name === "mp3")
    [extension, mime] = ["mp3", "audio/mpeg"];
  else if (
    formats.includes("mp4") &&
    ["aac", "alac"].includes(audio?.codec_name)
  )
    [extension, mime] = ["m4a", "audio/mp4"];
  else if (formats.includes("wav") && audio?.codec_name?.startsWith("pcm_"))
    [extension, mime] = ["wav", "audio/wav"];
  else if (formats.includes("flac") && audio?.codec_name === "flac")
    [extension, mime] = ["flac", "audio/flac"];
  else if (
    formats.includes("ogg") &&
    ["vorbis", "opus"].includes(audio?.codec_name)
  )
    [extension, mime] = ["ogg", "audio/ogg"];
  else if (formats.includes("aac") && audio?.codec_name === "aac")
    [extension, mime] = ["aac", "audio/aac"];
  if (
    !extension ||
    probe.streams?.some(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    )
  )
    throw new Error(
      "请选择 MP3、M4A、PCM WAV、FLAC、Ogg 或 AAC 音频，不能包含视频",
    );
  if (!Number.isFinite(duration) || duration < 1 || duration > 1200)
    throw new Error("音频必须包含音轨，时长为 1 秒至 20 分钟");
  return {
    duration,
    rawAudio: true,
    audioMime: mime,
    audioExtension: extension,
  };
}
let busy = false;
export function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  void drain();
}
export function cancelQueued(id) {
  const index = queue.indexOf(id);
  if (index >= 0) queue.splice(index, 1);
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
    const audioInfo = await inspectOriginal(source);
    const cover = path.join(trackDir(id), "cover-original");
    const separateCover = await stat(cover).catch(() => null);
    const embedded =
      !separateCover &&
      JSON.parse(
        await command(process.env.FFPROBE_PATH || "ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "stream=index:stream_disposition=attached_pic",
          "-of",
          "json",
          source,
        ]),
      ).streams?.find((s) => s.disposition?.attached_pic);
    if (separateCover || embedded)
      await command(process.env.FFMPEG_PATH || "ffmpeg", [
        "-y",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-threads",
        "1",
        "-i",
        separateCover ? cover : source,
        "-map",
        separateCover ? "0:v:0" : `0:${embedded.index}`,
        "-vf",
        "scale=1000:1000:force_original_aspect_ratio=increase,crop=1000:1000",
        "-frames:v",
        "1",
        filePath(id, "cover"),
      ]);
    if (bucket) {
      await bucket.upload(source, {
        destination: `private/${id}/original`,
        metadata: {
          contentType: audioInfo.audioMime,
          cacheControl: "private,no-store",
        },
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
    if (!t) return;
    saveTrack({
      ...t,
      ...audioInfo,
      hasCover,
      processing: "ready",
      mediaVersion: Date.now(),
      processingError: "",
    });
  } catch (error) {
    t = getTrack(id);
    if (!t) return;
    saveTrack({ ...t, processing: "failed", processingError: error.message });
  }
}
export async function ingest(id, audio, cover) {
  await mkdir(trackDir(id), { recursive: true });
  await copyFile(audio, path.join(trackDir(id), "original"));
  if (cover) await copyFile(cover, path.join(trackDir(id), "cover-original"));
  enqueue(id);
}
export async function deleteDraftMedia(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("作品标识无效");
  if (bucket) {
    for (const name of ["original", "play.mp3", "cover.jpg"])
      await bucket
        .file(`private/${id}/${name}`)
        .delete({ ignoreNotFound: true });
  }
  for (const name of ["original", "play.mp3", "cover.jpg", "cover-original"])
    await rm(path.join(trackDir(id), name), { force: true });
  await rmdir(trackDir(id)).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
export async function publishMedia(t) {
  if (!bucket) return;
  if (t.rawAudio) {
    for (const name of ["original", ...(t.hasCover ? ["cover.jpg"] : [])]) {
      const [exists] = await bucket.file(`private/${t.id}/${name}`).exists();
      if (!exists) throw new Error("媒体文件缺失，请重新上传");
    }
    return;
  }
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
  if (!bucket || t.rawAudio) return;
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
    const key = `${t.rawAudio || preview ? "private" : "published"}/${t.id}/${type === "audio" ? (t.rawAudio ? "original" : "play.mp3") : "cover.jpg"}`;
    const [url] = await bucket.file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + 120000,
      ...(download
        ? {
            responseDisposition: `attachment; filename="${t.id}.${t.audioExtension || "mp3"}"`,
          }
        : {}),
    });
    return res.redirect(302, url);
  }
  if (download)
    res.attachment(
      `${t.title.replace(/[\r\n"\\/]/g, "_")}.${t.audioExtension || "mp3"}`,
    );
  res.type(type === "audio" ? t.audioMime || "audio/mpeg" : "image/jpeg");
  res.sendFile(filePath(t.id, type), { cacheControl: false }, (error) => {
    if (error && !res.headersSent)
      res.status(404).json({ error: "媒体文件缺失，请联系管理员" });
  });
}
