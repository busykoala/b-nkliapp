import { expect, test } from "@playwright/test";

test("announces only worker replacements and keeps open filters usable", async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "1", "Service workers register only in production.");
  await page.addInitScript(() => {
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: null,
      register: async () => {
        document.documentElement.dataset.workerRegistered = "true";
        return { update: async () => undefined };
      },
    });
    Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-worker-registered", "true");
  const changeController = () => page.evaluate(async () => {
    Object.defineProperty(navigator.serviceWorker, "controller", { value: {}, configurable: true });
    navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    await new Promise(requestAnimationFrame);
  });

  await changeController();
  await page.getByLabel("Filter öffnen").click();
  const panel = page.getByRole("dialog", { name: "Was brauchst du?" });
  await expect(panel).toBeVisible();
  await expect(page.getByText("Eine frischere Karte ist bereit.")).toHaveCount(0);

  await changeController();
  await expect(page.getByText("Eine frischere Karte ist bereit.")).toBeVisible();
  await panel.getByRole("button", { name: "Karte ansehen" }).click();
  await expect(panel).toHaveCount(0);
  await page.getByLabel("Update-Hinweis schliessen").click();
  await expect(page.getByText("Eine frischere Karte ist bereit.")).toHaveCount(0);
});
