import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdir, rm, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  db,
  dataDir,
  allTracks,
  getTrack,
  saveTrack,
  allPlaylists,
  savePlaylist,
  publicTrack,
  setting,
} from "./db.mjs";
import {
  requireAdmin,
  isAdmin,
  checkPassword,
  login,
  logout,
  sameOrigin,
} from "./security.mjs";
import {
  ingest,
  enqueue,
  publishMedia,
  unpublishMedia,
  sendMedia,
} from "./media.mjs";
import { trackHtml, escapeHtml } from "./seo.mjs";
import { readAudioMetadata } from "./audio-metadata.mjs";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.SITE_ORIGIN?.startsWith("https://") ||
    !setting("adminHash") ||
    process.env.STORAGE_DRIVER !== "gcs" ||
    !process.env.GCS_BUCKET)
)
  throw new Error(
    "生产环境需要 HTTPS SITE_ORIGIN、管理员密码、STORAGE_DRIVER=gcs 和私有 GCS_BUCKET",
  );
export const app = express();
app.disable("x-powered-by");
if (production) app.set("trust proxy", "loopback");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://storage.googleapis.com"],
        mediaSrc: ["'self'", "https://storage.googleapis.com"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
);
app.use(
  "/api",
  sameOrigin,
  express.json({ limit: "256kb" }),
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
);
const limiter = (limit, minutes = 1) =>
  rateLimit({
    windowMs: minutes * 60000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "请求过于频繁，请稍后再试" },
  });
app.use("/api", limiter(300));
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/catalog", (req, res) => {
  const tracks = allTracks()
      .filter((t) => t.status === "published")
      .map(publicTrack),
    ids = new Set(tracks.map((t) => t.id));
  res.json({
    tracks,
    playlists: allPlaylists().map((p) => ({
      ...p,
      trackIds: p.trackIds.filter((id) => ids.has(id)),
    })),
  });
});
app.get("/api/tracks/:id", (req, res) => {
  const t = getTrack(req.params.id);
  if (!t || t.status !== "published")
    return res.status(404).json({ error: "作品不存在或已下架" });
  res.json(publicTrack(t));
});
app.get("/media/:id/:type", limiter(180), async (req, res) => {
  const t = getTrack(req.params.id),
    type = req.params.type;
  if (!t || t.status !== "published" || !["audio", "cover"].includes(type))
    return res.status(404).json({ error: "作品不存在或已下架" });
  await sendMedia(req, res, t, type);
});
app.get("/api/tracks/:id/download", limiter(10), async (req, res) => {
  const t = getTrack(req.params.id);
  if (!t || t.status !== "published")
    return res.status(404).json({ error: "作品不存在或已下架" });
  if (!t.downloadAllowed || !t.rightsConfirmed)
    return res.status(403).json({ error: "该作品尚未开放下载" });
  db.prepare("INSERT INTO events VALUES(?,?,?,?)").run(
    t.id,
    randomUUID(),
    "download",
    Date.now(),
  );
  await sendMedia(req, res, t, "audio", { download: true });
});
const eventSchema = z.object({
  trackId: z.string().max(80),
  playId: z.uuid(),
  kind: z.enum(["start", "engaged", "complete", "error"]),
});
app.post("/api/events", limiter(60), (req, res) => {
  const e = eventSchema.parse(req.body),
    t = getTrack(e.trackId);
  if (!t || t.status !== "published")
    return res.status(404).json({ error: "作品已下架" });
  db.prepare("INSERT OR IGNORE INTO events VALUES(?,?,?,?)").run(
    t.id,
    e.playId,
    e.kind,
    Date.now(),
  );
  res.sendStatus(204);
});
app.get("/api/admin/session", (req, res) =>
  res.json({
    authenticated: isAdmin(req),
    configured: Boolean(setting("adminHash")),
  }),
);
app.post("/api/admin/login", limiter(8, 15), async (req, res) => {
  const { password } = z
    .object({ password: z.string().max(256) })
    .parse(req.body);
  if (!(await checkPassword(password)))
    return res.status(401).json({ error: "密码不正确，或管理员尚未初始化" });
  login(res);
  res.json({ ok: true });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  logout(req, res);
  res.sendStatus(204);
});
app.use("/api/admin", requireAdmin);
app.get("/api/admin/catalog", (req, res) =>
  res.json({ tracks: allTracks(), playlists: allPlaylists() }),
);
app.get("/api/admin/stats", (req, res) =>
  res.json({
    counts: db
      .prepare("SELECT kind,COUNT(*) AS count FROM events GROUP BY kind")
      .all(),
    tracks: db
      .prepare(
        "SELECT track_id AS trackId,kind,COUNT(*) AS count FROM events GROUP BY track_id,kind",
      )
      .all(),
  }),
);
const text = z.string().trim();
const trackSchema = z
  .object({
    title: text.min(1).max(100),
    description: text.max(500),
    story: text.max(5000),
    genre: text.max(40),
    mood: text.max(40),
    vocal: z.enum(["instrumental", "vocal"]),
    source: z.enum(["MusicFX", "Flow Music", "其他", "本地合成样例"]),
    generatedAt: text.max(30),
    tags: z.array(text.max(30)).max(12),
    lyrics: text.max(10000),
    prompt: text.max(5000),
    featured: z.boolean(),
    downloadAllowed: z.boolean(),
    rightsConfirmed: z.boolean(),
    rightsEvidence: text.max(2000),
    licenseText: text.max(2000),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (
      t.downloadAllowed &&
      (!t.rightsConfirmed || !t.rightsEvidence || !t.licenseText)
    )
      ctx.addIssue({
        code: "custom",
        message: "开放下载需要确认权利并填写许可依据和使用说明",
      });
  });
