import "server-only";

/** Public contact information is configured at runtime, never inferred from developer credentials. */
export function OperatorContact() {
  const name = process.env.BENCHLY_OPERATOR_NAME;
  const email = process.env.BENCHLY_OPERATOR_EMAIL;
  const address = process.env.BENCHLY_OPERATOR_ADDRESS;
  return <section className="operator-contact"><h2>Verantwortlich & erreichbar</h2>
    {name && <p>{name}</p>}
    {address && <address className="whitespace-pre-line not-italic">{address}</address>}
    {email && <p><a href={`mailto:${email}`}>{email}</a></p>}
    <p>Technische Fragen und Beiträge: <a href="https://github.com/busykoala/b-nkliapp" target="_blank" rel="noreferrer">Bänkli App auf GitHub ↗</a>.</p>
  </section>;
}
