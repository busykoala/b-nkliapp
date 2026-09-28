"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { isLanguage, languageNames } from "@/i18n/config";
import { essays, readingLabels } from "../content";
import { essayHref, essayLanguages, type EssayLanguage } from "../model";

type ReadingViewProps = {
  initialLanguage: EssayLanguage;
  standalone?: boolean;
};

/** The author's text is plain text, not an ICU message or generated scene poetry. */
export function ReadingView({ initialLanguage, standalone = false }: ReadingViewProps) {
  const [language, setLanguage] = useState(initialLanguage);
  const selectId = useId();
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const essay = essays[language];
  const labels = readingLabels[language];
  const Heading = standalone ? "h1" : "h3";

  function changeLanguage(next: EssayLanguage) {
    setLanguage(next);
    // This changes only the reading URL, never the app-language cookie or map URL.
    if (standalone) {
      window.history.replaceState(null, "", essayHref(next));
      document.title = `${essays[next].title} · Bänkli App`;
    }
  }

  function showOriginal() {
    changeLanguage("de");
    // The footer action should take the reader to the start, not leave them at the end.
    window.requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start", behavior: "auto" });
      heading.current?.focus({ preventScroll: true });
    });
  }

  return <div className="reading-view" lang={language}>
    <div className="reading-language">
      <label htmlFor={selectId}>{labels.language}</label>
      <select id={selectId} value={language} onChange={(event) => {
        if (isLanguage(event.target.value)) changeLanguage(event.target.value);
      }}>
        {essayLanguages.map((value) => <option key={value} value={value} lang={value}>{languageNames[value]}</option>)}
      </select>
    </div>
    <article className="reading-article" aria-labelledby={titleId}>
      <header className="reading-heading">
        <p className="reading-eyebrow">{labels.eyebrow}</p>
        <Heading ref={heading} id={titleId} tabIndex={-1}>{essay.title}</Heading>
        <p className="reading-byline">{essay.byline}</p>
        <div className="reading-vignette" aria-hidden="true">
          <Image src="/ui-art/benches/wood-back.webp" alt="" width={180} height={126} unoptimized />
        </div>
      </header>
      <div className="reading-prose">{essay.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <footer className="reading-footer">
        <p>{labels.note}</p>
        {language !== "de" && <button type="button" onClick={showOriginal}>{labels.original}</button>}
        {!standalone && <Link href={essayHref(language)}>{labels.page}<ArrowUpRight size={17} aria-hidden="true" /></Link>}
      </footer>
    </article>
  </div>;
}
