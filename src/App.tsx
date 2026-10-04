import { lazy, Suspense, useEffect, useState } from "react";
import {
  NavLink,
  Link,
  Routes,
  Route,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  AudioLines,
  Compass,
  Music2,
  Library,
  Heart,
  ArrowUpRight,
  ArrowRight,
  Play,
  Pause,
  Search,
  Plus,
  Download,
  Share2,
  ChevronRight,
  Headphones,
  SlidersHorizontal,
  Menu,
  X,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  artworkUrl,
  time,
  type Catalog,
  type Track,
  type Playlist,
} from "./types";
import { PlayerProvider, usePlayer } from "./player";
import VisitTracker from "./VisitTracker";
const Admin = lazy(() => import("./Admin"));
const nav = [
  ["/", "发现音乐", Compass],
  ["/music", "全部音乐", Music2],
  ["/playlists", "精选歌单", Library],
  ["/favorites", "我的收藏", Heart],
] as const;
export default function App() {
  const [catalog, setCatalog] = useState<Catalog>({
      tracks: [],
      playlists: [],
    }),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const load = () =>
    api<Catalog>("/api/catalog")
      .then((c) => {
        setCatalog(c);
        setError("");
        setLoaded(true);
      })
      .catch((e) => {
        setError(e.message);
        setLoaded(true);
      });
  useEffect(() => {
    void load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);
  return (
    <PlayerProvider tracks={catalog.tracks}>
      <VisitTracker />
      <Shell>
        {error ? (
          <div className="banner" role="alert">
            {error}
            <button onClick={() => void load()}>重新连接</button>
          </div>
        ) : null}
        <Routes>
          <Route
            path="/"
            element={<Home catalog={catalog} loaded={loaded} />}
          />
          <Route
            path="/music"
            element={<Music tracks={catalog.tracks} loaded={loaded} />}
          />
          <Route
            path="/favorites"
            element={
              <Music tracks={catalog.tracks} loaded={loaded} favorites />
            }
          />
          <Route path="/playlists" element={<Playlists catalog={catalog} />} />
          <Route
            path="/playlists/:id"
            element={<PlaylistPage catalog={catalog} />}
          />
          <Route
            path="/tracks/:id"
            element={<Detail tracks={catalog.tracks} loaded={loaded} />}
          />
          <Route path="/about" element={<About />} />
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<Empty text="正在加载管理后台…" />}>
                <Admin refresh={() => void load()} />
              </Suspense>
            }
          />
          <Route path="*" element={<Empty text="这个页面还没有声音。" />} />
        </Routes>
      </Shell>
    </PlayerProvider>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false),
    location = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#content">
        跳转到内容
      </a>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link className="brand" to="/">
          <span className="brand-mark">
            <AudioLines size={27} />
          </span>
          <span>
            听屿<small>TINGYU MUSIC</small>
          </span>
        </Link>
        <p className="nav-label">你的音乐岛屿</p>
        <nav>
          {nav.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === "/"}>
              <Icon size={20} />
              {label}
              <span className="nav-dot" />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-orbit">✦</span>
          <h3>灵感没有边界</h3>
          <p>
            由想象出发
            <br />与 AI 一起，创造声音。
          </p>
          <Link to="/about">
            关于听屿 <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <span className="live-dot" />
          独立 AI 音乐馆
          <Link to="/admin" aria-label="管理后台">
            <SlidersHorizontal size={17} />
          </Link>
        </div>
      </aside>
      {open ? (
        <button
          className="sidebar-overlay"
          aria-label="关闭导航"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label={open ? "关闭导航" : "打开导航"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </button>
          <span className="breadcrumb">
            听屿 <ChevronRight size={13} />{" "}
            {location.pathname === "/admin" ? "创作管理" : "发现属于你的声音"}
          </span>
          <div>
            <span className="top-tag">
              <span />
              AI CREATED, HUMAN CURATED
            </span>
            <Link className="about-link" to="/about">
              关于 <ArrowUpRight size={14} />
            </Link>
          </div>
        </header>
        <main id="content" className="content">
          {children}
          <footer className="site-footer">
            <span>听屿 · 让每一种灵感，都有回声。</span>
            <Link to="/about">
              AI 创作与使用说明 <ArrowUpRight size={12} />
            </Link>
          </footer>
        </main>
      </div>
    </>
  );
}
function Home({ catalog, loaded }: { catalog: Catalog; loaded: boolean }) {
  const { play, current, playing, toggle } = usePlayer();
  const featured = catalog.tracks.find((t) => t.featured) || catalog.tracks[0];
  return (
    <>
      <div className="page-intro">
        <span className="eyebrow">DISCOVER YOUR NEXT SOUND</span>
        <h1>
          好音乐，<span>自有回响。</span>
        </h1>
        <p>在声音里寻找灵感，在听屿遇见此刻的心情。</p>
      </div>
      <section className="hero">
        <div className="hero-art">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hero-sphere" />
          <span className="art-coordinate">SOUND EXPLORATION / VOL. 01</span>
          <span className="art-spark">✧</span>
          <span className="art-caption">
            A place
            <br />
            to drift.
          </span>
        </div>
        <div className="hero-copy">
          <div className="hero-label">
            <span />
            本周精选 <span className="hero-rule" />
          </div>
          <h2>{featured?.title || "把此刻，交给音乐。"}</h2>
          <p>
            {featured?.description ||
              "从一段灵感开始，听见想象的形状。你的第一首作品，即将在这里响起。"}
          </p>
          <div className="hero-tags">
            <span>{featured?.genre || "灵感探索"}</span>
            <span>{featured?.mood || "自由聆听"}</span>
            <span>{featured ? time(featured.duration) : "等待作品"}</span>
          </div>
          <div className="hero-actions">
            <button
              className="primary"
              disabled={!featured}
              onClick={() =>
                featured &&
                (current?.id === featured.id
                  ? toggle()
                  : play(featured, catalog.tracks))
              }
            >
              {featured && current?.id === featured.id && playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              立即聆听
            </button>
            {featured ? (
              <Link to={`/tracks/${featured.id}`} className="hero-more">
                探索作品 <ArrowUpRight size={17} />
              </Link>
            ) : (
              <Link to="/admin" className="hero-more">
                上传第一首作品 <ArrowUpRight size={17} />
              </Link>
            )}
          </div>
          <small className="hero-source">
            {featured
              ? `${featured.source} · ${featured.source === "本地合成样例" ? "播放器演示音频" : "AI 生成作品"}`
              : "灵感由你，声音由 AI 共创"}
          </small>
        </div>
        <div className="hero-counter">
          01 <span>/ FEATURED</span>
        </div>
      </section>
      <SectionHeader
        title="为此刻，选一种心情"
        subtitle="CURATED COLLECTIONS"
        to="/playlists"
        label="全部歌单"
      />
      <div className="playlist-grid">
        {catalog.playlists.slice(0, 4).map((p, i) => (
          <PlaylistCard key={p.id} p={p} index={i} tracks={catalog.tracks} />
        ))}
        {!catalog.playlists.length ? (
          <Empty text="你的场景歌单将在这里呈现。" />
        ) : null}
      </div>
      <SectionHeader
        title="新鲜上岛"
        subtitle="FRESH ARRIVALS"
        to="/music"
        label="全部音乐"
      />
      {!loaded ? (
        <Empty text="正在寻找好声音…" />
      ) : catalog.tracks.length ? (
        <div className="track-grid">
          {catalog.tracks.slice(0, 6).map((t) => (
            <TrackCard key={t.id} t={t} list={catalog.tracks} />
          ))}
        </div>
      ) : (
        <Empty text="还没有发布作品，去管理后台上传你的第一首音乐。" />
      )}
      <div className="manifesto">
        <AudioLines size={29} />
        <div>
          <h3>AI 创造声音，人类赋予意义。</h3>
          <p>这里的每一首作品，都从一个真实的灵感开始。</p>
        </div>
        <Link to="/about">
          了解我们的创作 <ArrowUpRight size={19} />
        </Link>
      </div>
    </>
  );
}
function SectionHeader({
  title,
  subtitle,
  to,
  label,
}: {
  title: string;
  subtitle: string;
  to: string;
  label: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{subtitle}</span>
        <h2>{title}</h2>
      </div>
      <Link to={to}>
        {label}
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
function PlaylistCard({
  p,
  index,
  tracks,
}: {
  p: Playlist;
  index: number;
  tracks: Track[];
}) {
  const { play } = usePlayer(),
    list = p.trackIds
      .map((id) => tracks.find((t) => t.id === id))
      .filter((t): t is Track => !!t);
  return (
    <article className={`playlist-card palette-${p.artwork}`}>
      <span className="playlist-number">0{index + 1} / COLLECTION</span>
      <Link to={`/playlists/${p.id}`}>
        <div className="playlist-symbol">{["◌", "✦", "≈", "◐"][index % 4]}</div>
        <h3>{p.title}</h3>
        <p>{p.description}</p>
      </Link>
      <footer>
        <span>{list.length} 首精选</span>
        <button
          aria-label={`播放歌单 ${p.title}`}
          disabled={!list.length}
          onClick={() => play(list[0], list)}
        >
          <Play size={16} fill="currentColor" />
        </button>
      </footer>
    </article>
  );
}
function TrackCard({ t, list }: { t: Track; list: Track[] }) {
  const { play, current, playing, toggle, favorite, favoriteIds } = usePlayer();
  return (
    <article className="track-card">
      <div className="cover-wrap">
        <Link to={`/tracks/${t.id}`}>
          <img src={artworkUrl(t)} alt={`${t.title} 封面`} loading="lazy" />
        </Link>
        <span className="cover-badge">
          {t.source === "本地合成样例" ? "试听样例" : "AI MUSIC"}
        </span>
        <button
          className="cover-play"
          aria-label={`播放 ${t.title}`}
          onClick={() => (current?.id === t.id ? toggle() : play(t, list))}
        >
          {current?.id === t.id && playing ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>
      </div>
      <div className="track-card-copy">
        <Link to={`/tracks/${t.id}`}>
          <h3>{t.title}</h3>
        </Link>
        <button
          aria-label={`收藏 ${t.title}`}
          className={favoriteIds.includes(t.id) ? "selected" : ""}
          onClick={() => favorite(t.id)}
        >
          <Heart size={17} />
        </button>
      </div>
      <p>
        {t.genre} <span>·</span> {t.mood}
        <small>{time(t.duration)}</small>
      </p>
    </article>
  );
}
function Music({
  tracks,
  loaded,
  favorites = false,
}: {
  tracks: Track[];
  loaded: boolean;
  favorites?: boolean;
}) {
  const { favoriteIds } = usePlayer();
  const [query, setQuery] = useState(""),
    [genre, setGenre] = useState(""),
    [mood, setMood] = useState(""),
    [vocal, setVocal] = useState("");
  const base = favorites
    ? tracks.filter((t) => favoriteIds.includes(t.id))
    : tracks;
  const filtered = base.filter(
    (t) =>
      (!query ||
        `${t.title} ${t.description} ${t.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!genre || t.genre === genre) &&
      (!mood || t.mood === mood) &&
      (!vocal || t.vocal === vocal),
  );
  return (
    <>
      <PageTitle
        eyebrow={favorites ? "YOUR PERSONAL COLLECTION" : "EXPLORE THE LIBRARY"}
        title={favorites ? "我的收藏" : "全部音乐"}
        description={
          favorites
            ? "你喜欢的声音，都在这里。收藏仅保存在当前浏览器，不会跨设备同步。"
            : "每一种情绪，都能找到自己的旋律。"
        }
      />
      <div className="filters">
        <label className="search">
          <Search size={18} />
          <input
            aria-label="搜索音乐"
            placeholder="搜索音乐、灵感或标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="音乐风格"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        >
          <option value="">全部风格</option>
          {[...new Set(base.map((t) => t.genre))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select
          aria-label="音乐情绪"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
        >
          <option value="">全部情绪</option>
          {[...new Set(base.map((t) => t.mood))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <select
          aria-label="人声类型"
          value={vocal}
          onChange={(e) => setVocal(e.target.value)}
        >
          <option value="">全部类型</option>
          <option value="instrumental">纯音乐</option>
          <option value="vocal">人声</option>
        </select>
      </div>
      <div className="list-heading">
        <span>{filtered.length} 首作品</span>
        <span>按最新发布排序</span>
      </div>
      {!loaded ? (
        <Empty text="正在加载音乐…" />
      ) : filtered.length ? (
        <TrackRows tracks={filtered} />
      ) : (
        <Empty
          text={
            favorites
              ? "还没有收藏，听到喜欢的作品时点一下爱心。"
              : "没有找到匹配的音乐，换个关键词试试。"
          }
        />
      )}
    </>
  );
}
function TrackRows({ tracks }: { tracks: Track[] }) {
  const { play, current, playing, toggle, favoriteIds, favorite, add } =
    usePlayer();
  return (
    <div className="track-list">
      <div className="track-row row-header">
        <span>#</span>
        <span>作品</span>
        <span>风格 / 情绪</span>
        <span>时长</span>
        <span />
      </div>
      {tracks.map((t, i) => (
        <div
          key={t.id}
          className={`track-row ${current?.id === t.id ? "is-current" : ""}`}
        >
          <button
            className="row-index"
            aria-label={`播放 ${t.title}`}
            onClick={() => (current?.id === t.id ? toggle() : play(t, tracks))}
          >
            {current?.id === t.id && playing ? (
              <AudioLines size={16} />
            ) : (
              <>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <Play size={15} />
              </>
            )}
          </button>
          <Link className="row-title" to={`/tracks/${t.id}`}>
            <img src={artworkUrl(t)} alt="" />
            <span>
              <strong>{t.title}</strong>
              <small>{t.source}</small>
            </span>
          </Link>
          <span className="row-tags">
            {t.genre}
            <small>{t.mood}</small>
          </span>
          <span className="row-duration">{time(t.duration)}</span>
          <div className="row-actions">
            <button
              aria-label={`收藏 ${t.title}`}
              className={favoriteIds.includes(t.id) ? "selected" : ""}
              onClick={() => favorite(t.id)}
            >
              <Heart size={17} />
            </button>
            <button aria-label={`加入队列 ${t.title}`} onClick={() => add(t)}>
              <Plus size={18} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
function Playlists({ catalog }: { catalog: Catalog }) {
  return (
    <>
      <PageTitle
        eyebrow="CURATED COLLECTIONS"
        title="精选歌单"
        description="为生活的每一个片刻，准备一段恰好的声音。"
      />
      <div className="playlist-grid">
        {catalog.playlists.map((p, i) => (
          <PlaylistCard key={p.id} p={p} index={i} tracks={catalog.tracks} />
        ))}
      </div>
      {!catalog.playlists.length ? <Empty text="歌单正在准备中。" /> : null}
    </>
  );
}
function PlaylistPage({ catalog }: { catalog: Catalog }) {
  const { id } = useParams(),
    { play } = usePlayer();
  const p = catalog.playlists.find((p) => p.id === id);
  if (!p) return <Empty text="歌单不存在或正在加载。" />;
  const tracks = p.trackIds
    .map((id) => catalog.tracks.find((t) => t.id === id))
    .filter((t): t is Track => !!t);
  return (
    <>
      <div className="collection-hero">
        <img src={`/covers/${p.artwork}.svg`} alt="" />
        <div>
          <span className="eyebrow">
            CURATED PLAYLIST · {tracks.length} TRACKS
          </span>
          <h1>{p.title}</h1>
          <p>{p.description}</p>
          <button
            className="primary"
            disabled={!tracks.length}
            onClick={() => play(tracks[0], tracks)}
          >
            <Play size={17} fill="currentColor" />
            播放全部
          </button>
        </div>
      </div>
      <TrackRows tracks={tracks} />
    </>
  );
}
function Detail({ tracks, loaded }: { tracks: Track[]; loaded: boolean }) {
  const { id } = useParams(),
    { play, current, playing, toggle, favorite, favoriteIds, notify } =
      usePlayer();
  const t = tracks.find((t) => t.id === id);
  useEffect(() => {
    if (t) document.title = `${t.title} · 听屿`;
    return () => {
      document.title = "听屿 · AI 音乐馆";
    };
  }, [t?.title]);
  if (!t)
    return <Empty text={loaded ? "作品不存在或已下架。" : "正在加载作品…"} />;
  const share = async () => {
    const url = `${location.origin}/tracks/${t.id}`;
    try {
      if (navigator.share) await navigator.share({ title: t.title, url });
      else {
        await navigator.clipboard.writeText(url);
        notify("作品链接已复制");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        notify("复制失败，请复制浏览器地址栏中的链接");
    }
  };
  const download = async () => {
    try {
      const latest = await api<Track>(`/api/tracks/${t.id}`);
      if (!latest.downloadAllowed || !latest.rightsConfirmed)
        throw new Error("该作品尚未开放下载");
      window.location.assign(`/api/tracks/${t.id}/download`);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  return (
    <>
      <Link className="back-link" to="/music">
        ← 返回曲库
      </Link>
      <div className="collection-hero detail-hero">
        <img src={artworkUrl(t)} alt={`${t.title} 封面`} />
        <div>
          <span className="eyebrow">
            {t.source === "本地合成样例" ? "LOCAL DEMO" : "AI ORIGINAL"} ·{" "}
            {t.source}
          </span>
          <h1>{t.title}</h1>
          <p>{t.description}</p>
          <div className="detail-tags">
            {[
              t.genre,
              t.mood,
              t.vocal === "vocal" ? "人声" : "纯音乐",
              time(t.duration),
            ].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <div className="detail-actions">
            <button
              className="primary"
              onClick={() =>
                current?.id === t.id ? toggle() : play(t, tracks)
              }
            >
              {current?.id === t.id && playing ? (
                <Pause size={16} />
              ) : (
                <Play size={16} fill="currentColor" />
              )}
              聆听作品
            </button>
            <button
              className={`secondary ${favoriteIds.includes(t.id) ? "selected" : ""}`}
              onClick={() => favorite(t.id)}
            >
              <Heart size={17} />
              收藏
            </button>
            <button className="secondary" onClick={() => void share()}>
              <Share2 size={17} />
              分享
            </button>
          </div>
        </div>
      </div>
      <div className="detail-columns">
        <div>
          <section className="text-panel">
            <span className="eyebrow">BEHIND THE SOUND</span>
            <h2>创作故事</h2>
            <p className="preserve-lines">
              {t.story || "这一段声音，等待你赋予自己的故事。"}
            </p>
            {t.tags.length ? (
              <div className="detail-tags">
                {t.tags.map((x) => (
                  <span key={x}>#{x}</span>
                ))}
              </div>
            ) : null}
          </section>
          {t.lyrics ? (
            <section className="text-panel">
              <h2>歌词</h2>
              <p className="preserve-lines">{t.lyrics}</p>
            </section>
          ) : null}
          {t.prompt ? (
            <details className="text-panel">
              <summary>创作提示词</summary>
              <p className="preserve-lines">{t.prompt}</p>
            </details>
          ) : null}
        </div>
        <aside className="text-panel license-panel">
          <ShieldCheck size={23} />
          <h3>下载与使用</h3>
          <p>
            {t.licenseText || "使用范围以本作品说明为准，尚未确认下载许可。"}
          </p>
          <button
            className="secondary"
            disabled={!t.downloadAllowed || !t.rightsConfirmed}
            onClick={() => void download()}
          >
            <Download size={17} />
            {t.downloadAllowed && t.rightsConfirmed
              ? "下载 MP3"
              : "暂未开放下载"}
          </button>
          <small>
            来源：{t.source}
            <br />
            生成日期：{t.generatedAt || "未记录"}
            <br />
            AI 生成作品不代表自动获得商业授权。
          </small>
        </aside>
      </div>
    </>
  );
}
function About() {
  return (
    <>
      <PageTitle
        eyebrow="A HUMAN IDEA, AN AI ECHO"
        title="每一种灵感，都有回声。"
        description="听屿是一座独立的 AI 音乐馆，收藏想象与声音相遇的瞬间。"
      />
      <div className="about-art">
        <AudioLines size={70} />
        <span>
          HUMAN CURATED.
          <br />
          AI CREATED.
        </span>
      </div>
      <div className="about-grid">
        <section className="text-panel">
          <h2>关于听屿</h2>
          <p>
            我们用文字描述一种心情，让 AI
            将灵感转化为声音，再通过人的选择与编排，分享值得停留的旋律。听屿与
            Google 没有官方隶属或合作关系。
          </p>
          <h2>关于作品</h2>
          <p>
            每首作品标明实际生成来源。站内“本地合成样例”仅用于测试播放器，不是
            MusicFX 或 Flow Music 的生成结果。正式作品将由创作者审核后发布。
          </p>
        </section>
        <section className="text-panel">
          <h2>使用说明</h2>
          <p>
            可以免费浏览和试听。下载权限以每首作品详情页为准；下载不等于取得商业使用、转售或再授权许可。封面、歌词和其他素材也需独立确认使用权利。
          </p>
          <h2>隐私与反馈</h2>
          <p>
            收藏与播放进度保存在当前设备的浏览器。网站记录
            IP、访问页面、有效停留时间及播放和下载事件，用于访问统计与改善体验。访问明细保留
            90 天，按 IP 汇总的次数和时长累计保留；IP
            不代表独立个人。管理员主动查询归属时，该 IP 会发送给
            ipwho.is，结果缓存 7
            天。不要求听众注册账号。若需反馈，请联系分享本站的创作者；公开联系地址尚未配置。
          </p>
        </section>
      </div>
    </>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-intro">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <Headphones size={29} />
      <p>{text}</p>
      <Link to="/music">
        探索音乐 <ArrowRight size={14} />
      </Link>
    </div>
  );
}
