import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const catalog = page.waitForResponse((r) => r.url().endsWith("/api/catalog"));
  await page.goto(process.argv[2] || "http://localhost:5178");
  await page
    .getByRole("button", { name: "立即聆听" })
    .waitFor({ state: "visible" });
  await catalog;
  await page.screenshot({
    path: "artifacts/preview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/preview-mobile.png",
    fullPage: true,
  });
} finally {
  await browser.close();
}
