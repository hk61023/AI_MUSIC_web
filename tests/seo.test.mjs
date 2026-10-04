import { test } from "node:test";
import assert from "node:assert/strict";
import { trackHtml } from "../server/seo.mjs";
test("作品预生成兼容多行 meta，转义 HTML 并保留美元字符", () => {
  const t = {
    id: "stable-id",
    title: "$& <月光>",
    description: '"><script>bad</script>',
    source: "MusicFX",
    licenseText: "待确认",
    story: "故事 & 灵感",
    artwork: "violet",
    hasCover: false,
  };
  const html = trackHtml(
    '<html><head><title>旧标题</title><meta\n name="description" content="旧简介"/></head><body><div id="root"></div></body></html>',
    t,
    "https://example.test",
  );
  assert.match(html, /<title>\$&amp; &lt;月光&gt; · 听屿<\/title>/);
  assert.ok(!html.includes("<script>bad</script>"));
  assert.ok(!html.includes("旧简介"));
  assert.match(html, /og:url/);
  assert.match(html, /canonical/);
  assert.match(html, /<h1>/);
});
