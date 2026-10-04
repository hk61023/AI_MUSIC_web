import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  allTracks,
  getTrack,
  saveTrack,
  savePlaylist,
  dataDir,
} from "../server/db.mjs";
import { ingest } from "../server/media.mjs";
if (
  process.env.NODE_ENV === "production" ||
  process.env.STORAGE_DRIVER === "gcs"
)
  throw new Error("样例仅允许在本地开发环境生成");
await import("./artwork.mjs");
const demos = [
  [
    "demo-moon",
    "月光漫游",
    "氛围电子",
    "静谧",
    "violet",
    "像月光缓缓落在窗边，让思绪在柔软的声音里自在漂浮。",
    220,
  ],
  [
    "demo-golden",
    "落日来信",
    "轻爵士",
    "温暖",
    "amber",
    "把晚霞藏进旋律，留一封没有寄出的温柔来信。",
    261.63,
  ],
  [
    "demo-tide",
    "潮汐之间",
    "环境音乐",
    "放松",
    "aqua",
    "闭上眼睛，在声音的起伏之间，找到属于自己的呼吸。",
    196,
  ],
  [
    "demo-night",
    "午夜留声",
    "Lo-fi",
    "慵懒",
    "rose",
    "城市渐渐安静，留一点柔和的节奏陪你度过夜晚。",
    174.61,
  ],
  [
    "demo-blue",
    "蓝色回声",
    "钢琴氛围",
    "沉思",
    "blue",
    "让简短的音符在空白之间回响，陪伴一段安静的时间。",
    293.66,
  ],
  [
    "demo-forest",
    "林间微风",
    "自然氛围",
    "清新",
    "sage",
    "一缕微风，一段轻轻展开的旋律，把步调放慢一点。",
    246.94,
  ],
];
const dir = path.join(dataDir, "demo-input");
await mkdir(dir, { recursive: true });
function wav(root) {
  const rate = 22050,
    duration = 36,
    count = rate * duration,
    pcm = Buffer.alloc(count * 2),
    notes = [1, 1.25, 1.5, 2, 1.5, 1.25, 0.75, 1];
  for (let i = 0; i < count; i++) {
    const s = i / rate,
      beat = s % 1.5,
      freq = root * notes[Math.floor(s / 1.5) % notes.length],
      env = Math.exp(-beat * 2.2),
      fade = Math.min(1, s / 2, (duration - s) / 3);
    const chord =
      (Math.sin(2 * Math.PI * root * s) +
        Math.sin(2 * Math.PI * root * 1.5 * s) +
        Math.sin(2 * Math.PI * root * 1.25 * s)) *
      0.027;
    const melody =
      (Math.sin(2 * Math.PI * freq * s) +
        0.23 * Math.sin(2 * Math.PI * freq * 2 * s)) *
      env *
      0.13;
    pcm.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, (chord + melody) * fade)) * 32767),
      i * 2,
    );
  }
  const head = Buffer.alloc(44);
  head.write("RIFF");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
const pending = [];
for (const [id, title, genre, mood, artwork, description, freq] of demos) {
  if (getTrack(id)) continue;
  const source = path.join(dir, `${id}.wav`);
  await writeFile(source, wav(freq));
  saveTrack({
    id,
    title,
    genre,
    mood,
    artwork,
    description,
    story:
      "这是用本地程序合成的播放器试听样例，用于验证上传处理、连续播放与下载功能。它不是 Google AI 生成的正式作品。你可以在后台下架样例，替换为自己的作品。",
    source: "本地合成样例",
    vocal: "instrumental",
    generatedAt: new Date().toISOString().slice(0, 10),
    tags: ["试听样例", mood],
    lyrics: "",
    prompt: "",
    featured: id === "demo-moon",
    downloadAllowed: true,
    rightsConfirmed: true,
    rightsEvidence: "项目内 scripts/demo.mjs 原创程序合成，不含第三方音源。",
    licenseText:
      "本地合成试听样例，仅用于网站功能体验；正式 AI 作品请按逐首许可使用。",
    createdAt: new Date(
      Date.now() - demos.findIndex((d) => d[0] === id) * 86400000,
    ).toISOString(),
    status: "draft",
    processing: "queued",
    duration: 0,
    hasCover: false,
  });
  await ingest(id, source);
  pending.push(id);
}
while (
  pending.some((id) =>
    ["queued", "processing"].includes(getTrack(id)?.processing),
  )
)
  await new Promise((r) => setTimeout(r, 500));
for (const id of pending) {
  const t = getTrack(id);
  if (t.processing === "failed") throw new Error(`${id}: ${t.processingError}`);
  saveTrack({ ...t, status: "published" });
}
if (!allTracks().length) throw new Error("样例初始化失败");
for (const [id, title, description, artwork, trackIds] of [
  [
    "list-focus",
    "专注时刻",
    "让思绪，找到自己的节奏。",
    "violet",
    ["demo-moon", "demo-blue", "demo-forest"],
  ],
  [
    "list-evening",
    "日落之后",
    "一段属于傍晚的温柔留白。",
    "amber",
    ["demo-golden", "demo-night"],
  ],
  [
    "list-relax",
    "松弛片刻",
    "放慢步调，听见生活的呼吸。",
    "aqua",
    ["demo-tide", "demo-forest"],
  ],
  [
    "list-night",
    "夜色漫游",
    "为不想入睡的灵感，留一盏灯。",
    "rose",
    ["demo-night", "demo-moon"],
  ],
]) {
  const { allPlaylists } = await import("../server/db.mjs");
  if (!allPlaylists().some((p) => p.id === id))
    savePlaylist({ id, title, description, artwork, trackIds });
}
console.log("本地试听样例已就绪（明确标注为程序合成，非 Google AI 作品）。");
