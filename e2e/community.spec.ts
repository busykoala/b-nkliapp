import { expect, test } from "@playwright/test";

async function registerUser(page: import("@playwright/test").Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByLabel("Anmelden").click();
  await page.getByRole("button", { name: "Neu hier? Konto erstellen" }).click();
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

  await expect(page.getByRole("heading", { name: "Bänkli-Momente" })).toBeVisible();
  await expect(page.getByText("Bänkli dieser Woche", { exact: true })).toBeVisible();
  await expect(page.getByText("Gemeinsames Thema", { exact: true })).toBeVisible();
  const entryCount = await page.locator(".feed-entry").count();
  expect(entryCount).toBeLessThanOrEqual(36);
  if (!entryCount) await expect(page.getByText("Noch weht kein neuer Eintrag herein.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("community-feed-empty.png"), fullPage: true });
});

test("leaves a moment, cares for and follows a Bänkli from one contribution place", async ({ page }, testInfo) => {
  const runId = `${testInfo.project.name.slice(-6)}-${Date.now().toString().slice(-6)}`;
  const moment = `Die Limmat klingt hier morgens besonders ruhig (${runId}).`;
  await registerUser(page, `p-${runId}`);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });

  await dialog.locator("summary").filter({ hasText: "Einen Moment hinterlassen" }).click();
  await dialog.getByLabel("Dein Bänkli-Moment").fill(moment);
  await dialog.getByRole("button", { name: "Moment veröffentlichen" }).click();
  await expect(dialog.getByText("Dein Bänkli-Moment ist jetzt am Platz zu lesen.")).toBeVisible();

  await dialog.locator("summary").filter({ hasText: "Sich ums Bänkli kümmern" }).click();
  await dialog.getByRole("button", { name: "Kurz gereinigt", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Kurz gereinigt · von dir" })).toBeDisabled();
  await dialog.getByLabel("Beiträge schliessen").click();

  await expect(page.getByText(moment)).toBeVisible();
  const follow = page.getByRole("button", { name: "Bänkli merken" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Lieblingsplatz" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/\d+× gereinigt/)).toBeVisible();
});

test("offers a calm mobile Bänkli photo flow", async ({ page }, testInfo) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  const runId = `${testInfo.project.name.slice(-6)}-photo-${Date.now().toString().slice(-5)}`;
  await registerUser(page, runId);
  await page.goto("/bank/osm-node-101");
  await page.getByRole("button", { name: "Beitragen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zum Bänkli beitragen" });
  await dialog.locator("summary").filter({ hasText: "Foto von diesem Platz" }).click();

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
  await expect(dialog.getByRole("button", { name: "Foto veröffentlichen" })).toBeEnabled();
  await expect(dialog.getByLabel(/Ein Satz dazu/)).toHaveAttribute("placeholder", "Was sieht man von diesem Bänkli?");
  await dialog.getByRole("button", { name: "Foto veröffentlichen" }).click();
  await expect(dialog.getByText("Die Bildprüfung schaut gerade woanders hin. Bitte später nochmals versuchen.")).toBeVisible();
  expect(pageErrors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("bench-photo-flow.png"), fullPage: true });
});
