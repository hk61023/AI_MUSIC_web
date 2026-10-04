import { isIP } from "node:net";
import { z } from "zod";
import { db } from "./db.mjs";
const schema = z.object({
  id: z.uuid(),
  duration: z.number().int().min(0).max(604800000),
  event: z.enum(["page_view", "heartbeat", "leave", "play", "pause"]),
  path: z.string().max(200).startsWith("/"),
});
export function recordVisit(raw, ip, now = Date.now()) {
  const data = schema.parse(raw);
  ip = ip?.replace(/^::ffff:/, "");
  if (!isIP(ip || "") || /^\/admin(?:\/|$)/.test(data.path)) return;
  const cleanPath = data.path.split(/[?#]/)[0];
  const old = db.prepare("SELECT * FROM visits WHERE id=?").get(data.id);
  if (old && old.ip !== ip) return;
  if (old && data.duration < old.reported) return;
  if (old && now - old.seen > 1800000) return; // Expired visit IDs cannot resurrect deleted history.
  const delta = old
    ? Math.max(
        0,
        Math.min(data.duration - old.reported, now - old.seen + 1000, 30000),
      )
    : 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!old) {
      db.prepare("INSERT INTO visits(id,ip,started,seen) VALUES(?,?,?,?)").run(
        data.id,
        ip,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO visitors(ip,count,duration,seen,latest_id,latest_duration,event,path) VALUES(?,1,0,?,?,0,?,?) ON CONFLICT(ip) DO UPDATE SET count=count+1,seen=excluded.seen,latest_id=excluded.latest_id,latest_duration=0,event=excluded.event,path=excluded.path`,
      ).run(ip, now, data.id, data.event, cleanPath);
    } else {
      db.prepare(
        "UPDATE visits SET seen=?,duration=duration+?,reported=MAX(reported,?) WHERE id=?",
      ).run(now, delta, data.duration, data.id);
      db.prepare(
        `UPDATE visitors SET duration=duration+?,seen=MAX(seen,?),latest_duration=CASE WHEN latest_id=? THEN ? ELSE latest_duration END,event=CASE WHEN latest_id=? AND ?!='heartbeat' THEN ? ELSE event END,path=CASE WHEN latest_id=? AND ?!='heartbeat' THEN ? ELSE path END WHERE ip=?`,
      ).run(
        delta,
        now,
        data.id,
        old.duration + delta,
        data.id,
        data.event,
        data.event,
        data.id,
        data.event,
        cleanPath,
        ip,
      );
    }
    if (!old || (data.event !== "heartbeat" && data.duration >= old.reported)) {
      db.prepare(
        "UPDATE visitors SET event_at=? WHERE ip=? AND latest_id=?",
      ).run(now, ip, data.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function visitStats(query) {
  const search = String(query.search || "").slice(0, 100),
    page = Math.max(1, Math.min(100000, parseInt(query.page) || 1));
  const filter = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const where = "WHERE ip LIKE ? ESCAPE '\\' OR geo LIKE ? ESCAPE '\\'";
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM visitors ${where}`)
    .get(filter, filter).n;
  const rows = db
    .prepare(
      `SELECT * FROM visitors ${where} ORDER BY seen DESC LIMIT 50 OFFSET ?`,
    )
    .all(filter, filter, (page - 1) * 50)
    .map((r) => ({ ...r, geo: r.geo ? JSON.parse(r.geo) : null }));
  const summary = db
    .prepare(
      "SELECT COUNT(*) AS ips,COALESCE(SUM(count),0) AS visits,COALESCE(SUM(duration),0) AS duration FROM visitors",
    )
    .get();
  return { rows, total, page, summary };
}
function publicIP(ip) {
  if (!isIP(ip)) return false;
  if (isIP(ip) === 6) return !/^(::|fc|fd|fe[89ab]|ff|2001:db8)/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
const pending = new Map();
export async function lookupIP(ip) {
  const row = db.prepare("SELECT geo,geo_at FROM visitors WHERE ip=?").get(ip);
  if (!row) throw new Error("该 IP 暂无访问记录");
  if (row.geo && Date.now() - row.geo_at < 7 * 86400000)
    return JSON.parse(row.geo);
  if (pending.has(ip)) return pending.get(ip);
  const request = (async () => {
    let geo;
    if (!publicIP(ip)) geo = { location: "本地或保留地址", isp: "" };
    else {
      const response = await fetch(
        `https://ipwho.is/${encodeURIComponent(ip)}`,
        { signal: AbortSignal.timeout(5000), redirect: "error" },
      );
      if (!response.ok) throw new Error("归属查询服务暂不可用，请稍后重试");
      const data = await response.json();
      if (!data.success) throw new Error("归属查询失败，请稍后重试");
      geo = {
        location: [data.country, data.region, data.city]
          .filter(Boolean)
          .map((x) => String(x).slice(0, 100))
          .join(" / "),
        isp: String(data.connection?.isp || "").slice(0, 150),
      };
    }
    db.prepare("UPDATE visitors SET geo=?,geo_at=? WHERE ip=?").run(
      JSON.stringify(geo),
      Date.now(),
      ip,
    );
    return geo;
  })();
  pending.set(ip, request);
  try {
    return await request;
  } finally {
    pending.delete(ip);
  }
}
