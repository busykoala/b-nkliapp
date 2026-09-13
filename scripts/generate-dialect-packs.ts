import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Language = "de" | "fr" | "it" | "rm";
type Area = { id: string; label: string; group: string; anchors: string[]; sourceIds?: string[] };
type VoiceCandidate = { areaIds: string[]; first: Array<{ id: string; text: string }> };
type Catalogue = { schemaVersion: string; researchDate: string; areas: Area[]; voiceCandidates: VoiceCandidate[]; sources: Array<{ id: string; title: string; url: string }> };
type PackSpec = {
  id: string;
  label: string;
  language: Language;
  languageTag: string;
  rules: Array<[string, string]>;
  invitations: string[];
  sourceIds: string[];
};

const root = resolve(import.meta.dirname, "..");
const catalogue = JSON.parse(readFileSync(join(root, "config/dialects/catalogue.json"), "utf8")) as Catalogue;
const namespaces = ["account", "avatar", "bench", "common", "community", "knowledge", "photos", "submission"] as const;
const output = join(root, "src/i18n/dialects/generated");
mkdirSync(output, { recursive: true });
const checking = process.argv.includes("--check");

function emit(path: string, value: string) {
  if (checking) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== value) throw new Error(`Generated dialect artifact is stale: ${path}`);
    return;
  }
  writeFileSync(path, value);
}

const commonGerman: Array<[string, string]> = [
  ["Auf einen Blick", "Uf en Blick"], ["Bankdetails", "Bänkli-Detail"], ["Sitzbank", "Bänkli"], ["Bänke", "Bänkli"], ["Bank", "Bänkli"],
  ["Heute", "Hüt"], ["heute", "hüt"], ["Gestern", "Geschter"], ["gestern", "geschter"],
  ["Nicht", "Nöd"], ["nicht", "nöd"], [" ist ", " isch "], ["Ist ", "Isch "], ["Hier", "Da"], ["hier", "da"],
  ["Noch", "No"], ["noch", "no"], ["Zurück", "Zrugg"], ["Karte", "Charte"], ["Sonne", "Sunne"],
  ["Sonnen", "Sunne"], ["Schatten", "Schatte"], ["Licht", "Liecht"], ["Aussicht", "Ussicht"],
  ["Rückenlehne", "Ruggelehne"], ["Menschen", "Lüüt"], ["Beiträge", "Biträg"], ["Beitrag", "Bitrag"],
  ["Bewertungen", "Bewärtige"], ["Gebäude", "Gebäud"], ["Bäume", "Böim"], ["Gelände", "Gländ"],
  ["Ruhe", "Rueh"], ["Zugangsweg", "Zuegang"], ["geschätzt", "gschätzt"], ["unbekannt", "nöd bekannt"],
  ["auf der", "uf de"], ["auf dem", "uf em"], [" auf ", " uf "], ["können", "chönd"], ["kann", "cha"],
  ["anzeigen", "zeige"], ["zeigen", "zeige"], ["gespeichert", "gspeicheret"], ["geprüft", "prüeft"],
  ["Entfernen", "Wägneh"], ["Schliessen", "Zuemache"], ["schliessen", "zuemache"], ["Keine", "Kei"], ["keine", "kei"],
  ["Ein", "Es"], ["eine", "e"], ["einen", "en"], ["und", "und"], ["mit dem", "mit em"], ["für", "für"],
];

