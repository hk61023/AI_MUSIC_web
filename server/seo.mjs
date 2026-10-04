export const escapeHtml = (s) =>
  String(s || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function trackHtml(template, t, origin) {
  const title = escapeHtml(`${t.title} · 听屿`),
    description = escapeHtml(t.description),
    url = escapeHtml(`${origin}/tracks/${t.id}`);
  const image = t.hasCover
    ? `${origin}/media/${t.id}/cover`
    : `${origin}/covers/${t.artwork || "violet"}.svg`;
  const meta = `<meta property="og:type" content="music.song"/><meta property="og:title" content="${title}"/><meta property="og:description" content="${description}"/><meta property="og:url" content="${url}"/><meta property="og:image" content="${escapeHtml(image)}"/><link rel="canonical" href="${url}"/>`;
  return template
    .replace(/<title>.*?<\/title>/s, () => `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"[^>]*>/,
      () => `<meta name="description" content="${description}"/>`,
    )
    .replace("</head>", () => `${meta}</head>`)
    .replace(
      '<div id="root"></div>',
      () =>
        `<div id="root"><main><h1>${escapeHtml(t.title)}</h1><p>${description}</p><p>生成来源：${escapeHtml(t.source)} · ${escapeHtml(t.licenseText)}</p><p>${escapeHtml(t.story)}</p><a href="/">返回听屿音乐馆</a></main></div>`,
    );
}
