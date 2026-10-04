import { useEffect, useRef, useState } from "react";
import { type Track, time } from "./types";
const statuses = {
  empty: "待上传",
  queued: "排队中",
  processing: "处理中",
  ready: "可预览",
  failed: "处理失败",
};
type Props = {
  tracks: Track[];
  published: boolean;
  locked: boolean;
  batchIds: string[];
  batchOnly: boolean;
  onBatchOnly: (value: boolean) => void;
  checked: string[];
  onChecked: (ids: string[]) => void;
  onEdit: (track: Track, preview?: boolean) => void;
  onPublish: () => void;
  onDelete: () => void;
  onFeatured: (track: Track) => void;
  onUnpublish: (track: Track) => void;
};
export default function AdminWorks(p: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const checkAll = useRef<HTMLInputElement>(null);
  const all = p.tracks.filter(
    (t) => t.status === (p.published ? "published" : "draft"),
  );
  const batchDrafts = all.filter((t) => p.batchIds.includes(t.id));
  const query = search.trim().toLocaleLowerCase();
  const filtered = all
    .filter(
      (t) =>
        (p.published || !p.batchOnly || p.batchIds.includes(t.id)) &&
        (!status || t.processing === status) &&
        (!query ||
          [t.title, t.description, t.originalName || "", ...t.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages);
  const rows = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  const checkedOnPage = rows.filter((t) => p.checked.includes(t.id)).length;
  useEffect(() => {
    setPage((old) => Math.min(old, pages));
  }, [pages]);
  useEffect(() => {
    setPage(1);
    if (p.batchOnly) {
      setSearch("");
      setStatus("");
    }
  }, [p.batchOnly, p.batchIds[0]]);
  useEffect(() => {
    if (checkAll.current)
      checkAll.current.indeterminate =
        checkedOnPage > 0 && checkedOnPage < rows.length;
  }, [checkedOnPage, rows.length]);
  const changeFilter = () => {
    setPage(1);
    p.onChecked([]);
  };
  return (
    <section
      className="works-section"
      aria-label={p.published ? "已发布作品列表" : "草稿列表"}
    >
      <div className="works-filters">
        <label className="works-search">
          搜索作品
          <input
            aria-label="搜索后台作品"
            placeholder="标题、简介、标签或原文件名"
            value={search}
            disabled={p.locked}
            onChange={(e) => {
              setSearch(e.target.value);
              changeFilter();
            }}
          />
        </label>
        {!p.published && (
          <>
            <label>
              处理状态
              <select
                aria-label="筛选处理状态"
                value={status}
                disabled={p.locked}
                onChange={(e) => {
                  setStatus(e.target.value);
                  changeFilter();
                }}
              >
                <option value="">全部状态</option>
                {Object.entries(statuses).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="works-scope" aria-label="草稿范围">
              <button
                className={!p.batchOnly ? "active" : ""}
                disabled={p.locked}
                aria-pressed={!p.batchOnly}
                onClick={() => {
                  p.onBatchOnly(false);
                  changeFilter();
                }}
              >
                全部草稿
              </button>
              <button
                className={p.batchOnly ? "active" : ""}
                disabled={p.locked || !p.batchIds.length}
                aria-pressed={p.batchOnly}
                onClick={() => {
                  p.onBatchOnly(true);
                  changeFilter();
                }}
              >
                本次导入
              </button>
            </div>
          </>
        )}
      </div>
      <div className="works-summary">
        <span>
          共 {filtered.length} 首{p.published ? "已发布作品" : "草稿"}
        </span>
        {!p.published && (
          <label className="check-label">
            <input
              ref={checkAll}
              type="checkbox"
              aria-label="选择本页"
              disabled={p.locked || !rows.length}
              checked={rows.length > 0 && checkedOnPage === rows.length}
              onChange={(e) =>
                p.onChecked(
                  e.target.checked
                    ? [...new Set([...p.checked, ...rows.map((t) => t.id)])]
                    : p.checked.filter((id) => !rows.some((t) => t.id === id)),
                )
              }
            />
            选择本页
          </label>
        )}
      </div>
      <div className="works-rows">
        {rows.map((t) => (
          <article
            className={`work-row ${p.published ? "published-row" : ""}`}
            key={t.id}
            aria-label={`作品 ${t.title}`}
          >
            {!p.published && (
              <input
                type="checkbox"
                aria-label={`选择作品 ${t.title}`}
                disabled={p.locked}
                checked={p.checked.includes(t.id)}
                onChange={(e) =>
                  p.onChecked(
                    e.target.checked
                      ? [...new Set([...p.checked, t.id])]
                      : p.checked.filter((id) => id !== t.id),
                  )
                }
              />
            )}
            <img
              className="work-cover"
              alt=""
              loading="lazy"
              src={
                t.hasCover
                  ? `/api/admin/tracks/${t.id}/preview/cover?v=${t.mediaVersion || 0}`
                  : `/covers/${t.artwork || "violet"}.svg`
              }
            />
            <div className="work-title">
              <strong>{t.title}</strong>
              <small>
                {t.genre || "未设置风格"}
                {t.tags.length ? ` · ${t.tags.join(" / ")}` : ""}
              </small>
              {t.processing === "failed" && t.processingError && (
                <small className="form-error">{t.processingError}</small>
              )}
            </div>
            <span className="work-duration">{time(t.duration)}</span>
            <span className={`status-pill ${p.published ? "published" : ""}`}>
              {p.published
                ? t.featured
                  ? "精选作品"
                  : "已发布"
                : statuses[t.processing]}
            </span>
            <time className="work-date" dateTime={t.createdAt}>
              导入：{new Date(t.createdAt).toLocaleDateString("zh-CN")}
            </time>
            <div className="work-actions">
              <button
                className="secondary"
                disabled={p.locked}
                aria-label={`编辑 ${t.title}`}
                onClick={() => p.onEdit(t)}
              >
                编辑
              </button>
              {p.published && (
                <>
                  <button
                    className="secondary"
                    disabled={p.locked}
                    aria-label={`预览 ${t.title}`}
                    onClick={() => p.onEdit(t, true)}
                  >
                    预览
                  </button>
                  <button
                    className="secondary"
                    disabled={p.locked}
                    aria-label={`${t.featured ? "取消精选" : "设为精选"} ${t.title}`}
                    onClick={() => p.onFeatured(t)}
                  >
                    {t.featured ? "取消精选" : "设为精选"}
                  </button>
                  <button
                    className="secondary danger"
                    disabled={p.locked}
                    aria-label={`下架 ${t.title}`}
                    onClick={() => p.onUnpublish(t)}
                  >
                    下架
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
        {!rows.length && (
          <div className="works-empty">
            {!p.published &&
            p.batchOnly &&
            p.batchIds.length &&
            !batchDrafts.length ? (
              <>
                <p>本批次草稿已全部发布或删除。</p>
                <button
                  className="secondary"
                  disabled={p.locked}
                  onClick={() => {
                    p.onBatchOnly(false);
                    changeFilter();
                  }}
                >
                  查看全部草稿
                </button>
              </>
            ) : (
              <p>
                {query || status
                  ? "没有符合筛选条件的作品。"
                  : p.published
                    ? "还没有已发布作品。"
                    : "还没有草稿，开始导入你的音乐吧。"}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="works-pagination">
        <button
          className="secondary"
          disabled={p.locked || currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}
        >
          上一页
        </button>
        <span>
          第 {currentPage} / {pages} 页 · 每页 50 首
        </span>
        <button
          className="secondary"
          disabled={p.locked || currentPage >= pages}
          onClick={() => setPage(currentPage + 1)}
        >
          下一页
        </button>
      </div>
      {!p.published && p.checked.length > 0 && (
        <div className="works-bulkbar" aria-label="草稿批量操作">
          <strong>已选 {p.checked.length} 首</strong>
          <button className="primary" disabled={p.locked} onClick={p.onPublish}>
            批量发布（{p.checked.length}）
          </button>
          <button
            className="secondary danger"
            disabled={p.locked}
            onClick={p.onDelete}
          >
            批量删除草稿（{p.checked.length}）
          </button>
          <button
            className="secondary"
            disabled={p.locked}
            onClick={() => p.onChecked([])}
          >
            取消选择
          </button>
        </div>
      )}
    </section>
  );
}