const gsw = (id: string, label: string, invitation: string, sourceIds: string[], extra: Array<[string, string]> = []): PackSpec => ({
  id, label, language: "de", languageTag: id === "bar-samnaun" ? "bar-CH" : "gsw-CH",
  rules: [...commonGerman, ...extra], invitations: [invitation, "S Bänkli het Zyt – und du hoffentlich au."], sourceIds,
});
const frp = (id: string, label: string, invitation: string): PackSpec => ({
  id, label, language: "fr", languageTag: id === "frc-jura" ? "fr-CH" : "frp-CH",
  rules: [["Banc", "Banc du payis"], ["banc", "banc du payis"], ["Aujourd’hui", "Houé"], ["aujourd’hui", "houé"], ["Ici", "Ique"], ["ici", "ique"], ["Fermer", "Cllôre"], ["Retour", "Retô"], ["Maintenant", "Ora"]],
  invitations: [invitation, "Lo banc at tot son temps."], sourceIds: ["gpsr", "romand-historical"],
});
const lmo = (id: string, label: string, invitation: string): PackSpec => ({
  id, label, language: "it", languageTag: "lmo-CH",
  rules: [["Panchina", "Banchina"], ["panchina", "banchina"], ["Oggi", "Incoeu"], ["oggi", "incoeu"], ["Qui", "Chì"], ["qui", "chì"], ["Chiudi", "Sara sü"], ["Indietro", "Indré"], ["Adesso", "Adess"]],
  invitations: [invitation, "La banchina la gh'ha minga pressa."], sourceIds: ["cde"],
});
const rm = (id: string, label: string, invitation: string, extra: Array<[string, string]> = []): PackSpec => ({
  id, label, language: "rm", languageTag: "rm-CH", rules: extra,
  invitations: [invitation, "Il banc ha peda – e ti speranza er."], sourceIds: ["romansh", "romansh-regions", "rm-phrase"],
});

