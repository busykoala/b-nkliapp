// Local TLS in front of the standalone build. Safari requires HTTPS for
// production Secure cookies; no application security settings are overridden.
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:https";
import { request } from "node:http";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temporary = mkdtempSync(join(tmpdir(), "benchly-test-tls-"));
const key = join(temporary, "localhost.key");
const cert = join(temporary, "localhost.crt");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-keyout", key, "-out", cert, "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
for (const [source, destination] of [["public", ".next/standalone/public"], [".next/static", ".next/standalone/.next/static"]]) {
  if (!existsSync(destination)) symlinkSync(resolve(source), destination, "dir");
}
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: "3101", HOSTNAME: "127.0.0.1" }, stdio: "inherit",
});
const proxy = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
  const upstream = request({
    hostname: "127.0.0.1", port: 3101, path: incoming.url, method: incoming.method,
    headers: { ...incoming.headers, "x-forwarded-proto": "https", "x-forwarded-host": incoming.headers.host },
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => { outgoing.writeHead(502); outgoing.end("Production server starting"); });
  incoming.pipe(upstream);
});
proxy.listen(3100, "127.0.0.1");
function stop() { proxy.close(); server.kill("SIGTERM"); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.on("exit", (code) => { proxy.close(); process.exitCode = code ?? 0; });

