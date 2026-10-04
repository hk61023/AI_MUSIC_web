import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Upload,
  LogOut,
  Check,
  RotateCcw,
  Eye,
  Save,
  ShieldCheck,
  Music2,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { api, type Track, type Catalog, type Playlist, time } from "./types";
type Editable = Pick<
  Track,
  | "title"
  | "description"
  | "story"
  | "genre"
  | "mood"
  | "vocal"
  | "source"
  | "generatedAt"
  | "tags"
  | "lyrics"
  | "prompt"
  | "featured"
  | "downloadAllowed"
  | "rightsConfirmed"
  | "licenseText"
> & { rightsEvidence: string };
const blank: Editable = {
  title: "",
  description: "",
  story: "",
  genre: "氛围",
  mood: "放松",
  vocal: "instrumental",
  source: "MusicFX",
  generatedAt: new Date().toISOString().slice(0, 10),
  tags: [],
  lyrics: "",
  prompt: "",
  featured: false,
  downloadAllowed: false,
  rightsConfirmed: false,
  rightsEvidence: "",
  licenseText: "",
};
const edit = (t: Track): Editable =>
  Object.fromEntries(
    Object.keys(blank).map((k) => [
      k,
      t[k as keyof Track] ?? blank[k as keyof Editable],
    ]),
  ) as Editable;