const packs: PackSpec[] = [
  gsw("gsw-basel", "Baseldytsch", "Do kasch di grad e bitzli härehogge.", ["basel-dictionary"], [["Da", "Do"], ["Bänkli", "Bänggli"], ["Nöd", "Nit"], ["nöd", "nit"]]),
  gsw("gsw-baselbiet", "Baselbieter Dialäkt", "Do chasch di grad ane setze und chli verschnuufe.", ["sds"]),
  gsw("gsw-northwest", "Nordwestschwiizerisch", "Do chasch di grad ane setze und chli verschnuufe.", ["solothurn", "aargau"]),
  gsw("gsw-bern", "Bärndütsch", "Da chasch di häreha, für es bitzli z verschnuufe.", ["bern-writing"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-bern-oberland", "Bärner Oberländer Dialäkt", "Hock di häre und lueg e chli i d Wält.", ["sds", "bern-writing"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-sensler", "Seislertütsch", "Muusdǜri? Hie chasch hǜbscheli häresitze ù ggùgge.", ["sensler-glossary", "sensler-state"], [["Da", "Hie"], ["und", "ù"], ["Nöd", "Nit"], ["nöd", "nit"]]),
  gsw("gsw-jaun", "Jùutütsch", "Hock di es Momänt häre und verschnuuf.", ["jaun"], [["Nöd", "Nit"], ["nöd", "nit"]]),
  gsw("gsw-zurich", "Züridütsch", "Da chasch di grad anesetze, zum es bitzli verschnuufe.", ["zurich"]),
  gsw("gsw-schaffhausen", "Schafuuser Mundart", "Do chasch di in Rueh anesetze.", ["schaffhausen"], [["Da", "Do"]]),
  gsw("gsw-luzern", "Lozärnerdütsch", "Hock ab und schnuf es bitzli dure.", ["luzern"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-entlebuch", "Äntlibuecher Dialäkt", "Hock di häre, s pressiert nüd.", ["sds"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-zug-schwyz", "Zuger und Schwyzer Mundart", "Da chasch di häresitze und chli uusruäbe.", ["sds"]),
  gsw("gsw-muotathal", "Muotathaler Dialäkt", "Hock di häre und plodärä oder gnüüss d Rueh.", ["muotathal", "muotathal-sun"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-obwalden", "Obwaldner Mundart", "Hie chasch äs Schutzli ghirmä.", ["kerns"], [["Da", "Hie"], ["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-nidwalden", "Nidwaldner Mundart", "Mach der's kommod und hock ab.", ["nidwalden"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-uri", "Urner Mundart", "Hock di häre – für hüt isch baschta.", ["uri"], [["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-glarus", "Glarnerdütsch", "Hock ab, aber bloss nöd weidli.", ["glarus", "glarus-dictionary"]),
  gsw("gsw-sg-city", "Sanggaller Mundart", "Do chasch di anesetze und e chli verschnuufe.", ["sg-city"], [["Da", "Do"]]),
  gsw("gsw-rheintal", "Rhiitaler Mundart", "Do chasch rüabìg rööschta.", ["diepoldsau", "diep-dictionary", "werdenberg"], [["Da", "Do"]]),
  gsw("gsw-toggenburg", "Toggeburger Dialäkt", "Hock di ane und mach emol Pause.", ["toggenburg"], [["Da", "Do"]]),
  gsw("gsw-southeast", "Südostschwiizerisch", "Do chasch di grad anesetze.", ["sds"], [["Da", "Do"]]),
  gsw("gsw-thurgau", "Thurgauer Mundart", "Do chasch di härehocke und chli sii.", ["thurgau"], [["Da", "Do"]]),
  gsw("gsw-appenzell", "Appenzeller Dialäkt", "Hock di bezli häre und chnooz emol nöd.", ["appenzell-ai", "appenzell-ar"], [["Da", "Do"]]),
  gsw("gsw-wallis", "Wallisertiitsch", "Da chasch di es Bizji häreheie und verschnuufu.", ["wallis-lexicon", "wallis-writing"], [["Bänkli", "Bänki"], ["Nöd", "Nit"], ["nöd", "nit"]]),
  gsw("gsw-buendner", "Bündnerdütsch", "Do chasch di grad anesitza und a Wili verschnuufa.", ["buendner-word", "sds"], [["Da", "Do"], ["Nöd", "Nid"], ["nöd", "nid"]]),
  gsw("gsw-walser", "Walserdütsch", "Hock di häre und rüew e Wili.", ["walser", "walser-books", "bosco"], [["Nöd", "Nit"], ["nöd", "nit"]]),
  gsw("bar-samnaun", "Samnaunerisch", "Hock di her und rast a bissl.", ["samnaun"], [["Bänkli", "Bankl"], ["Nöd", "Nit"], ["nöd", "nit"]]),
  rm("rm-sursilvan", "Sursilvan", "Cheu sas ti seser in mument e trer flad."),
  rm("rm-sutsilvan", "Sutsilvan", "Qua pos ti seser en mument e trer flad."),
  rm("rm-surmiran", "Surmiran", "Cò post te seser en mument e trer flad."),
  rm("rm-puter", "Puter", "Cò poust tü tschanter ün mumaint e trer il flà.", [["Qua", "Cò"], ["anc", "auncha"]]),
  rm("rm-vallader", "Vallader", "Qua poust tü tschantar ün mumaint e trar il flà.", [["anc", "amo"]]),
  frp("frp-west", "Patois romand occidental", "Ique, te pou te reposâ on moment."),
  frp("frp-alpine", "Francoprovençal alpin", "Arrête-tè on moment; les montagnes ant tot lor temps."),
  frp("frc-jura", "Parler jurassien", "Pose-tè ci; lo banc ne s'en va pe."),
  lmo("lmo-alpine", "Lombard alpin", "Chì te pödet sentàss on moment e tirà ol fiaa."),
  lmo("lmo-prealpine", "Dialett ticines prealpin", "Chì ta pö setat giò un mument e tirà 'l fiaa."),
  lmo("lmo-lowland", "Dialett dal Sottoceneri", "Fermat un mument: 'l post al gh'ha minga pressa."),
];

if (packs.length !== 38) throw new Error(`Expected 38 dialect packs, got ${packs.length}`);

function replaceOutsideIcu(message: string, rules: Array<[string, string]>) {
  const chunks = message.split(/(\{[^{}]+\})/g);
  return chunks.map((chunk) => chunk.startsWith("{") ? chunk : rules.reduce((value, [from, to]) => {
    const escaped = from.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const left = /^\p{L}/u.test(from) ? "(?<!\\p{L})" : "";
    const right = /\p{L}$/u.test(from) ? "(?!\\p{L})" : "";
    return value.replace(new RegExp(`${left}${escaped}${right}`, "gu"), to);
  }, chunk)).join("");
}

function transform(value: unknown, rules: Array<[string, string]>): unknown {
  if (typeof value === "string") return replaceOutsideIcu(value, rules).normalize("NFC");
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child, rules)]));
}

