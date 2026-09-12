# Languages

The app supports Swiss Standard German (`de-CH`), French (`fr-CH`), Italian (`it-CH`),
Rumantsch Grischun (`rm-CH`), and a fifth `dialect` language preference. German is
the fallback for an unsupported browser language. The menu saves an explicit
choice in the `benchly_language` cookie for one year. When `dialect` is selected,
`benchly_language_fallback` retains the last standard language for pages without
a concrete place. Bench panels switch their full information scope to the local
national language and add a cautiously curated regional voice; see
`docs/dialect-mode.md`. URLs stay the same, preserving links and map state.

## Catalog structure

Each language has the same feature files in `messages/<language>/`:

- `common`: navigation, shared buttons, generic values and language selection.
- `map`, `bench`, `photos`, `submission`: finding, understanding and adding places.
- `community`, `knowledge`: contributions, evidence and verification prompts.
- `routing`: controls, transfers and instructions shared by walks and journeys.
- `walks`, `journey`: the two planning flows and their result explanations.
- `poetry`: variants of the short, generated bench descriptions.
- `account`: authentication and account messages.
- `feed`, `favourites`, `profile`, `avatar`: community pages and personal appearance.
- `about`: project methods and public source explanations.
- `privacy`, `legal`: data flows, storage, contact and legal information.
- `admin`: moderation controls.

Keep related text together in nested semantic sections, such as
`bench.light.confidence` or `community.observations.choices`. Use a page namespace
for a standalone page; use a feature namespace when several pages share a flow.
Avoid a global bucket of unrelated strings, text-as-keys, or numbered labels.
Poetry has numbered variants within named groups because those variants are
deliberately selected by a deterministic seed.

## Adding text

1. Add the same semantic key to all four language files.
2. Use `useTranslations()` in a client component, or `getTranslations()` in a
   server component/action. Keys are type-checked against the German catalog.
3. Translate complete sentences. Use ICU variables and plurals instead of
   joining translated sentence fragments. Use `formatDate` for the shared Swiss calendar styles and `useFormatter` for
   decimal numbers; machine timestamps and coordinates keep their wire format.
4. Pass a `Translator` explicitly to pure presentation helpers. Long-lived
   results use serializable `UiMessage` descriptors, translated when rendered,
   so changing language also changes existing results. Never use a mutable
   global locale. Expected server failures use `UserFacingError` and are translated
   at the action boundary; unexpected implementation errors use a public fallback.

Proper place names, street names, source names, licenses and user-written text
stay as authored. Stored enums and calculations stay language independent.
Legacy German bench values are translated at the boundary in `bench-labels.ts`;
they must never be compared with translated labels to make a routing/filtering
decision. Router instructions use structured turn signs and retain street names.

`catalogs.test.ts` checks complete catalogs, ICU syntax, matching placeholders
and plural behavior. `e2e/languages.spec.ts` checks browser detection, switching,
remembered preference and map preservation. `e2e/dialect-scene.spec.ts` checks
the fifth choice and location-dependent bench languages on mobile browsers.

## Browser consistency

`intl-number.ts` loads the same FormatJS number and plural data on the server and
before hydration through `instrumentation-client.ts`. Chromium lacks Romansh
locale data, and native Swiss French number separators differ across ICU versions.
This initialization is independent of the current request language.

`date.ts` extracts calendar fields in Europe/Zurich and uses catalog month names
and named date styles. It works even when a browser does not support Romansh,
without replacing native date handling used by route calculations.