app.post("/api/admin/tracks", (req, res) => {
  const doc = trackSchema.parse(req.body);
  const t = {
    ...doc,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "draft",
    processing: "empty",
    duration: 0,
    hasCover: false,
    artwork: "violet",
  };
  saveTrack(t);
  res.status(201).json(t);
});
app.put("/api/admin/tracks/:id", (req, res) => {
  const t = getTrack(req.params.id);
  if (!t) return res.status(404).json({ error: "作品不存在" });
  if (transitions.has(t.id))
    return res.status(409).json({ error: "请等待发布或下架完成后再编辑" });
  const next = { ...t, ...trackSchema.parse(req.body) };
  saveTrack(next);
  res.json(next);
});
const uploadDir = path.join(dataDir, "uploads");
await mkdir(uploadDir, { recursive: true });
// Browser sends one file at a time: bounded memory/disk use and per-file results.
const importMp3 = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter(req, file, cb) {
    const valid =
      file.fieldname === "audio" && /\.(mp3|m4a)$/i.test(file.originalname);
    cb(valid ? null : new Error("批量导入只支持 MP3／M4A 文件"), valid);
  },
}).single("audio");
const activeImports = new Set();
app.post(
  ["/api/admin/import-audio", "/api/admin/import-mp3"],
  (req, res, next) => {
    const importId = req.get("X-Import-ID") || randomUUID();
    if (!z.string().uuid().safeParse(importId).success)
      return res.status(400).json({ error: "导入标识无效" });
    if (activeImports.has(importId))
      return res.status(409).json({ error: "该文件正在导入，请稍后重试" });
    activeImports.add(importId);
    importMp3(req, res, async (error) => {
      let created;
      try {
        if (error) throw error;
        if (!req.file)
          return res.status(400).json({ error: "请选择 MP3／M4A 文件" });
        const existing = allTracks().find((t) => t.importId === importId);
        if (existing) return res.status(201).json(existing);
        const metadata = await readAudioMetadata(
          req.file.path,
          req.file.originalname,
        );
        const { duration, ...fields } = metadata;
        const doc = trackSchema.parse({
          ...fields,
          story: "",
          mood: "",
          vocal: "instrumental",
          source: "其他",
          generatedAt: "",
          tags: [],
          prompt: "",
          featured: false,
          downloadAllowed: false,
          rightsConfirmed: false,
          rightsEvidence: "",
          licenseText: "",
        });
        created = {
          ...doc,
          id: randomUUID(),
          importId,
          createdAt: new Date().toISOString(),
          status: "draft",
          processing: "queued",
          duration: metadata.duration,
          hasCover: false,
          artwork: "violet",
          originalName: req.file.originalname,
        };
        saveTrack(created);
        await ingest(created.id, req.file.path);
        res.status(201).json(created);
      } catch (error) {
        if (created) {
          saveTrack({
            ...created,
            processing: "failed",
            processingError: "导入未完成，请在作品编辑页重新上传",
          });
          return res.status(201).json({ ...created, processing: "failed" });
        }
        if (error instanceof multer.MulterError) return next(error);
        res.status(400).json({ error: error.message || "无法读取音频信息" });
      } finally {
        activeImports.delete(importId);
        if (req.file) await rm(req.file.path, { force: true });
      }
    });
  },
);
const uploading = new Set();
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 100 * 1024 * 1024, files: 2, fields: 0 },
  fileFilter(req, file, cb) {
    const audio =
      file.fieldname === "audio" &&
      /\.(mp3|wav|flac|m4a|ogg|aac)$/i.test(file.originalname);
    const cover =
      file.fieldname === "cover" &&
      /\.(png|jpg|jpeg|webp)$/i.test(file.originalname);
    cb(
      audio || cover
        ? null
        : new Error("音频支持 MP3/WAV/FLAC/M4A/OGG/AAC；封面支持 PNG/JPG/WebP"),
      audio || cover,
    );
  },
}).fields([
  { name: "audio", maxCount: 1 },
  { name: "cover", maxCount: 1 },
]);
app.post("/api/admin/tracks/:id/upload", (req, res, next) => {
  const t = getTrack(req.params.id);
  if (!t) return res.status(404).json({ error: "作品不存在" });
  if (
    transitions.has(t.id) ||
    uploading.has(t.id) ||
    t.status === "published" ||
    t.processing === "processing" ||
    t.processing === "queued"
  )
    return res.status(409).json({ error: "请先下架作品，并等待当前处理完成" });
  uploading.add(t.id);
  upload(req, res, async (error) => {
    const files = Object.values(req.files || {}).flat();
    try {
      if (error) throw error;
      const audio = req.files.audio?.[0],
        cover = req.files.cover?.[0];
      if (!audio) throw new Error("请选择音频文件");
      saveTrack({
        ...t,
        processing: "queued",
        processingError: "",
        originalName: audio.originalname,
      });
      await ingest(t.id, audio.path, cover?.path);
      res.status(202).json({ ok: true });
    } catch (e) {
      saveTrack({
        ...getTrack(t.id),
        processing: "failed",
        processingError: e.message,
      });
      next(e);
    } finally {
      uploading.delete(t.id);
      await Promise.all(files.map((f) => rm(f.path, { force: true })));
    }
  });
});
app.post("/api/admin/tracks/:id/retry", (req, res) => {
  const t = getTrack(req.params.id);
  if (!t) return res.status(404).json({ error: "作品不存在" });
  if (t.status === "published" || !["failed", "empty"].includes(t.processing))
    return res.status(409).json({ error: "当前状态不可重试" });
  saveTrack({ ...t, processing: "queued" });
  enqueue(t.id);
  res.status(202).json({ ok: true });
});
app.get("/api/admin/tracks/:id/preview/:type", async (req, res) => {
  const t = getTrack(req.params.id);
  if (
    !t ||
    t.processing !== "ready" ||
    !["audio", "cover"].includes(req.params.type)
  )
    return res.status(404).json({ error: "媒体尚未就绪" });
  await sendMedia(req, res, t, req.params.type, { preview: true });
});
const transitions = new Set();
app.post("/api/admin/tracks/:id/publish", async (req, res) => {
  let t = getTrack(req.params.id);
  if (!t) return res.status(404).json({ error: "作品不存在" });
  if (transitions.has(t.id))
    return res.status(409).json({ error: "作品正在发布或下架" });
  if (uploading.has(t.id) || t.processing !== "ready")
    return res.status(409).json({ error: "音频尚未处理完成" });
  trackSchema.parse(
    Object.fromEntries(Object.keys(trackSchema.shape).map((k) => [k, t[k]])),
  );
  transitions.add(t.id);
  try {
    await publishMedia(t);
    t = getTrack(t.id);
    saveTrack({ ...t, status: "published" });
    res.json({ ok: true });
  } finally {
    transitions.delete(t.id);
  }
});
app.post("/api/admin/tracks/:id/unpublish", async (req, res) => {
  const t = getTrack(req.params.id);
  if (!t) return res.status(404).json({ error: "作品不存在" });
  if (transitions.has(t.id))
    return res.status(409).json({ error: "作品正在发布或下架" });
  transitions.add(t.id);
  try {
    // Revoke new URL issuance before deleting cloud copies. Repeated calls retry failed deletion.
    saveTrack({ ...t, status: "draft" });
    await unpublishMedia(t);
    res.json({ ok: true });
  } finally {
    transitions.delete(t.id);
  }
});
const listSchema = z
  .object({
    title: text.min(1).max(100),
    description: text.max(500),
    artwork: z.enum(["violet", "amber", "aqua", "rose", "blue", "sage"]),
    trackIds: z.array(z.string().max(80)).max(500),
  })
  .strict();
