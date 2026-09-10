import { useTranslations } from "next-intl";
import "server-only";

/** Public contact information is configured at runtime, never inferred from developer credentials. */
export function OperatorContact() {
  const t = useTranslations();
  const name = process.env.BENCHLY_OPERATOR_NAME;
  const email = process.env.BENCHLY_OPERATOR_EMAIL;
  const address = process.env.BENCHLY_OPERATOR_ADDRESS;
  return <section className="operator-contact"><h2>{t("legal.contact.title")}</h2>
    {name && <p>{name}</p>}
    {address && <address className="whitespace-pre-line not-italic">{address}</address>}
    {email && <p><a href={`mailto:${email}`}>{email}</a></p>}
    <p>{t.rich("legal.contact.technical", { project: (chunks) => <a href="https://github.com/busykoala/b-nkliapp" target="_blank" rel="noreferrer">{chunks}</a> })}</p>
  </section>;
}
