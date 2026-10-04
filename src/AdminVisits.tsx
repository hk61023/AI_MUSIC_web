import { useEffect, useState } from "react";
import { api } from "./types";
type Row = {
  ip: string;
  count: number;
  duration: number;
  seen: number;
  event_at: number;
  latest_duration: number;
  event: string;
  path: string;
  geo: { location: string; isp: string } | null;
  geo_at: number | null;
};
type Stats = {
  rows: Row[];
  total: number;
  page: number;
  summary: { ips: number; visits: number; duration: number };
};
const elapsed = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 3600)} 时 ${Math.floor((seconds % 3600) / 60)} 分 ${seconds % 60} 秒`;
};
const events: Record<string, string> = {
  page_view: "浏览页面",
  heartbeat: "停留",
  leave: "离开页面",
  play: "开始播放",
  pause: "暂停播放",
};
export default function AdminVisits() {
  const [data, setData] = useState<Stats | null>(null),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api<Stats>(
        `/api/admin/visits?page=${page}&search=${encodeURIComponent(search)}`,
      )
        .then((r) => {
          if (active) {
            setData(r);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [page, search]);
  async function lookup(ip: string) {
    setBusy(ip);
    setError("");
    try {
      const geo = await api<Row["geo"]>("/api/admin/visits/lookup", {
        method: "POST",
        body: JSON.stringify({ ip }),
      });
      setData((d) =>
        d
          ? {
              ...d,
              rows: d.rows.map((r) =>
                r.ip === ip ? { ...r, geo, geo_at: Date.now() } : r,
              ),
            }
          : d,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="visit-panel">
      <h2>访问统计</h2>
      <p className="muted">
        每次打开或刷新网站计一次访问，站内切换页面不重复计数。累计时间包括可见页面停留与后台播放；IP
        不代表独立用户。每 15 秒更新，异常断网可能遗漏最后一段时间。
      </p>
      {data && (
        <div className="stat-grid">
          <div>
            <strong>{data.summary.ips}</strong>
            <span>累计 IP</span>
          </div>
          <div>
            <strong>{data.summary.visits}</strong>
            <span>累计访问次数</span>
          </div>
          <div>
            <strong>{elapsed(data.summary.duration)}</strong>
            <span>累计访问时间</span>
          </div>
        </div>
      )}
      <label>
        搜索 IP 或已查询的归属
        <input
          aria-label="搜索访问 IP"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          maxLength={100}
        />
      </label>
      <p className="muted">
        点击归属查询会将该 IP 发送给 ipwho.is，结果缓存 7
        天，归属仅供参考。访问明细保留 90 天，IP
        汇总累计保留。后台自身访问不计入。
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="visits-table">
        {data?.rows.map((r) => (
          <article className="visit-row" key={r.ip}>
            <div>
              <strong>{r.ip}</strong>
              <p>{r.geo?.location || "尚未查询归属"}</p>
              <small>{r.geo?.isp}</small>
              <button
                className="secondary"
                disabled={!!busy}
                onClick={() => void lookup(r.ip)}
              >
                {busy === r.ip ? "查询中…" : "查询归属"}
              </button>
            </div>
            <div>
              <small>累计次数 / 累计时间</small>
              <p>{r.count} 次</p>
              <p>{elapsed(r.duration)}</p>
            </div>
            <div>
              <small>最近一次访问事件</small>
              <p>{new Date(r.event_at || r.seen).toLocaleString("zh-CN")}</p>
              <p>
                {events[r.event] || r.event} · {r.path}
              </p>
            </div>
            <div>
              <small>最近一次访问持续时间</small>
              <p>{elapsed(r.latest_duration)}</p>
            </div>
          </article>
        ))}
      </div>
      {data && !data.rows.length && (
        <p>暂无匹配的访问记录。统计从本功能上线后开始累计。</p>
      )}
      <div className="visit-pagination">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          上一页
        </button>
        <span>
          第 {page} 页 · 共 {data?.total || 0} 个 IP
        </span>
        <button
          disabled={!data || page * 50 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
