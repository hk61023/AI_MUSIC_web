import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const c of secret) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", Buffer.from(bytes)).update(b).digest(),
    o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, "0");
}
test("访问统计、IP查询、手机布局、验证器绑定及恢复码登录", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const reports: unknown[] = [];
  await page.route("**/api/visits", async (route) => {
    reports.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "全部音乐", exact: true })
    .first()
    .click();
  await expect.poll(() => reports.length).toBeGreaterThan(1);
  const ids = reports.map((r) => (r as { id: string }).id);
  expect(new Set(ids).size).toBe(1);
  await page.goto("/admin");
  await page
    .getByRole("textbox", { name: "管理员密码" })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.getByRole("button", { name: "访问统计", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "访问统计", exact: true }),
  ).toBeVisible();
  const row = page.locator(".visit-row").filter({ hasText: "127.0.0.1" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "查询归属" }).click();
  await expect(row.getByText("本地或保留地址")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索访问 IP" }).fill("not-found");
  await expect(
    page.getByText("暂无匹配的访问记录", { exact: false }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索访问 IP" }).fill("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await page.getByRole("button", { name: "开始绑定验证器" }).click();
  await expect(
    page.getByAltText("Google Authenticator 绑定二维码"),
  ).toBeVisible();
  const secret = await page.locator(".mfa-secret").innerText();
  await page
    .getByRole("textbox", { name: "动态验证码", exact: true })
    .fill(totp(secret));
  await page.getByRole("button", { name: "验证并启用" }).click();
  await expect(
    page.getByRole("heading", { name: "保存一次性恢复码" }),
  ).toBeVisible();
  const codes = (await page.locator(".recovery-codes").innerText()).split("\n");
  expect(codes).toHaveLength(10);
  await expect(
    page.getByRole("button", { name: "完成，进入后台" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "我已安全保存恢复码" }).check();
  await page.getByRole("button", { name: "完成，进入后台" }).click();
  await expect(page.getByText("已启用 · 剩余恢复码 10 个")).toBeVisible();
  await page.getByRole("button", { name: "退出", exact: false }).click();
  await expect(
    page.getByRole("button", { name: "进入管理后台" }),
  ).toBeEnabled();
  await page
    .getByRole("textbox", { name: "管理员密码" })
    .fill("browser-test-only-password");
  await page.getByRole("textbox", { name: "登录验证码" }).fill(codes[0]);
  expect(
    (await page.getByRole("textbox", { name: "管理员密码" }).inputValue())
      .length,
  ).toBeGreaterThan(12);
  await page.getByRole("button", { name: "进入管理后台" }).click();
  await page.getByRole("button", { name: "账号安全", exact: true }).click();
  await expect(page.getByText("已启用 · 剩余恢复码 9 个")).toBeVisible();
  expect(errors).toEqual([]);
});
