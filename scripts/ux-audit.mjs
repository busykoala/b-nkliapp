import { chromium, devices } from "playwright";

const target = process.argv[2] ?? "http://127.0.0.1:3000";
const output = process.argv[3] ?? "/tmp/benchly-ux-audit.png";
const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["iPhone 14"],
  locale: "de-CH",
  geolocation: { longitude: 8.5417, latitude: 47.3769 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
const events = [];
page.on("console", (message) => events.push(`console:${message.type()}: ${message.text()}`));
page.on("pageerror", (error) => events.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  const error = request.failure()?.errorText ?? "";
  if (error !== "net::ERR_ABORTED") events.push(`requestfailed: ${request.url()} ${error}`);
});
page.on("response", (response) => {
  if (response.status() >= 400) events.push(`response:${response.status()}: ${response.url()}`);
});

await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.screenshot({ path: output, fullPage: true });
const locationButton = page.getByLabel("Meinen Standort anzeigen");
if (await locationButton.isVisible()) {
  await locationButton.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: output.replace(/\.png$/, "-location.png"), fullPage: true });
}
const result = await page.evaluate(() => ({
  title: document.title,
  text: document.body.innerText,
  canvases: document.querySelectorAll("canvas").length,
  mapTiles: document.querySelectorAll(".maplibregl-canvas").length,
  dialogs: [...document.querySelectorAll('[role="dialog"]')].map((element) => element.textContent),
}));

process.stdout.write(`${JSON.stringify({ result, events }, null, 2)}\n`);
await browser.close();
