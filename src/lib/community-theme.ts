const themes = [
  ["Winterlicht", "Zeig uns ein Bänkli im stillen Winterlicht."],
  ["Lieblingsmensch", "Welche Pause würdest du mit jemandem teilen?"],
  ["Erstes Grün", "Entdecke die ersten Frühlingszeichen rund ums Bänkli."],
  ["Bänkli mit Geschichte", "Welche Erinnerung oder lokale Geschichte gehört hierher?"],
  ["Morgenruhe", "Wie fühlt sich dieser Platz früh am Tag an?"],
  ["Schattenplatz", "Welche Bänkli schenken an warmen Tagen Schatten?"],
  ["Wasser in Sicht", "Teile einen ehrlichen Eindruck vom Wasser – oder seinem Fehlen."],
  ["Grosselterns Liebling", "Welcher Platz wäre gut für eine gemeinsame Pause?"],
  ["Abendgold", "Fang die Stimmung eines späten Sommertags ein."],
  ["Kleine Pflege", "Ein sauberer Platz ist eine leise Gemeinschaftsleistung."],
  ["Nebel & Nähe", "Was bleibt schön, wenn die Fernsicht Pause macht?"],
  ["Ein warmer Gedanke", "Hinterlasse ein kurzes Gedicht oder eine Empfehlung."],
] as const;

export function communityTheme(date = new Date()) {
  const month = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", month: "numeric" }).format(date));
  const [title, prompt] = themes[Math.max(1, Math.min(12, month)) - 1];
  return { title, prompt };
}
