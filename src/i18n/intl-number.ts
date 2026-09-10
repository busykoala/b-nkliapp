// Pin number/plural data across Node, Chromium and WebKit. Chromium omits
// Romansh, while native fr-CH separators differ between ICU releases.
import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/de.js";
import "@formatjs/intl-pluralrules/locale-data/fr.js";
import "@formatjs/intl-pluralrules/locale-data/it.js";
import "@formatjs/intl-pluralrules/locale-data/rm.js";
import "@formatjs/intl-numberformat/polyfill-force.js";
import "@formatjs/intl-numberformat/locale-data/en.js";
import "@formatjs/intl-numberformat/locale-data/de-CH.js";
import "@formatjs/intl-numberformat/locale-data/fr-CH.js";
import "@formatjs/intl-numberformat/locale-data/it-CH.js";
import "@formatjs/intl-numberformat/locale-data/rm.js";
