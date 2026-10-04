import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";

test("批量导入 MP3 和 M4A，坏文件隔离并可编辑标签草稿", async ({ page }) => {
  mkdirSync("artifacts", { recursive: true });
  const dir = mkdtempSync(path.resolve("artifacts/browser-import-"));
  const files = [
    { name: "batch.mp3", title: "批量 MP3 标签", codec: "libmp3lame" },
    { name: "batch.m4a", title: "批量 M4A 标签", codec: "aac" },
  ].map((item) => {
    const filename = path.join(dir, item.name);
    const result = spawnSync(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=2",
        "-c:a",
        item.codec,
        "-metadata",
        `title=${item.title}`,
        "-metadata",
        "artist=批量艺术家",
        "-metadata",
        "album=测试专辑",
        filename,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    return {
      name: item.name,
      mimeType: item.name.endsWith(".m4a") ? "audio/mp4" : "audio/mpeg",
      buffer: readFileSync(filename),
    };
  });
  await page.goto("/admin");
  await page
    .getByRole("textbox", { name: "管理员密码" })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  const panel = page.getByRole("region", { name: "批量导入 MP3／M4A" });
  await panel.getByLabel("选择多个 MP3／M4A 文件").setInputFiles([
    {
      name: "broken.mp3",
      mimeType: "audio/mpeg",
      buffer: Buffer.from("invalid"),
    },
    ...files,
  ]);
  await panel.getByRole("button", { name: "开始批量导入" }).click();
  await expect(panel.getByRole("status")).toHaveText("已导入 2 / 3 首");
  await expect(panel.getByText("导入失败", { exact: true })).toBeVisible();
  await expect(
    panel.getByText("已创建草稿：批量 M4A 标签", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "编辑草稿" }).first().click();
  await expect(page.getByRole("textbox", { name: "作品名称" })).toHaveValue(
    "批量 MP3 标签",
  );
  await expect(page.getByRole("textbox", { name: "作品简介" })).toHaveValue(
    /批量艺术家/,
  );
  await expect
    .poll(async () => {
      const catalog = await (
        await page.request.get("/api/admin/catalog")
      ).json();
      return catalog.tracks.filter(
        (t: { title: string; processing: string }) =>
          t.title.startsWith("批量 ") && t.processing === "ready",
      ).length;
    })
    .toBe(2);
  await page
    .getByRole("checkbox", { name: "选择作品 批量 MP3 标签", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "选择作品 批量 M4A 标签", exact: true })
    .check();
  await page
    .getByRole("button", { name: "批量发布（2）", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已发布 2 首作品" }),
  ).toBeVisible();
  const published = await (await page.request.get("/api/catalog")).json();
  expect(
    published.tracks.filter((t: { title: string }) =>
      t.title.startsWith("批量 "),
    ),
  ).toHaveLength(2);
  expect(
    (
      await page.request.delete(
        `/api/admin/tracks/${published.tracks.find((t: { title: string }) => t.title === "批量 MP3 标签").id}`,
        { headers: { Origin: new URL(page.url()).origin } },
      )
    ).status(),
  ).toBe(409);
  await panel.getByLabel("选择多个 MP3／M4A 文件").setInputFiles(files);
  await panel.getByRole("button", { name: "开始批量导入" }).click();
  await expect(panel.getByRole("status")).toHaveText("已导入 2 / 2 首");
  await expect
    .poll(async () => {
      const catalog = await (
        await page.request.get("/api/admin/catalog")
      ).json();
      return catalog.tracks.filter(
        (t: { title: string; processing: string; status: string }) =>
          t.title.startsWith("批量 ") &&
          t.status === "draft" &&
          t.processing === "ready",
      ).length;
    })
    .toBe(2);
  await page
    .getByRole("checkbox", { name: "选择作品 批量 MP3 标签", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "选择作品 批量 M4A 标签", exact: true })
    .check();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "批量删除草稿（2）", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "选择作品 批量 MP3 标签", exact: true }),
  ).toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "批量删除草稿（2）", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已删除 2 首草稿" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "选择作品 批量 MP3 标签", exact: true }),
  ).toHaveCount(0);
});
test("播放不中断、筛选、收藏、队列、刷新恢复和手机布局", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "好音乐，自有回响。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "立即聆听" }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0),
    )
    .toBeTruthy();
  const source = await page.locator("audio").first().getAttribute("src");
  await page
    .getByRole("link", { name: "全部音乐", exact: true })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "全部音乐" })).toBeVisible();
  expect(await page.locator("audio").first().getAttribute("src")).toBe(source);
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(false);
  await page.getByRole("textbox", { name: "搜索音乐" }).fill("落日");
  await expect(page.getByText("1 首作品", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "收藏 落日来信", exact: true })
    .click();
  await page.getByRole("link", { name: "我的收藏", exact: true }).click();
  await expect(page.getByRole("link", { name: /落日来信/ })).toBeVisible();
  await page.getByRole("button", { name: "加入队列 落日来信" }).click();
  await expect(page.getByRole("status")).toContainText("已加入播放队列");
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(page.getByRole("heading", { name: /接下来播放/ })).toBeVisible();
  await page.getByRole("button", { name: "关闭队列" }).click();
  await page.reload();
  await expect(page.getByRole("link", { name: /落日来信/ })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((a: HTMLAudioElement) => a.paused),
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.screenshot({ path: "artifacts/home-mobile.png", fullPage: true });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "展开播放器" }).click();
  await expect(page.getByRole("slider", { name: "播放进度" })).toBeVisible();
  await page
    .getByRole("button", { name: "收起播放器", exact: true })
    .last()
    .click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("后台创建、上传、预览、发布、编辑歌单和下架", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page
    .getByRole("textbox", { name: "管理员密码" })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(page.getByRole("button", { name: "新建作品" })).toBeVisible();
  await page.getByRole("textbox", { name: "作品名称" }).fill("浏览器上传作品");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  // Upload a WAV fixture generated directly in the test, never a remote URL.
  const rate = 8000,
    n = rate * 2,
    buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buffer.writeInt16LE(
      Math.round(Math.sin((i / rate) * 440 * 2 * Math.PI) * 2000),
      44 + i * 2,
    );
  await page
    .getByLabel("音频文件", { exact: true })
    .setInputFiles({ name: "fixture.wav", mimeType: "audio/wav", buffer });
  await page.getByRole("button", { name: "上传并处理" }).click();
  await expect(page.getByText("发布前预览", { exact: true })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("button", { name: "发布作品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("作品已发布");
  const catalog = await (await page.request.get("/api/catalog")).json(),
    t = catalog.tracks.find(
      (t: { title: string }) => t.title === "浏览器上传作品",
    );
  expect(t).toBeTruthy();
  await page.getByRole("button", { name: "歌单管理", exact: true }).click();
  await page.getByRole("textbox", { name: "歌单名称" }).fill("浏览器歌单");
  await page
    .getByRole("checkbox", { name: "浏览器上传作品", exact: true })
    .check();
  await page.getByRole("button", { name: "保存歌单" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: "作品管理", exact: true }).click();
  await page.getByRole("button", { name: "下架作品", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已下架");
  expect((await page.request.get(`/media/${t.id}/audio`)).status()).toBe(404);
  expect(errors).toEqual([]);
});
test("切歌、循环、静音恢复与播放错误重试", async ({ page }) => {
  await page.goto("/music");
  await page
    .getByRole("button", { name: "播放 月光漫游", exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => !a.paused),
    )
    .toBeTruthy();
  const first = await page.locator("audio").first().getAttribute("src");
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await expect
    .poll(() => page.locator("audio").first().getAttribute("src"))
    .not.toBe(first);
  await page.getByRole("button", { name: "单曲循环", exact: true }).click();
  const repeating = await page.locator("audio").first().getAttribute("src");
  await page
    .locator("audio")
    .first()
    .evaluate((a: HTMLAudioElement) => {
      a.currentTime = a.duration - 0.15;
    });
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => a.currentTime < 1 && !a.paused),
    )
    .toBeTruthy();
  expect(await page.locator("audio").first().getAttribute("src")).toBe(
    repeating,
  );
  await page.getByRole("slider", { name: "音量" }).focus();
  await page.keyboard.press("Home");
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((a: HTMLAudioElement) => a.volume),
  ).toBe(0);
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => a.readyState),
    )
    .toBeGreaterThan(0);
  expect(
    await page
      .locator("audio")
      .first()
      .evaluate((a: HTMLAudioElement) => a.volume),
  ).toBe(0);
  await page.route("**/media/*/audio*", (route) => route.abort());
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/无法播放|音频无法加载/);
  const failed = await page.locator("audio").first().getAttribute("src");
  await page.unroute("**/media/*/audio*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .first()
        .evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0),
    )
    .toBeTruthy();
  expect(await page.locator("audio").first().getAttribute("src")).toBe(failed);
});