for (const pack of packs) {
  const messages = Object.fromEntries(namespaces.map((namespace) => {
    const source = JSON.parse(readFileSync(join(root, `src/i18n/messages/${pack.language}/${namespace}.json`), "utf8"));
    return [namespace, transform(source, pack.rules)];
  }));
  emit(join(output, `${pack.id}.json`), `${JSON.stringify(messages, null, 2)}\n`);
}

function parentForArea(id: string): string {
  if (id === "ti-bosco-gurin") return "gsw-walser";
  if (id === "gr-samnaun") return "bar-samnaun";
  if (id.startsWith("rm-") || id === "gr-bivio-contact" || id === "gr-rhine-rm-contact") {
    if (["rm-sutsilvan", "gr-rhine-rm-contact"].includes(id)) return "rm-sutsilvan";
    if (["rm-surmiran", "gr-bivio-contact"].includes(id)) return "rm-surmiran";
    if (["rm-puter", "rm-bergun"].includes(id)) return "rm-puter";
    if (["rm-vallader", "rm-jauer"].includes(id)) return "rm-vallader";
    return "rm-sursilvan";
  }
  if (id.startsWith("fr-") || id.startsWith("frp-") || id.startsWith("oil-")) {
    if (id.includes("jura") || id.startsWith("oil-") || id === "be-biel-contact") return "frc-jura";
    if (id.includes("fribourg") || id.includes("valais")) return "frp-alpine";
    return "frp-west";
  }
  if (id.startsWith("lmo-")) {
    if (/mendrisiotto|luganese|malcantone/.test(id)) return "lmo-lowland";
    if (/bellinzonese|locarnese|mesolcina|calanca|bregaglia|poschiavo/.test(id)) return "lmo-prealpine";
    return "lmo-alpine";
  }
  if (id === "bs-city") return "gsw-basel";
  if (id.startsWith("bl-")) return "gsw-baselbiet";
  if (id.startsWith("so-") || id.startsWith("ag-")) return "gsw-northwest";
  if (id === "fr-sensler") return "gsw-sensler";
  if (id === "fr-jaun") return "gsw-jaun";
  if (id.startsWith("be-") && /thun|boedeli|brienz|hasli|grindelwald|lauterbrunnen|frutig|simmental|saanen/.test(id)) return "gsw-bern-oberland";
  if (id.startsWith("be-") || id === "fr-seeland" || id === "fr-gurmels-contact" || id === "fr-city-contact") return "gsw-bern";
  if (id.startsWith("zh-")) return "gsw-zurich";
  if (id.startsWith("sh-")) return "gsw-schaffhausen";
  if (id === "lu-entlebuch") return "gsw-entlebuch";
  if (id.startsWith("lu-")) return "gsw-luzern";
  if (id.startsWith("zg-") || id === "sz-core" || id === "sz-einsiedeln" || id === "sz-march-hoefe") return "gsw-zug-schwyz";
  if (id === "sz-muotathal") return "gsw-muotathal";
  if (id.startsWith("ow-")) return "gsw-obwalden";
  if (id.startsWith("nw-")) return "gsw-nidwalden";
  if (id.startsWith("ur-")) return "gsw-uri";
  if (id.startsWith("gl-")) return "gsw-glarus";
  if (id === "sg-city") return "gsw-sg-city";
  if (/^sg-(rheintal|diepoldsau|werdenberg)/.test(id)) return "gsw-rheintal";
  if (id.startsWith("sg-togg")) return "gsw-toggenburg";
  if (id === "sg-sargans" || id === "sg-see-gaster") return "gsw-southeast";
  if (id.startsWith("tg-")) return "gsw-thurgau";
  if (id.startsWith("ai-") || id.startsWith("ar-")) return "gsw-appenzell";
  if (id.startsWith("vs-")) return "gsw-wallis";
  if (id.startsWith("gr-") && /schanfigg|vals|safien|rheinwald|avers|obersaxen|tschappina|mutten/.test(id)) return "gsw-walser";
  if (id.startsWith("gr-")) return "gsw-buendner";
  throw new Error(`No parent pack for ${id}`);
}

