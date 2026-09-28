import { expect, test } from "@playwright/test";

test("explains sources and data use without exposing job controls", async ({ page }, info) => {
  await page.goto("/");
  await page.getByLabel("Menü öffnen").click();
  await page.getByRole("link", { name: "Über die Bänkli App", exact: true }).click();
  await expect(page).toHaveURL(/\/danke$/);
  await expect(page.getByRole("heading", { name: "Ein guter Platz für eine Pause." })).toBeVisible();
  await page.locator(".about-source-catalog > summary").click();
  const buildings = page.locator(".about-sources details").filter({ hasText: "swissBUILDINGS3D 3.0" });
  await buildings.locator("summary").click();
  await expect(buildings.getByText(/Sonne dahinter/)).toBeVisible();
  await expect(page.getByText(/CronJob|Datenküche|letzter Lauf/)).toHaveCount(0);
  await page.getByRole("button", { name: "Foto beitragen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bildprüfung auf unserem Modellserver" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kurze Pause im Speicher" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fehler oder Idee melden ↗" })).toHaveAttribute("href", "https://github.com/busykoala/b-nkliapp/issues");
  await page.locator(".privacy-flow").screenshot({ path: info.outputPath("privacy-flow.png") });
  await page.getByRole("link", { name: "Datenschutz & Kontakt" }).click();
  await expect(page.getByRole("heading", { name: "Wofür wir Daten brauchen" })).toBeVisible();
});
