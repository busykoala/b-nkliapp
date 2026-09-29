import { expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/bank/osm-node-101");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Registrieren" }).click();
  await page.getByLabel("Benutzername").fill(username);
  await page.getByLabel("Passwort", { exact: true }).fill("sicheres-passwort-2026");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.getByLabel("Menü öffnen").click();
  await expect(page.getByText("Mein Profil")).toBeVisible();
  await page.getByLabel("Menü schliessen").click();
}

test("keeps the community feed local, finite and centred on places", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("link", { name: "Bänkli-Feed" }).click();

  await expect(page).toHaveURL(/\/feed(?:\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Bänkli-Momente" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Bänkli dieser Woche", { exact: true })).toBeVisible();
  await expect(page.getByText("Gemeinsames Thema", { exact: true })).toBeVisible();
  const entryCount = await page.locator(".feed-bench-group").count();
  expect(entryCount).toBeLessThanOrEqual(36);
  if (!entryCount) await expect(page.getByText("Noch weht kein neuer Eintrag herein.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("community-feed-empty.png"), fullPage: true });
});

test("leaves a moment, cares for and follows a Bänkli from one contribution place", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  const moment = `Die Limmat klingt hier morgens besonders ruhig (${runId}).`;
  await registerUser(page, `p-${runId}`);
  await page.getByRole("button", { name: "Verbessern", exact: true }).click();
  const dialog = page.locator(".contribution-dialog[open]");

  await dialog.getByRole("button", { name: "Einen Moment hinterlassen", exact: true }).click();
  await dialog.getByLabel("Dein Bänkli-Moment").fill(moment);
  await dialog.getByRole("button", { name: "Moment veröffentlichen" }).click();
  await expect(dialog.getByText("Dein Bänkli-Moment ist jetzt am Platz zu lesen.")).toBeVisible();

  await dialog.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
  await dialog.getByRole("button", { name: "Sich ums Bänkli kümmern", exact: true }).click();
  await dialog.getByRole("button", { name: "Kurz gereinigt", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Kurz gereinigt · von dir" })).toBeDisabled();
  await dialog.getByLabel("Beiträge schliessen").click();

  await expect(page.getByText(moment)).toBeVisible();
  const follow = page.getByRole("button", { name: "Merken" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Gemerkt" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/\d+× gereinigt/)).toBeVisible();
  await page.getByRole("link", { name: "Alle Lieblingsplätze" }).click();
  await expect(page.getByRole("heading", { name: "Meine Lieblingsplätze" })).toBeVisible();
  await expect(page.locator(".saved-benches a[href^='/bank/osm-node-101']")).toBeVisible();
  const savedBench = page.locator(".saved-benches a[href^='/bank/osm-node-101']");
  await savedBench.click();
  await expect(page.getByRole("button", { name: "Gemerkt" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zurück", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Meine Lieblingsplätze" })).toBeVisible();
  await expect(savedBench).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("saved-places-restored.png"), fullPage: true });
  await page.goto("/feed");
  const filters = page.getByRole("navigation", { name: "Feed-Filter" });
  await expect(filters.getByRole("link", { name: "Alle Beiträge" })).toHaveAttribute("aria-current", "page");
  await filters.getByRole("link", { name: "Lieblingsplätze" }).click();
  await expect(filters.getByRole("link", { name: "Lieblingsplätze" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Aus deinen Lieblingsorten", { exact: true })).toBeVisible();
  await page.locator(".feed-bench-group summary").first().click();
  await expect(page.locator(".feed-bench-group details q").filter({ hasText: moment })).toBeVisible();
  await filters.getByRole("link", { name: "Alle Beiträge" }).click();
  await expect(page.getByText("Was sich an Bänkli bewegt", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("community-feed-varied.png"), fullPage: true });
});

test("offers a calm mobile Bänkli photo flow", async ({ page }, testInfo) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const runId = `${testInfo.project.name.slice(-6)}-photo-${Date.now().toString().slice(-5)}`;
  await registerUser(page, runId);
  await page.getByRole("button", { name: "Foto hinzufügen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Foto von diesem Platz" });
  await expect(dialog.locator("[data-contribution-task]:visible")).toHaveCount(1);
  await expect(dialog.locator("details")).toHaveCount(0);

  await expect(dialog.getByText("Das Bänkli ins Bild setzen")).toBeVisible();
  await expect(dialog.getByText(/Aus Fotomediathek, Kamera oder Dateien wählen/)).toBeVisible();
  const input = dialog.getByLabel("Bänkli-Foto auswählen");
  await expect(input).toHaveAttribute("accept", "image/*");
  await expect(input).not.toHaveAttribute("capture", "environment");
  const originalBytes = await input.evaluate(async (element) => {
    const canvas = document.createElement("canvas"); canvas.width = 2_000; canvas.height = 1_500;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Missing canvas context");
    const image = context.createImageData(canvas.width, canvas.height);
    const pigment = new Uint8Array(canvas.width * canvas.height * 3);
    for (let offset = 0; offset < pigment.length; offset += 65_536) crypto.getRandomValues(pigment.subarray(offset, Math.min(offset + 65_536, pigment.length)));
    for (let index = 0; index < image.data.length; index += 4) {
      const pigmentIndex = index / 4 * 3;
      image.data[index] = pigment[pigmentIndex]; image.data[index + 1] = pigment[pigmentIndex + 1]; image.data[index + 2] = pigment[pigmentIndex + 2]; image.data[index + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Missing photo blob");
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], "iphone-photo.png", { type: "image/png" }));
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return blob.size;
  });
  expect(originalBytes).toBeGreaterThan(2_000_000);
  await expect(dialog.getByAltText("Vorschau deines Bänkli-Fotos")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Entfernen" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Foto veröffentlichen" })).toBeEnabled();
  await expect(dialog.getByLabel(/Ein Satz dazu/)).toHaveAttribute("placeholder", "Was sieht man von diesem Bänkli?");
  await dialog.getByRole("button", { name: "Foto veröffentlichen" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Foto wird geprüft …");
  await expect(dialog.getByRole("status")).toHaveText("Die Bildprüfung schaut gerade woanders hin. Bitte später nochmals versuchen.");
  await input.evaluate(async (element) => {
    const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 80;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#456859"; ctx.fillRect(0, 0, 120, 80);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob(value => resolve(value!), "image/png"));
    const transfer = new DataTransfer(); transfer.items.add(new File([blob], "small.png", { type: "image/png" }));
    (element as HTMLInputElement).files = transfer.files;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(dialog.getByRole("button", { name: "Foto veröffentlichen" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Foto veröffentlichen" }).click();
  // It must reach moderation, not fail the old 8 kB compressed-size floor.
  await expect(dialog.getByRole("status")).toHaveText("Foto wird geprüft …");
  await expect(dialog.getByRole("status")).toHaveText("Die Bildprüfung schaut gerade woanders hin. Bitte später nochmals versuchen.");
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("bench-photo-flow.png"), fullPage: true });
});

test("keeps contribution drafts across tasks and protects closing the viewport-owned editor", async ({ page }, testInfo) => {
  const runId = `draft-${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  await registerUser(page, runId);
  const trigger = page.getByRole("button", { name: "Verbessern", exact: true });
  await trigger.click();
  const dialog = page.locator(".contribution-dialog[open]");
  await expect(dialog).toHaveAccessibleName("Zum Bänkli beitragen");
  await expect(dialog.locator("[data-contribution-choice]")).toHaveCount(8);
  await expect(dialog.getByText("Lindenhof", { exact: false }).first()).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(dialog.getByRole("button", { name: "Beiträge schliessen" })).toBeInViewport();

  await dialog.getByRole("button", { name: "Einen Moment hinterlassen", exact: true }).click();
  const text = `Noch nicht veröffentlichter Gedanke ${runId}`;
  await dialog.getByLabel("Dein Bänkli-Moment").fill(text);
  await page.setViewportSize({ width: viewport.width, height: 400 });
  await expect(dialog.getByRole("button", { name: "Beiträge schliessen" })).toBeInViewport();
  await dialog.getByLabel("Dein Bänkli-Moment").scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel("Dein Bänkli-Moment")).toHaveValue(text);
  await page.setViewportSize(viewport);
  await dialog.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Einen Moment hinterlassen", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Licht gerade jetzt", exact: true }).click();
  await expect(dialog.getByLabel("Licht vor Ort melden")).toBeVisible();
  await dialog.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
  await dialog.getByRole("button", { name: "Einen Moment hinterlassen", exact: true }).click();
  await expect(dialog.getByLabel("Dein Bänkli-Moment")).toHaveValue(text);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveAccessibleName("Entwurf verwerfen?");
  await dialog.getByRole("button", { name: "Weiter bearbeiten", exact: true }).click();
  await expect(dialog.getByLabel("Dein Bänkli-Moment")).toHaveValue(text);
  await dialog.getByRole("button", { name: "Beiträge schliessen" }).click();
  await dialog.getByRole("button", { name: "Verwerfen und schliessen", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/bank\/osm-node-101$/);
  await trigger.click();
  await page.locator(".contribution-dialog[open]").getByRole("button", { name: "Einen Moment hinterlassen", exact: true }).click();
  await expect(page.getByLabel("Dein Bänkli-Moment")).toHaveValue("");
});


test("saves chosen facts explicitly and retains a written contribution after a failed request", async ({ page }, testInfo) => {
  const runId = `save-${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  await registerUser(page, runId);
  await page.getByRole("button", { name: "Bänkli beschreiben", exact: true }).click();
  const dialog = page.locator(".contribution-dialog[open]");
  await dialog.getByRole("button", { name: /Armlehnen/ }).click();
  let actionRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) actionRequests++;
  });
  await dialog.getByRole("button", { name: "Nein", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Nein", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(actionRequests).toBe(0);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  const field = dialog.locator('[data-feature="armrest"]');
  await expect(field).toContainText("Nein");
  await expect(field).toBeFocused();
  await dialog.getByRole("button", { name: "Alle Beiträge", exact: true }).click();
  await dialog.getByRole("button", { name: "Einen Moment hinterlassen", exact: true }).click();
  const draft = `Dieser Gedanke bleibt auch nach einem Fehler erhalten (${runId}).`;
  const body = dialog.getByLabel("Dein Bänkli-Moment");
  await body.fill(draft);
  let failNextAction = true;
  const interrupt = async (route: import("@playwright/test").Route) => {
    const request = route.request();
    if (failNextAction && request.method() === "POST" && request.headers()["next-action"]) {
      failNextAction = false;
      await route.abort("failed");
    } else await route.continue();
  };
  await page.route("**/*", interrupt);
  await dialog.getByRole("button", { name: "Moment veröffentlichen", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(body).toHaveValue(draft);
  await page.unroute("**/*", interrupt);
  await dialog.getByRole("button", { name: "Moment veröffentlichen", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Dein Bänkli-Moment ist jetzt am Platz zu lesen.");
  await expect(body).toHaveValue("");
  await dialog.getByRole("button", { name: "Zum Bänkli", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(draft, { exact: true })).toBeVisible();
});
