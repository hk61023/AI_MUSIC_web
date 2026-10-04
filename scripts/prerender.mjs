import { readFile, writeFile, mkdir } from "node:fs/promises";
import { allTracks } from "../server/db.mjs";
import { trackHtml, escapeHtml } from "../server/seo.mjs";
const template = await readFile("dist/index.html", "utf8"),
  origin = process.env.SITE_ORIGIN || "http://localhost:8787";
const tracks = allTracks().filter((t) => t.status === "published");
for (const t of tracks) {
  const dir = `dist/tracks/${t.id}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/index.html`, trackHtml(template, t, origin));
}
await writeFile(
  "dist/robots.txt",
  `User-agent: *\nDisallow: /admin\nDisallow: /api/admin\nSitemap: ${origin}/sitemap.xml\n`,
);
await writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["", "/music", "/playlists", "/about", ...tracks.map((t) => `/tracks/${t.id}`)].map((p) => `<url><loc>${escapeHtml(origin + p)}</loc></url>`).join("")}</urlset>`,
);
console.log(
  `已预生成 ${tracks.length} 个作品页；运行时会核验发布状态并更新元信息。`,
);