app.post("/api/admin/playlists", (req, res) => {
  const p = { ...listSchema.parse(req.body), id: randomUUID() };
  if (p.trackIds.some((id) => !getTrack(id)))
    return res.status(400).json({ error: "歌单包含不存在的作品" });
  savePlaylist(p);
  res.status(201).json(p);
});
app.put("/api/admin/playlists/:id", (req, res) => {
  if (!allPlaylists().some((p) => p.id === req.params.id))
    return res.status(404).json({ error: "歌单不存在" });
  const p = { ...listSchema.parse(req.body), id: req.params.id };
  if (p.trackIds.some((id) => !getTrack(id)))
    return res.status(400).json({ error: "歌单包含不存在的作品" });
  savePlaylist(p);
  res.json(p);
});
app.delete("/api/admin/playlists/:id", (req, res) => {
  db.prepare("DELETE FROM playlists WHERE id=?").run(req.params.id);
  res.sendStatus(204);
});
app.use("/api", (req, res) => res.status(404).json({ error: "接口不存在" }));
const dist = path.resolve("dist");
app.get("/sitemap.xml", (req, res) => {
  const origin = process.env.SITE_ORIGIN || "http://localhost:8787";
  const urls = [
    "",
    "/music",
    "/playlists",
    "/about",
    ...allTracks()
      .filter((t) => t.status === "published")
      .map((t) => `/tracks/${t.id}`),
  ];
  res
    .set("Cache-Control", "no-store")
    .type("application/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((p) => `<url><loc>${escapeHtml(origin + p)}</loc></url>`).join("")}</urlset>`,
    );
});
app.get(["/tracks/:id", "/tracks/:id/index.html"], async (req, res) => {
  const t = getTrack(req.params.id);
  if (!t || t.status !== "published")
    return res
      .status(404)
      .type("html")
      .send(
        '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>作品已下架 · 听屿</title><h1>作品不存在或已下架</h1><a href="/">返回音乐馆</a></html>',
      );
  if (!(await stat(path.join(dist, "index.html")).catch(() => null)))
    return res.redirect(`http://localhost:5173/tracks/${t.id}`);
  res
    .set("Cache-Control", "no-store")
    .type("html")
    .send(
      trackHtml(
        await readFile(path.join(dist, "index.html"), "utf8"),
        t,
        process.env.SITE_ORIGIN || "http://localhost:8787",
      ),
    );
});
app.use(express.static(dist, { index: false }));
app.get("/{*path}", async (req, res) => {
  if (req.path.includes(".")) return res.sendStatus(404);
  res.sendFile(path.join(dist, "index.html"), (e) => {
    if (e && !res.headersSent)
      res.status(503).json({
        error: "前端尚未构建，请运行 npm run build 或访问开发端口 5173",
      });
  });
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: err.issues.map((i) => i.message).join("；") });
  if (err instanceof multer.MulterError)
    return res
      .status(400)
      .json({ error: "上传超出限制：每个文件最多 100 MB，音频与封面各一个" });
  if (err.status === 413)
    return res.status(413).json({ error: "请求内容过大" });
  console.error("Request failed:", err.code || err.message);
  res.status(400).json({ error: "操作失败，请检查文件、配置或稍后重试" });
});
for (const t of allTracks())
  if (["processing", "queued"].includes(t.processing)) enqueue(t.id);
const cleanup = setInterval(() => {
  db.prepare("DELETE FROM events WHERE created<?").run(
    Date.now() - 90 * 86400000,
  );
  db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
}, 3600000);
cleanup.unref();
if (process.env.NO_LISTEN !== "1")
  app.listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () =>
      console.log(
        `听屿 API: http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 8787}`,
      ),
  );
