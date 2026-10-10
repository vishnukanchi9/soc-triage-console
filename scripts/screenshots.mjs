// Captures the README screenshots from a running dev server (npm run dev).
// Uses an installed Edge or Chrome through puppeteer-core; nothing is downloaded.
//
//   node scripts/screenshots.mjs [--dark]
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const dark = process.argv.includes("--dark");
const browsers = [
  process.env.BROWSER_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const executablePath = browsers.find((p) => existsSync(p));
if (!executablePath) throw new Error("No Chrome or Edge found; set BROWSER_PATH.");

// A throwaway profile, so a browser that is already open is not reused.
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "soc-shots-")),
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1360, height: 860, deviceScaleFactor: 1.5 });
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
const suffix = dark ? "-dark" : "";

async function shot(name, { fullPage = false } = {}) {
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `docs/screenshots/${name}${suffix}.png`, fullPage });
  console.log("saved", name + suffix);
}

async function signInAs(role) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  if (role === null) return;
  await page.evaluate((r) => {
    [...document.querySelectorAll(".demo-btn")].find((b) => b.textContent.toLowerCase().startsWith(r)).click();
  }, role);
  await page.waitForSelector("tbody tr");
}

await signInAs(null);
await shot("login");

await signInAs("admin");
await shot("queue");

await page.click("a.row-link");
await page.waitForSelector(".detail-grid");
await shot("incident", { fullPage: true });

await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0" });
await page.waitForSelector(".tiles");
await shot("dashboard");

await page.goto(`${BASE}/detectors`, { waitUntil: "networkidle0" });
await page.waitForSelector("tbody tr");
await shot("detectors");

await page.goto(`${BASE}/audit`, { waitUntil: "networkidle0" });
await page.waitForSelector("tbody tr");
await shot("audit");

await page.setViewport({ width: 390, height: 800, deviceScaleFactor: 2 });
await page.goto(`${BASE}/queue`, { waitUntil: "networkidle0" });
await page.waitForSelector("tbody tr");
await shot("queue-mobile");

await browser.close();