const sourceById = new Map(catalogue.sources.map((source) => [source.id, source]));
const variantsByArea = new Map<string, Array<{ id: string; text: string }>>();
for (const candidate of catalogue.voiceCandidates) {
  for (const areaId of candidate.areaIds) variantsByArea.set(areaId, [...(variantsByArea.get(areaId) ?? []), ...candidate.first.map(({ id, text }) => ({ id, text: text.normalize("NFC") }))]);
}
const factualLight: Record<Language, Record<"potentialSun" | "shade" | "night" | "unknown", string>> = {
  de: { potentialSun: "Direkte Sonne möglich; Bewölkung nicht berücksichtigt.", shade: "Berechneter Schatten.", night: "Nacht: keine direkte Sonne.", unknown: "Lichtsituation noch unbekannt." },
  fr: { potentialSun: "Soleil direct possible ; nuages non pris en compte.", shade: "Ombre prévue par le calcul.", night: "Nuit : pas de soleil direct.", unknown: "Situation lumineuse encore inconnue." },
  it: { potentialSun: "Sole diretto possibile; nuvole non considerate.", shade: "Ombra prevista dal calcolo.", night: "Notte: niente sole diretto.", unknown: "Situazione luminosa ancora sconosciuta." },
  rm: { potentialSun: "Glisch directa dal sulegl pussaivla; nivels betg resguardads.", shade: "Sumbriva calculada.", night: "Notg: nagina glisch directa dal sulegl.", unknown: "La situaziun da glisch n’è anc betg enconuschenta." },
};
const manifest = packs.map((pack) => ({
  id: pack.id, label: pack.label, language: pack.language, languageTag: pack.languageTag,
  formatLocale: `${pack.language}-CH`, version: "2026.09.1", invitations: pack.invitations.map((text, index) => ({ id: `${pack.id}-default-${index + 1}`, text })),
  light: Object.fromEntries(Object.entries(factualLight[pack.language]).map(([key, value]) => [key, replaceOutsideIcu(value, pack.rules)])),
  sources: pack.sourceIds.flatMap((id) => sourceById.has(id) ? [{ id, title: sourceById.get(id)!.title, url: sourceById.get(id)!.url }] : []),
}));
const areas = catalogue.areas.map((area) => ({
  id: area.id, label: area.label, group: area.group, anchors: area.anchors, parentPackId: parentForArea(area.id), sourceIds: area.sourceIds ?? [], variants: variantsByArea.get(area.id) ?? [],
}));

const imports = packs.map((pack, index) => `import p${index} from "./generated/${pack.id}.json";`).join("\n");
const entries = packs.map((pack, index) => `  "${pack.id}": p${index},`).join("\n");
const packModule = `// Generated by scripts/generate-dialect-packs.ts. Do not edit.\n${imports}\n\nexport const DIALECT_PACK_MESSAGES = {\n${entries}\n} as const;\n`;
const registryModule = `// Generated by scripts/generate-dialect-packs.ts. Do not edit.\nexport const DIALECT_PACK_MANIFEST = ${JSON.stringify(manifest, null, 2)} as const;\nexport const DIALECT_AREAS = ${JSON.stringify(areas, null, 2)} as const;\nexport const DIALECT_DATA_VERSION = ${JSON.stringify(`catalogue-${catalogue.schemaVersion}-${catalogue.researchDate}`)};\n`;
emit(join(root, "src/i18n/dialects/packs.generated.ts"), packModule);
emit(join(root, "src/i18n/dialects/registry.generated.ts"), registryModule);

if (readdirSync(output).filter((name) => name.endsWith(".json")).length !== packs.length) throw new Error("Stale generated dialect packs found");
console.log(`${checking ? "Checked" : "Generated"} ${packs.length} complete packs for ${areas.length} areas.`);