const statuses = {
  empty: "待上传",
  queued: "排队处理",
  processing: "处理中",
  ready: "可预览",
  failed: "处理失败",
};
export default function Admin({ refresh }: { refresh: () => void }) {
  const [session, setSession] = useState<{
      authenticated: boolean;
      configured: boolean;
    } | null>(null),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({
      tracks: [],
      playlists: [],
    }),
    [selected, setSelected] = useState<string | null>(null),
    [form, setForm] = useState<Editable>(blank),
    [audio, setAudio] = useState<File | null>(null),
    [cover, setCover] = useState<File | null>(null),
    [uploadKey, setUploadKey] = useState(0),
    [stats, setStats] = useState<{ counts: { kind: string; count: number }[] }>(
      { counts: [] },
    ),
    [tab, setTab] = useState("tracks");
  const [listId, setListId] = useState(""),
    [list, setList] = useState<Omit<Playlist, "id">>({
      title: "",
      description: "",
      artwork: "violet",
      trackIds: [],
    });
  type ImportRow = {
    file: File;
    importId: string;
    state: "waiting" | "uploading" | "done" | "failed";
    id?: string;
    detail?: string;
  };
  const [imports, setImports] = useState<ImportRow[]>([]);
  const stopImport = useRef(false);
  const [importing, setImporting] = useState(false);
  const importFiles = async () => {
    stopImport.current = false;
    setImporting(true);
    setError("");
    setMessage("");
    try {
      for (let i = 0; i < imports.length; i++) {
        if (stopImport.current) break;
        if (imports[i].state === "done") continue;
        const row = imports[i];
        setImports((old) =>
          old.map((r, j) =>
            j === i ? { ...r, state: "uploading", detail: "" } : r,
          ),
        );
        try {
          const body = new FormData();
          body.append("audio", row.file);
          const track = await api<Track>("/api/admin/import-audio", {
            method: "POST",
            body,
            headers: { "X-Import-ID": row.importId },
          });
          setImports((old) =>
            old.map((r, j) =>
              j === i
                ? {
                    ...r,
                    state: "done",
                    id: track.id,
                    detail:
                      track.processing === "failed"
                        ? "草稿已创建，请在编辑页重新上传"
                        : `已创建草稿：${track.title}`,
                  }
                : r,
            ),
          );
        } catch (e) {
          setImports((old) =>
            old.map((r, j) =>
              j === i
                ? { ...r, state: "failed", detail: (e as Error).message }
                : r,
            ),
          );
        }
      }
      await load();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  const load = async () => {
    const [c, s] = await Promise.all([
      api<Catalog>("/api/admin/catalog"),
      api<typeof stats>("/api/admin/stats"),
    ]);
    setCatalog(c);
    setStats(s);
  };
  useEffect(() => {
    void api<typeof session>("/api/admin/session")
      .then(setSession)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    void load().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void load().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, [session?.authenticated]);
  const run = async (action: () => Promise<void>, success = "已保存") => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      if (session?.authenticated) {
        await load();
        refresh();
      }
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!session)
    return (
      <section className="admin-login">
        <h1>创作管理</h1>
        <p>{error || "正在连接管理后台…"}</p>
      </section>
    );
  if (!session.authenticated)
    return (
      <section className="admin-login">
        <ShieldCheck size={30} />
        <span className="eyebrow">CREATOR SPACE</span>
        <h1>欢迎回到听屿。</h1>
        <p>登录后管理作品、歌单与发布状态。</p>
        {!session.configured ? (
          <div className="banner">
            管理员尚未初始化。在项目终端运行 <code>npm run admin:set</code>{" "}
            设置密码。
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api("/api/admin/login", {
                method: "POST",
                body: JSON.stringify({ password }),
              });
              setPassword("");
              setSession({ authenticated: true, configured: true });
            }, "登录成功");
          }}
        >
          <label>
            管理员密码
            <input
              aria-label="管理员密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={256}
            />
          </label>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <button className="primary" disabled={busy || !session.configured}>
            进入管理后台 →
          </button>
        </form>
      </section>
    );
  const current = catalog.tracks.find((t) => t.id === selected);
  const choose = (t?: Track) => {
    setSelected(t?.id || null);
    setForm(t ? edit(t) : { ...blank });
    setAudio(null);
    setCover(null);
    setUploadKey((x) => x + 1);
    setError("");
    setMessage("");
  };
  const field = <K extends keyof Editable>(key: K, value: Editable[K]) =>
    setForm((old) => ({ ...old, [key]: value }));
  const save = async () => {
    const t = await api<Track>(
      selected ? `/api/admin/tracks/${selected}` : "/api/admin/tracks",
      { method: selected ? "PUT" : "POST", body: JSON.stringify(form) },
    );
    setSelected(t.id);
    return t;
  };
  const upload = () =>
    run(async () => {
      if (!audio) throw new Error("请选择音频文件");
      const t = await save();
      const body = new FormData();
      body.append("audio", audio);
      if (cover) body.append("cover", cover);
      await api(`/api/admin/tracks/${t.id}/upload`, { method: "POST", body });
      setAudio(null);
      setCover(null);
      setUploadKey((x) => x + 1);
    }, "上传完成，正在处理音频。完成后请先预览再发布。");
  const setListFrom = (p?: Playlist) => {
    setListId(p?.id || "");
    setList(
      p
        ? {
            title: p.title,
            description: p.description,
            artwork: p.artwork,
            trackIds: p.trackIds,
          }
        : { title: "", description: "", artwork: "violet", trackIds: [] },
    );
  };
  const move = (i: number, step: number) =>
    setList((old) => {
      const arr = [...old.trackIds];
      const at = i + step;
      if (at >= 0 && at < arr.length) [arr[i], arr[at]] = [arr[at], arr[i]];
      return { ...old, trackIds: arr };
    });
  return (
    <>
      <div className="admin-heading">
        <div>
          <span className="eyebrow">CREATOR SPACE</span>
          <h1>创作管理</h1>
          <p>让灵感上岛，让好声音被听见。</p>
        </div>
        <button
          className="secondary"
          disabled={busy || importing}
          onClick={() =>
            void run(async () => {
              await api("/api/admin/logout", { method: "POST" });
              setSession({ authenticated: false, configured: true });
            }, "已退出")
          }
        >
          <LogOut size={16} />
          退出
        </button>
      </div>
      <div className="stat-grid">
        {[
          ["start", "播放开始"],
          ["engaged", "有效收听"],
          ["complete", "完整播放"],
          ["download", "下载请求"],
          ["error", "播放错误"],
        ].map(([kind, label]) => (
          <div key={kind}>
            <span>{label}</span>
            <strong>
              {stats.counts.find((x) => x.kind === kind)?.count || 0}
            </strong>
            <small>最近 90 天</small>
          </div>
        ))}
      </div>
      <div className="admin-tabs">
        <button
          className={tab === "tracks" ? "active" : ""}
          onClick={() => setTab("tracks")}
        >
          作品管理
        </button>
        <button
          className={tab === "lists" ? "active" : ""}
          onClick={() => setTab("lists")}
        >
          歌单管理
        </button>
      </div>
      {tab === "tracks" && (
        <section
          className="batch-import upload-panel"
          aria-label="批量导入 MP3／M4A"
        >
          <h2>批量导入 MP3／M4A</h2>
          <p>
            读取文件内的标题、艺术家、专辑、发行时间、风格、备注和歌词，自动填写草稿。没有标题标签时使用文件名。
          </p>
          <p>
            每批最多 50 首，每首最多 100 MB、20
            分钟。导入后请核对生成来源、人声类型和许可，再预览发布。
          </p>
          <label>
            选择多个 MP3／M4A 文件
            <input
              type="file"
              accept=".mp3,.m4a,audio/mpeg,audio/mp4"
              multiple
              disabled={busy || importing}
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                if (
                  files.length > 50 ||
                  files.some(
                    (f) =>
                      !/\.(mp3|m4a)$/i.test(f.name) ||
                      f.size > 100 * 1024 * 1024,
                  )
                ) {
                  setError("请选择最多 50 个 MP3／M4A 文件，每个不超过 100 MB");
                  e.target.value = "";
                  return;
                }
                setError("");
                setImports(
                  files.map((file) => ({
                    file,
                    importId: crypto.randomUUID(),
                    state: "waiting",
                  })),
                );
              }}
            />
          </label>
          <div className="editor-actions">
            <button
              className="primary"
              disabled={
                busy || importing || !imports.some((r) => r.state !== "done")
              }
              onClick={() => void importFiles()}
            >
              <Upload size={16} />
              {imports.some((r) => r.state === "failed")
                ? "重试失败／继续导入"
                : "开始批量导入"}
            </button>
            {importing && (
              <button
                className="secondary"
                onClick={() => {
                  stopImport.current = true;
                }}
              >
                当前文件完成后停止
              </button>
            )}
            <span role={imports.length ? "status" : undefined}>
              已导入 {imports.filter((r) => r.state === "done").length} /{" "}
              {imports.length} 首
            </span>
          </div>
          {imports.length > 0 && (
            <ul className="import-results">
              {imports.map((r, i) => (
                <li key={i}>
                  <span>{r.file.name}</span>
                  <span>
                    {
                      {
                        waiting: "等待上传",
                        uploading: "正在上传并读取",
                        done: "已导入",
                        failed: "导入失败",
                      }[r.state]
                    }
                  </span>
                  {r.detail && <small>{r.detail}</small>}
                  {r.id && (
                    <button
                      className="secondary"
                      disabled={importing}
                      onClick={() =>
                        choose(catalog.tracks.find((t) => t.id === r.id))
                      }
                    >
                      编辑草稿
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {error ? (
        <div className="banner form-error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="banner success" role="status">
          <Check size={17} />
          {message}
        </div>
      ) : null}
      {tab === "tracks" ? (
        <div className="admin-layout">
          <aside className="admin-track-list">
            <button className="secondary" onClick={() => choose()}>
              <Plus size={16} />
              新建作品
            </button>
            {catalog.tracks.map((t) => (
              <button
                key={t.id}
                className={selected === t.id ? "active" : ""}
                onClick={() => choose(t)}
              >
                <Music2 size={18} />
                <span>
                  {t.title}
                  <small>
                    {t.status === "published" ? "已发布" : "草稿"} ·{" "}
                    {statuses[t.processing]}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          <section className="editor">
            <header>
              <h2>{current ? "编辑作品" : "新建作品"}</h2>
              <span
                className={`status-pill ${current?.status === "published" ? "published" : ""}`}
              >
                {current?.status === "published" ? "已发布" : "草稿"}
              </span>
            </header>
            <div className="form-grid">
              <label className="wide">
                作品名称
                <input
                  aria-label="作品名称"
                  value={form.title}
                  maxLength={100}
                  onChange={(e) => field("title", e.target.value)}
                  required
                />
              </label>
              <label className="wide">
                作品简介
                <textarea
                  value={form.description}
                  maxLength={500}
                  onChange={(e) => field("description", e.target.value)}
                />
              </label>
              <label>
                风格
                <input
                  value={form.genre}
                  maxLength={40}
                  onChange={(e) => field("genre", e.target.value)}
                />
              </label>
              <label>
                情绪
                <input
                  value={form.mood}
                  maxLength={40}
                  onChange={(e) => field("mood", e.target.value)}
                />
              </label>
              <label>
                生成工具
                <select
                  value={form.source}
                  onChange={(e) => field("source", e.target.value)}
                >
                  {["MusicFX", "Flow Music", "其他", "本地合成样例"].map(
                    (x) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
              </label>
              <label>
                生成日期
                <input
                  type="date"
                  value={form.generatedAt}
                  onChange={(e) => field("generatedAt", e.target.value)}
                />
              </label>
              <label>
                类型
                <select
                  value={form.vocal}
                  onChange={(e) =>
                    field("vocal", e.target.value as Editable["vocal"])
                  }
                >
                  <option value="instrumental">纯音乐</option>
                  <option value="vocal">人声</option>
                </select>
              </label>
              <label>
                标签（逗号分隔）
                <input
                  value={form.tags.join(",")}
                  onChange={(e) =>
                    field(
                      "tags",
                      e.target.value.split(/[,，]/).map((x) => x.trim()),
                    )
                  }
                />
              </label>
              <label className="wide">
                创作故事
                <textarea
                  value={form.story}
                  onChange={(e) => field("story", e.target.value)}
                />
              </label>
              <details className="wide">
                <summary>歌词与提示词（可选）</summary>
                <label>
                  歌词
                  <textarea
                    value={form.lyrics}
                    onChange={(e) => field("lyrics", e.target.value)}
                  />
                </label>
                <label>
                  提示词
                  <textarea
                    value={form.prompt}
                    onChange={(e) => field("prompt", e.target.value)}
                  />
                </label>
              </details>
              <label className="check-label wide">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => field("featured", e.target.checked)}
                />
                设为首页精选
              </label>
            </div>
            <div className="upload-panel">
              <h3>
                <Upload size={18} />
                音频与封面
              </h3>
              <p>
                音频最多 100 MB、20 分钟。会转换为 192 kbps MP3
                并调整响度；请在发布前试听检查。
              </p>
              <div key={uploadKey} className="form-grid">
                <label>
                  音频文件
                  <input
                    aria-label="音频文件"
                    type="file"
                    accept=".mp3,.wav,.flac,.m4a,.ogg,.aac"
                    disabled={
                      busy ||
                      current?.status === "published" ||
                      ["queued", "processing"].includes(
                        current?.processing || "",
                      )
                    }
                    onChange={(e) => setAudio(e.target.files?.[0] || null)}
                  />
                </label>
                <label>
                  封面（可选）
                  <input
                    aria-label="封面文件"
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp"
                    disabled={busy || current?.status === "published"}
                    onChange={(e) => setCover(e.target.files?.[0] || null)}
                  />
                </label>
              </div>
              <button
                className="secondary"
                disabled={busy || !audio || current?.status === "published"}
                onClick={() => void upload()}
              >
                <Upload size={16} />
                上传并处理
              </button>
              {current ? (
                <p>
                  处理状态：{statuses[current.processing]}{" "}
                  {current.duration ? `· ${time(current.duration)}` : ""}
                </p>
              ) : null}
              {current?.processingError ? (
                <p className="form-error">{current.processingError}</p>
              ) : null}
              {current?.processing === "failed" ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/admin/tracks/${current.id}/retry`, {
                        method: "POST",
                      });
                    }, "已重新排队")
                  }
                >
                  <RotateCcw size={16} />
                  重试处理
                </button>
              ) : null}
              {current?.processing === "ready" ? (
                <div className="preview">
                  <h4>
                    <Eye size={16} />
                    发布前预览
                  </h4>
                  {current.hasCover ? (
                    <img
                      src={`/api/admin/tracks/${current.id}/preview/cover?v=${current.mediaVersion || 0}`}
                      alt="封面预览"
                    />
                  ) : null}
                  <audio
                    key={
                      current.id + (current.mediaVersion || current.duration)
                    }
                    controls
                    preload="none"
                    src={`/api/admin/tracks/${current.id}/preview/audio?v=${current.mediaVersion || 0}`}
                  />
                </div>
              ) : null}
            </div>
            <div className="license-editor">
              <h3>
                <ShieldCheck size={18} />
                下载许可
              </h3>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.rightsConfirmed}
                  onChange={(e) => field("rightsConfirmed", e.target.checked)}
                />
                已确认生成工具条款及封面、歌词等素材权利
              </label>
              <label>
                许可依据（仅后台可见）
                <textarea
                  value={form.rightsEvidence}
                  placeholder="记录适用条款链接、核实日期及素材来源"
                  onChange={(e) => field("rightsEvidence", e.target.value)}
                />
              </label>
              <label>
                访客可见的使用说明
                <textarea
                  value={form.licenseText}
                  placeholder="请明确允许的使用范围；不要默认宣称可商用或无版权"
                  onChange={(e) => field("licenseText", e.target.value)}
                />
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.downloadAllowed}
                  onChange={(e) => field("downloadAllowed", e.target.checked)}
                />
                开放 MP3 下载
              </label>
            </div>
            <div className="editor-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await save();
                  })
                }
              >
                <Save size={16} />
                保存{current?.status === "published" ? "修改" : "草稿"}
              </button>
              {current?.status === "published" ? (
                <button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/admin/tracks/${current.id}/unpublish`, {
                        method: "POST",
                      });
                    }, "已下架，新的播放与下载请求已关闭")
                  }
                >
                  下架作品
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={busy || current?.processing !== "ready"}
                  onClick={() =>
                    void run(async () => {
                      const t = await save();
                      await api(`/api/admin/tracks/${t.id}/publish`, {
                        method: "POST",
                      });
                    }, "作品已发布")
                  }
                >
                  <Check size={16} />
                  发布作品
                </button>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="admin-layout">
          <aside className="admin-track-list">
            <button className="secondary" onClick={() => setListFrom()}>
              <Plus size={16} />
              新建歌单
            </button>
            {catalog.playlists.map((p) => (
              <button
                className={listId === p.id ? "active" : ""}
                key={p.id}
                onClick={() => setListFrom(p)}
              >
                {p.title}
                <small>{p.trackIds.length} 首作品</small>
              </button>
            ))}
          </aside>
          <section className="editor">
            <h2>{listId ? "编辑歌单" : "新建歌单"}</h2>
            <label>
              歌单名称
              <input
                aria-label="歌单名称"
                value={list.title}
                onChange={(e) => setList({ ...list, title: e.target.value })}
              />
            </label>
            <label>
              介绍
              <textarea
                value={list.description}
                onChange={(e) =>
                  setList({ ...list, description: e.target.value })
                }
              />
            </label>
            <label>
              封面风格
              <select
                value={list.artwork}
                onChange={(e) => setList({ ...list, artwork: e.target.value })}
              >
                {["violet", "amber", "aqua", "rose", "blue", "sage"].map(
                  (x) => (
                    <option key={x}>{x}</option>
                  ),
                )}
              </select>
            </label>
            <h3>添加作品</h3>
            {catalog.tracks.map((t) => (
              <label className="check-label" key={t.id}>
                <input
                  type="checkbox"
                  checked={list.trackIds.includes(t.id)}
                  onChange={(e) =>
                    setList({
                      ...list,
                      trackIds: e.target.checked
                        ? [...list.trackIds, t.id]
                        : list.trackIds.filter((id) => id !== t.id),
                    })
                  }
                />
                {t.title} {t.status === "draft" ? "（草稿，访客不可见）" : ""}
              </label>
            ))}
            <h3>播放顺序</h3>
            {list.trackIds.map((id, i) => (
              <div className="playlist-order" key={id}>
                <span>
                  {i + 1}.{" "}
                  {catalog.tracks.find((t) => t.id === id)?.title ||
                    "已移除作品"}
                </span>
                <button
                  aria-label="上移"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label="下移"
                  onClick={() => move(i, 1)}
                  disabled={i === list.trackIds.length - 1}
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            ))}
            <div className="editor-actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const p = await api<Playlist>(
                      listId
                        ? `/api/admin/playlists/${listId}`
                        : "/api/admin/playlists",
                      {
                        method: listId ? "PUT" : "POST",
                        body: JSON.stringify(list),
                      },
                    );
                    setListId(p.id);
                  })
                }
              >
                <Save size={16} />
                保存歌单
              </button>
              {listId ? (
                <button
                  className="secondary danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/admin/playlists/${listId}`, {
                        method: "DELETE",
                      });
                      setListFrom();
                    }, "歌单已删除")
                  }
                >
                  <Trash2 size={16} />
                  删除歌单
                </button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
