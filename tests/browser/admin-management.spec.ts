import { test, expect } from "@playwright/test";
import { document } from "../helpers.mjs";
test("作品分类、搜索分页、跨页勾选、编辑保护、状态流转与手机抽屉", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/admin");
  await page
    .getByRole("textbox", { name: "管理员密码" })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await expect(
    page.getByRole("button", { name: "新建作品", exact: true }),
  ).toBeVisible();
  const headers = { Origin: new URL(page.url()).origin };
  const ids: string[] = [];
  for (let i = 0; i < 52; i++) {
    const response = await page.request.post("/api/admin/tracks", {
      headers,
      data: {
        ...document,
        title: `管理验收 ${String(i).padStart(2, "0")}`,
        description: "搜索简介样本",
        tags: ["管理标签"],
      },
    });
    expect(response.status()).toBe(201);
    ids.push((await response.json()).id);
  }
  await page.reload();
  const drafts = page.getByRole("region", { name: "草稿列表", exact: true });
  await expect(drafts.getByRole("article")).toHaveCount(50);
  await expect(drafts.getByText("月光漫游", { exact: true })).toHaveCount(0);
  await drafts.getByRole("checkbox", { name: "选择本页", exact: true }).check();
  await expect(drafts.getByText("已选 50 首", { exact: true })).toBeVisible();
  await drafts.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(drafts.getByRole("article")).toHaveCount(2);
  await drafts.getByRole("checkbox", { name: "选择本页", exact: true }).check();
  await expect(drafts.getByText("已选 52 首", { exact: true })).toBeVisible();
  await drafts
    .getByRole("checkbox", { name: /^选择作品/ })
    .first()
    .uncheck();
  expect(
    await drafts
      .getByRole("checkbox", { name: "选择本页", exact: true })
      .evaluate((e: HTMLInputElement) => e.indeterminate),
  ).toBe(true);
  await drafts
    .getByRole("textbox", { name: "搜索后台作品" })
    .fill("管理验收 00");
  await expect(drafts.getByRole("article")).toHaveCount(1);
  await expect(drafts.getByText(/^已选/)).toHaveCount(0);
  await drafts
    .getByRole("button", { name: "编辑 管理验收 00", exact: true })
    .click();
  const drawer = page.getByRole("dialog", { name: "作品编辑面板" });
  await expect(drawer.getByRole("textbox", { name: "作品名称" })).toBeFocused();
  await drawer
    .getByRole("textbox", { name: "作品名称" })
    .fill("未保存的草稿名字");
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/admin/catalog");
      return response.ok();
    })
    .toBe(true);
  await page.waitForTimeout(4200);
  await expect(drawer.getByRole("textbox", { name: "作品名称" })).toHaveValue(
    "未保存的草稿名字",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(
    drafts.getByRole("button", { name: "编辑 管理验收 00", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: /^已发布作品（/ }).click();
  const published = page.getByRole("region", {
    name: "已发布作品列表",
    exact: true,
  });
  await expect(published.getByText("月光漫游", { exact: true })).toBeVisible();
  await expect(published.getByText("管理验收 00", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "批量导入", exact: true }),
  ).toHaveCount(0);
  await expect(
    published.getByRole("checkbox", { name: "选择本页", exact: true }),
  ).toBeVisible();
  await published
    .getByRole("button", { name: "预览 月光漫游", exact: true })
    .click();
  await expect(drawer.locator("audio")).toBeFocused();
  await drawer
    .getByRole("textbox", { name: "作品名称" })
    .fill("未保存的发布作品名字");
  page.once("dialog", (dialog) => dialog.dismiss());
  await drawer.getByRole("button", { name: "下架作品", exact: true }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("textbox", { name: "作品名称" }).fill("月光漫游");
  await drawer.getByRole("button", { name: "关闭作品编辑面板" }).click();
  await published
    .getByRole("button", { name: "取消精选 月光漫游", exact: true })
    .click();
  await expect(
    published.getByRole("button", { name: "设为精选 月光漫游", exact: true }),
  ).toBeVisible();
  await published
    .getByRole("button", { name: "设为精选 月光漫游", exact: true })
    .click();
  await expect(
    published.getByRole("button", { name: "取消精选 月光漫游", exact: true }),
  ).toBeVisible();
  // Temporary test work uses an existing local fixture, then restores its public state.
  const publicCatalog = await (await page.request.get("/api/catalog")).json();
  const failId = publicCatalog.tracks.find(
    (t: { title: string }) => t.title === "落日来信",
  ).id;
  const failRoute = `**/api/admin/tracks/${failId}/unpublish`;
  await page.route(failRoute, (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: "模拟下架失败" }),
    }),
  );
  await published
    .getByRole("checkbox", { name: "选择作品 潮汐之间", exact: true })
    .check();
  await published
    .getByRole("checkbox", { name: "选择作品 落日来信", exact: true })
    .check();
  page.once("dialog", (dialog) => dialog.dismiss());
  await published
    .getByRole("button", { name: "批量下架（2）", exact: true })
    .click();
  await expect(
    published.getByRole("checkbox", { name: "选择作品 潮汐之间", exact: true }),
  ).toBeChecked();
  page.once("dialog", (dialog) => dialog.accept());
  await published
    .getByRole("button", { name: "批量下架（2）", exact: true })
    .click();
  await expect(published.getByText("潮汐之间", { exact: true })).toHaveCount(0);
  await expect(
    published.getByRole("checkbox", { name: "选择作品 落日来信", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("alert")).toContainText("模拟下架失败");
  await expect(published.getByRole("button", { name: /批量删除/ })).toHaveCount(
    0,
  );
  await page.unroute(failRoute);
  await expect(
    page.getByRole("button", { name: /^已发布作品（/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^草稿与导入（/ }).click();
  await drafts.getByRole("textbox", { name: "搜索后台作品" }).fill("潮汐之间");
  await drafts
    .getByRole("button", { name: "编辑 潮汐之间", exact: true })
    .click();
  await drawer.getByRole("button", { name: "发布作品", exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: /^草稿与导入（/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(drafts.getByRole("article")).toHaveCount(0);
  await drafts.getByRole("textbox", { name: "搜索后台作品" }).fill("管理验收");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drafts.getByRole("article")).toHaveCount(50);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await drafts
    .getByRole("button", { name: /^编辑 管理验收/ })
    .first()
    .click();
  expect((await drawer.boundingBox())?.width).toBe(390);
  await page.screenshot({
    path: "artifacts/admin-drawer-mobile.png",
    fullPage: false,
  });
  await drawer.getByRole("button", { name: "关闭作品编辑面板" }).click();
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: "artifacts/admin-drafts-desktop.png",
    fullPage: false,
  });
  for (const id of ids)
    expect(
      (
        await page.request.delete(`/api/admin/tracks/${id}`, { headers })
      ).status(),
    ).toBe(200);
  expect(errors).toEqual([]);
});
