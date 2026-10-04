import path from "node:path";
import { command } from "./media.mjs";
const clean = (value, limit) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, limit);
export async function readAudioMetadata(file, filename) {
  if ([...filename].every((c) => c.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(filename, "latin1").toString("utf8");
    if (!decoded.includes("\ufffd")) filename = decoded;
  }
  const probe = JSON.parse(
    await command(process.env.FFPROBE_PATH || "ffprobe", [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-show_entries",
      "format=format_name,duration,bit_rate:format_tags:stream=codec_name,codec_type,sample_rate,channels:stream_tags:stream_disposition=attached_pic",
      "-of",
      "json",
      file,
    ]),
  );
  const audio = probe.streams?.find((s) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  const mp3 =
    /\.mp3$/i.test(filename) &&
    probe.format?.format_name === "mp3" &&
    audio?.codec_name === "mp3";
  const m4a =
    /\.m4a$/i.test(filename) &&
    probe.format?.format_name?.split(",").includes("mp4") &&
    ["aac", "alac"].includes(audio?.codec_name);
  if (
    (!mp3 && !m4a) ||
    probe.streams?.some(
      (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
    )
  )
    throw new Error(
      "文件内容必须为 MP3 或 M4A 音频（AAC／ALAC），不能包含视频",
    );
  if (!Number.isFinite(duration) || duration < 1 || duration > 1200)
    throw new Error("音频时长必须为 1 秒至 20 分钟");
  const tags = Object.fromEntries(
    Object.entries({ ...audio.tags, ...probe.format.tags }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  const title =
    clean(tags.title, 100) ||
    clean(
      path.basename(filename.replace(/\\/g, "/"), path.extname(filename)),
      100,
    ) ||
    "未命名作品";
  const genre = clean(tags.genre, 40);
  const info = [
    ["艺术家", tags.artist || tags.album_artist],
    ["专辑", tags.album],
    ["发行时间", tags.date || tags.year],
    ["曲目", tags.track],
    ["作曲", tags.composer],
    ["风格", genre],
    ["备注", tags.comment || tags.description],
  ]
    .filter(([, value]) => clean(value, 500))
    .map(([label, value]) => `${label}：${clean(value, 500)}`);
  const bitrate = Number(probe.format.bit_rate);
  info.push(
    `格式：${mp3 ? "MP3" : `M4A (${audio.codec_name.toUpperCase()})`}${bitrate > 0 ? ` · ${Math.round(bitrate / 1000)} kbps` : ""}${Number(audio.sample_rate) > 0 ? ` · ${audio.sample_rate} Hz` : ""}`,
  );
  const lyrics = Object.entries(tags).find(
    ([k]) =>
      k === "lyrics" ||
      k.startsWith("lyrics-") ||
      k.startsWith("unsyncedlyrics"),
  )?.[1];
  return {
    title,
    description: info.join("\n").slice(0, 500),
    genre,
    lyrics: clean(lyrics, 10000),
    duration,
  };
}
