# 听屿 · AI 音乐馆

React + TypeScript、Node.js 24、SQLite、FFmpeg。沉浸式作品展示、不中断的全站播放器、曲库筛选、歌单、本地收藏、下载许可控制和单管理员后台。

## 本地运行（Windows PowerShell）

安装 Node.js **24 LTS** 和 FFmpeg（包含 ffprobe，均加入 PATH），在项目目录运行：

```powershell
npm.cmd install
Copy-Item .env.example .env
npm.cmd run demo
npm.cmd run admin:set
npm.cmd run dev
```

打开 http://localhost:5173；管理后台为 http://localhost:5173/admin。管理员密码至少 12 字符，只有 scrypt 散列存进 SQLite；初始化、修改密码会注销旧会话。`.env`、数据库、原始音频、依赖和凭据均在 `.gitignore` 中，不应提交。

当前工作环境的 5173 已被其他服务占用，已在本地 `.env` 设置 `WEB_PORT=5178` 和 `SITE_ORIGIN=http://localhost:5178`；本次预览请访问 **http://localhost:5178**。换端口时这两项应一起修改。

样例是本地程序合成的 **36 秒音频**，不是 Google AI 作品。原创抽象 SVG 封面在 `public/covers/`，样例及上传内容在 `data/`。`npm run demo` 不覆盖已存在的样例记录。正式发布前在后台下架样例，上传你自己的 MusicFX / Flow Music 作品。

## 构建与测试

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run test:browser
```

浏览器测试使用本地安装的 Chrome，隔离数据目录和独立的测试账号，启动测试端口 8790。`npm run start` 在 8787 提供构建后的站点；若用该端口进行管理操作，需要把 `.env` 的 `SITE_ORIGIN` 改为 `http://localhost:8787`。开发模式固定使用 `http://localhost:5173`，来源必须完全一致。

## 工作流程

后台“批量导入 MP3／M4A”一次可选择最多 50 首（单首 100 MB、1 秒至 20 分钟），按文件顺序上传。读取内嵌标题、艺术家、专辑、文件日期标签、曲目、作曲、风格、备注及歌词，自动填写草稿标题、简介、风格和歌词；没有标题时使用文件名。每首单独显示结果，可停止后续上传或重试失败文件，重试使用稳定导入标识以避免重复建档。所有导入作品保持草稿，下载关闭；生成来源默认“其他”，生成日期留空，需核对来源、人声类型及许可后预览发布。标签内容只按文本保存，不执行其中的 HTML。

1. 管理员创建草稿，填标题、风格、情绪、来源和创作说明。
2. 上传音频与可选封面。每个文件上限 100 MB；音频 1 秒至 20 分钟。FFprobe 检查真实音轨，音频原样保存，不重编码、不调整响度，播放与下载共用原始文件。封面单独转为 1000×1000 JPEG。
3. 自动排队；处理失败可重试或重新上传；服务重启会恢复尚未完成的任务。
4. 处理完成后在后台试听、检查封面，再发布。重新上传需先下架。
5. 下载默认关闭。开启前必须填写许可依据（仅后台可见）、使用说明并确认相关权利。
6. 歌单可选作品并调整顺序；草稿不会出现在公开歌单中。

播放器支持顺序／随机／单曲循环、队列、拖动、音量、系统媒体控制；刷新恢复队列和位置，等待用户主动播放。收藏保存在当前浏览器，不跨设备同步。上传预览使用独立的后台音频控件，正式播放使用页面外的共享播放器。

## API

公开：`GET /api/catalog`、`GET /api/tracks/:id`、`GET /media/:id/audio`、`GET /media/:id/cover`、`GET /api/tracks/:id/download`、`POST /api/events`。

管理：`POST /api/admin/login`、`POST /api/admin/logout`、`GET /api/admin/session`、`GET /api/admin/catalog`、`GET /api/admin/stats`、`POST /api/admin/tracks`、`PUT /api/admin/tracks/:id`、`POST /api/admin/tracks/:id/{upload,retry,publish,unpublish}`、`GET /api/admin/tracks/:id/preview/{audio,cover}`；歌单有 POST / PUT / DELETE。

写操作必须提供与 `SITE_ORIGIN` 完全一致的 Origin；后台还需 HttpOnly、SameSite Strict 会话，生产使用 Secure cookie。只信任本机反向代理。所有返回给访客的作品都删除许可依据、原始文件名和处理错误。播放事件按作品、播放会话和事件类型去重；统计保留最近 90 天，只表示请求/客户端事件，不能作为精确收入结算数据。

## 部署与尚需实测的项目

Google Cloud 完整配置见 [部署文档](deploy/GOOGLE_CLOUD.md)。生产环境必须使用 GCS；本地文件驱动只用于开发。

SEO：构建时预生成公开作品页、sitemap 和 robots；运行时作品页再次核验发布状态并输出最新标题、介绍与 Open Graph 信息。更新内容不必重新构建前端；sitemap 在服务端动态输出。作品 ID 链接不会随标题改变。

大陆三网、手机 Safari、微信、锁屏媒体控制、真实 GCS/IAM、真实云端账单及证书续期需要部署后验证；本地测试不能代替这些验收。公开联系地址还需你提供，当前页面明确说明未配置。

GCS 桶保持私有；访客媒体通过 2 分钟短期签名 URL 直读，避免音频经过 VM。下架先停止签发新 URL，再删除云端 published 副本；已下载或已缓冲内容无法收回。草稿和原始文件位于 private 前缀。应用端限流不能限制已经获得签名 URL 的每一次存储请求，仍需预算告警和流量监测。

## 备份

`npm run backup` 使用 SQLite 在线备份 API；本地保留 30 天，GCS 上传到 `backups/`。恢复到一个不存在的新目录：

```powershell
node scripts/restore.mjs data/backups/你的备份.sqlite data-restored
```

恢复元数据不复制本地媒体；开发环境需另备份 `data/private/`，生产媒体在 GCS 中。上线恢复时停止服务，检查 `DATA_DIR`、管理员会话、GCS 文件和作品发布状态后切换；不要直接覆盖正在使用的数据库。

内嵌封面自动提取并生成网站封面；简介采用音频流码率和声道，文件日期标签不推断为发行或生成日期。草稿列表可复选、全选，批量发布按现有发布检查逐首执行并保留失败项；批量删除需确认，仅删除未发布且未正在上传或处理的草稿及其媒体文件，排队草稿先取消排队再删除，并移除歌单引用。

音频按真实容器和编码校验，单曲上传支持 MP3、M4A（AAC／ALAC）、PCM WAV、FLAC、Ogg（Vorbis／Opus）及 AAC；批量标签导入仍为 MP3／M4A。原格式能否播放取决于听众浏览器，优先使用 MP3 或 AAC 编码的 M4A。GCS 中每首仅保存一份私有原始音频，发布不复制文件，下架停止签发新播放链接；之前签发的链接最多仍有效 2 分钟。旧作品可在备份后运行 scripts/migrate-original-audio.mjs，校验原文件、更新格式并待旧链接过期后清理旧副本。桶的软删除保留期内，删除的副本仍可能计费。
