import { chromium } from "playwright";

const USER_DATA_DIR = "D:/pinduoduo-drama/auth/accounts/default/chromium-profile";

const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
  channel: "chrome",
  headless: false,
  args: ["--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
  viewport: null,
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://mcn.pinduoduo.com/home/shortplayManage", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(4_000);
console.log("manage url:", page.url());

const userInfo = await page.evaluate(async () => {
  const r = await fetch("https://mcn.pinduoduo.com/api/cafe/login/user_info", { credentials: "include" });
  return r.json().catch(() => null);
});
console.log("user_info:", JSON.stringify(userInfo)?.slice(0, 2000));

// Try creator manage page without uid and watch redirect.
await page.goto("https://mcn.pinduoduo.com/home/creator/manage", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForTimeout(4_000);
console.log("creator manage url:", page.url());

await context.close();
