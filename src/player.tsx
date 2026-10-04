import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  ListMusic,
  ChevronDown,
  Heart,
  X,
  Music2,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  api,
  readLocal,
  writeLocal,
  time,
  artworkUrl,
  type Track,
} from "./types";
type Mode = "sequence" | "shuffle" | "repeat";
type Saved = {
  queue: string[];
  index: number;
  position: number;
  volume: number;
  mode: Mode;
};
type PlayerState = {
  current?: Track;
  playing: boolean;
  queue: Track[];
  play: (t: Track, list?: Track[]) => void;
  toggle: () => void;
  favoriteIds: string[];
  favorite: (id: string) => void;
  add: (t: Track) => void;
  notice: string;
  notify: (s: string) => void;
};
const Context = createContext<PlayerState>(null!);
export const usePlayer = () => useContext(Context);
export function PlayerProvider({
  tracks,
  children,
}: {
  tracks: Track[];
  children: ReactNode;
}) {
  const [saved] = useState(() =>
    readLocal<Saved>("tingyu.player.v1", {
      queue: [],
      index: 0,
      position: 0,
      volume: 0.8,
      mode: "sequence",
    }),
  );
  const [ids, setIds] = useState<string[]>(
      Array.isArray(saved.queue) ? saved.queue : [],
    ),
    [index, setIndex] = useState(saved.index || 0);
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(
      Number.isFinite(Number(saved.volume))
        ? Math.max(0, Math.min(1, Number(saved.volume)))
        : 0.8,
    ),
    [mode, setMode] = useState<Mode>(
      ["sequence", "shuffle", "repeat"].includes(saved.mode)
        ? saved.mode
        : "sequence",
    );
  const [error, setError] = useState(""),
    [expanded, setExpanded] = useState(false),
    [queueOpen, setQueueOpen] = useState(false),
    [notice, setNotice] = useState("");
  const [favoriteIds, setFavorites] = useState<string[]>(() => {
    const v = readLocal<unknown>("tingyu.favorites.v1", []);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  });
  const audio = useRef<HTMLAudioElement>(null),
    shouldPlay = useRef(false),
    restore = useRef(saved.position || 0),
    playId = useRef(crypto.randomUUID()),
    started = useRef(false),
    engaged = useRef(false),
    saveAt = useRef(0),
    listened = useRef(0),
    lastTime = useRef(0);
  const queue = ids
    .map((id) => tracks.find((t) => t.id === id))
    .filter((t): t is Track => Boolean(t));
  const current = tracks.find((t) => t.id === ids[index]);
  const notify = (s: string) => setNotice(s);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    writeLocal("tingyu.favorites.v1", favoriteIds);
  }, [favoriteIds]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  const persist = () =>
    writeLocal("tingyu.player.v1", {
      queue: ids,
      index,
      position: audio.current?.currentTime || 0,
      volume,
      mode,
    });
  useEffect(() => {
    persist();
  }, [ids, index, volume, mode]);
  useEffect(() => {
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [ids, index, volume, mode]);
  const event = (kind: string) => {
    if (current)
      void api("/api/events", {
        method: "POST",
        body: JSON.stringify({
          trackId: current.id,
          playId: playId.current,
          kind,
        }),
      }).catch(() => {});
  };
  const start = () => {
    if (!audio.current) return;
    const element = audio.current;
    const source = element.src;
    if (element.ended) {
      started.current = false;
      engaged.current = false;
      listened.current = 0;
      lastTime.current = 0;
      playId.current = crypto.randomUUID();
    }
    setError("");
    shouldPlay.current = true;
    void element.play().catch((error: DOMException) => {
      if (element.src !== source || error.name === "AbortError") return;
      setError("暂时无法播放，点击重试或检查网络");
      setPlaying(false);
      shouldPlay.current = false;
    });
  };
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    element.pause();
    setPosition(0);
    setDuration(current?.duration || 0);
    setError("");
    setPlaying(false);
    started.current = false;
    engaged.current = false;
    listened.current = 0;
    lastTime.current = 0;
    playId.current = crypto.randomUUID();
    if (current) {
      element.src = `/media/${current.id}/audio?v=${current.mediaVersion || 0}`;
      element.load();
      if (shouldPlay.current) start();
    } else {
      element.removeAttribute("src");
      element.load();
      shouldPlay.current = false;
    }
  }, [current?.id, current?.mediaVersion]);
  const play = (t: Track, list: Track[] = tracks) => {
    if (t.id === current?.id) {
      restore.current = 0;
      start();
      return;
    }
    shouldPlay.current = true;
    restore.current = 0;
    const next = list.some((x) => x.id === t.id) ? list : [t];
    setIds(next.map((x) => x.id));
    setIndex(next.findIndex((x) => x.id === t.id));
  };
  const toggle = () => {
    if (!current) {
      if (tracks[0]) play(tracks[0]);
      return;
    }
    if (playing) {
      audio.current?.pause();
      shouldPlay.current = false;
    } else start();
  };
  const skip = (step: number, automatic = false) => {
    if (!queue.length) return;
    if (mode === "repeat" && automatic) {
      audio.current!.currentTime = 0;
      started.current = false;
      engaged.current = false;
      listened.current = 0;
      lastTime.current = 0;
      playId.current = crypto.randomUUID();
      start();
      return;
    }
    const available = ids
      .map((id, i) => (tracks.some((t) => t.id === id) ? i : -1))
      .filter((i) => i >= 0);
    const at = available.indexOf(index);
    let next = available[(at + step + available.length) % available.length];
    if (mode === "shuffle" && step > 0 && available.length > 1) {
      const choices = available.filter((i) => i !== index);
      next = choices[Math.floor(Math.random() * choices.length)];
    }
    if (automatic && mode === "sequence" && at === available.length - 1) {
      shouldPlay.current = false;
      setPlaying(false);
      return;
    }
    shouldPlay.current = true;
    restore.current = 0;
    if (next === index) {
      audio.current!.currentTime = 0;
      playId.current = crypto.randomUUID();
      started.current = false;
      engaged.current = false;
      listened.current = 0;
      lastTime.current = 0;
      start();
    } else setIndex(next);
  };
  const favorite = (id: string) =>
    setFavorites((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  const seek = (n: number) => {
    if (audio.current && Number.isFinite(n)) {
      audio.current.currentTime = n;
      lastTime.current = n;
      setPosition(n);
      persist();
    }
  };
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!current) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: "听屿 · AI 音乐馆",
      artwork: [
        {
          src: new URL(artworkUrl(current), location.origin).href,
          sizes: "1000x1000",
        },
      ],
    });
    for (const [name, fn] of Object.entries({
      play: start,
      pause: () => audio.current?.pause(),
      previoustrack: () => skip(-1),
      nexttrack: () => skip(1),
      seekto: (d: MediaSessionActionDetails) => seek(d.seekTime || 0),
    })) {
      try {
        navigator.mediaSession.setActionHandler(name as MediaSessionAction, fn);
      } catch {
        /* Unsupported browser action. */
      }
    }
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [current?.id, playing, mode, ids, index]);
  return (
    <Context.Provider
      value={{
        current,
        playing,
        queue,
        play,
        toggle,
        favoriteIds,
        favorite,
        add: (t) => {
          setIds((old) => (old.includes(t.id) ? old : [...old, t.id]));
          notify("已加入播放队列");
        },
        notice,
        notify,
      }}
    >
      {children}
      <audio
        ref={audio}
        preload="metadata"
        onLoadedMetadata={() => {
          const a = audio.current!;
          setDuration(a.duration);
          if (restore.current > 0) {
            a.currentTime = Math.min(
              restore.current,
              Math.max(0, a.duration - 0.1),
            );
            lastTime.current = a.currentTime;
            setPosition(a.currentTime);
            restore.current = 0;
          }
        }}
        onPlaying={() => {
          setPlaying(true);
          setError("");
          if (!started.current) {
            event("start");
            started.current = true;
          }
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          const a = audio.current!;
          setPosition(a.currentTime);
          const delta = a.currentTime - lastTime.current;
          if (!a.paused && delta > 0 && delta < 2) listened.current += delta;
          lastTime.current = a.currentTime;
          if (
            started.current &&
            !engaged.current &&
            listened.current >= Math.min(30, a.duration / 2)
          ) {
            engaged.current = true;
            event("engaged");
          }
          if (Date.now() - saveAt.current > 2000) {
            persist();
            saveAt.current = Date.now();
          }
        }}
        onEnded={() => {
          event("complete");
          skip(1, true);
        }}
        onError={() => {
          if (current) {
            setPlaying(false);
            setError("音频无法加载，点击重试");
            event("error");
          }
        }}
      />
      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}
      {queueOpen ? (
        <div className="queue-panel">
          <header>
            <h3>
              接下来播放 <small>{queue.length} 首</small>
            </h3>
            <button aria-label="关闭队列" onClick={() => setQueueOpen(false)}>
              <X size={18} />
            </button>
          </header>
          {queue.length ? (
            queue.map((t) => (
              <button
                key={t.id}
                className={
                  t.id === current?.id ? "queue-item active" : "queue-item"
                }
                onClick={() => play(t, queue)}
              >
                <img src={artworkUrl(t)} alt="" />
                <span>
                  {t.title}
                  <small>{t.genre}</small>
                </span>
                <span>{time(t.duration)}</span>
              </button>
            ))
          ) : (
            <p>挑选一首音乐，开启聆听。</p>
          )}
        </div>
      ) : null}
      <footer className={`player ${expanded ? "expanded" : ""}`}>
        <button
          className="player-track"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "收起播放器" : "展开播放器"}
        >
          {current ? (
            <img src={artworkUrl(current)} alt="" />
          ) : (
            <div className="player-placeholder">
              <Music2 size={25} />
            </div>
          )}
          <span>
            <strong>{current?.title || "让声音，陪你片刻"}</strong>
            <small>
              {current
                ? `${current.genre} · ${current.source}`
                : "选择一首音乐开始聆听"}
            </small>
          </span>
        </button>
        <button
          className={`favorite-player ${current && favoriteIds.includes(current.id) ? "selected" : ""}`}
          aria-label="收藏当前作品"
          disabled={!current}
          onClick={() => current && favorite(current.id)}
        >
          <Heart size={18} />
        </button>
        <div className="player-center">
          <div className="transport">
            <button
              className={mode === "shuffle" ? "selected" : ""}
              title="随机播放"
              aria-label="随机播放"
              onClick={() =>
                setMode(mode === "shuffle" ? "sequence" : "shuffle")
              }
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="上一首"
              disabled={!current}
              onClick={() => skip(-1)}
            >
              <SkipBack size={19} />
            </button>
            <button
              className="play-main"
              aria-label={playing ? "暂停" : "播放"}
              onClick={toggle}
            >
              {playing ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <button
              aria-label="下一首"
              disabled={!current}
              onClick={() => skip(1)}
            >
              <SkipForward size={19} />
            </button>
            <button
              className={mode === "repeat" ? "selected" : ""}
              title="单曲循环"
              aria-label="单曲循环"
              onClick={() => setMode(mode === "repeat" ? "sequence" : "repeat")}
            >
              <Repeat size={17} />
            </button>
          </div>
          <div className="progress">
            <span>{time(position)}</span>
            <input
              aria-label="播放进度"
              type="range"
              min="0"
              max={Number.isFinite(duration) ? duration : 0}
              step=".1"
              value={position}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span>{time(duration)}</span>
          </div>
        </div>
        <div className="player-right">
          <Volume2 size={18} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <button
            aria-label="播放队列"
            onClick={() => setQueueOpen(!queueOpen)}
          >
            <ListMusic size={21} />
          </button>
        </div>
        {error ? (
          <div className="player-error" role="alert">
            {error}
            <button
              onClick={() => {
                audio.current?.load();
                start();
              }}
            >
              重试
            </button>
          </div>
        ) : null}
        {expanded ? (
          <>
            <button
              className="player-collapse"
              aria-label="收起播放器"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown />
            </button>
            {current ? (
              <Link
                className="player-detail-link"
                to={`/tracks/${current.id}`}
                onClick={() => setExpanded(false)}
              >
                查看作品详情 →
              </Link>
            ) : null}
            <button
              className="mobile-queue"
              onClick={() => setQueueOpen(!queueOpen)}
            >
              播放队列 · {queue.length} 首
            </button>
          </>
        ) : null}
      </footer>
    </Context.Provider>
  );
}
