import { cookies, headers } from "next/headers";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { sqlite } from "@/db/client";

const CONTRIBUTOR_COOKIE = "benchly_contributor";
const ADMIN_COOKIE = "benchly_admin";
const USER_COOKIE = "baenkli_session";

function secret(name: string, developmentFallback: string) {
  const configured = process.env[name];
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} muss in Produktion gesetzt sein.`);
  return developmentFallback;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function userSessionHash(token: string) {
  return createHmac("sha256", secret("USER_SESSION_SECRET", "baenkli-local-user-session-secret"))
    .update(token).digest("hex");
}

export function normalizeUsername(value: string) {
  return value.trim().normalize("NFKC").toLocaleLowerCase("de-CH");
}

export function generateUserPasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyUserPassword(password: string, encoded: string) {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type CurrentUser = { id: number; username: string; avatarSeed: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(USER_COOKIE)?.value;
  if (!token) return null;
  const user = sqlite.prepare(`
    SELECT u.id,u.username,coalesce(nullif(u.avatar_seed,''),u.username) avatarSeed
    FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?
  `).get(userSessionHash(token), new Date().toISOString()) as CurrentUser | undefined;
  return user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Bitte melde dich zuerst an.");
  return user;
}

export async function createUserSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  sqlite.prepare("DELETE FROM user_sessions WHERE expires_at<=?").run(now.toISOString());
  sqlite.prepare("INSERT INTO user_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(userSessionHash(token), userId, expires.toISOString(), now.toISOString());
  (await cookies()).set(USER_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires,
  });
}

export async function destroyUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USER_COOKIE)?.value;
  if (token) sqlite.prepare("DELETE FROM user_sessions WHERE token_hash=?").run(userSessionHash(token));
  cookieStore.delete(USER_COOKIE);
}

export function contributorHashForUser(userId: number) {
  return createHmac("sha256", secret("CONTRIBUTOR_SECRET", "benchly-local-contributor-secret"))
    .update(`user:${userId}`).digest("hex");
}

export async function getContributorIdentity() {
  const cookieStore = await cookies();
  let token = cookieStore.get(CONTRIBUTOR_COOKIE)?.value;
  if (!token) {
    token = randomBytes(32).toString("base64url");
    cookieStore.set(CONTRIBUTOR_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  const contributorHash = createHmac("sha256", secret("CONTRIBUTOR_SECRET", "benchly-local-contributor-secret"))
    .update(token).digest("hex");
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? headerStore.get("x-real-ip") ?? "local";
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = createHmac("sha256", secret("RATE_LIMIT_SECRET", "benchly-local-rate-secret"))
    .update(`${day}:${forwarded}`).digest("hex");
  return { contributorHash, ipHash };
}

export function assertContributorAllowed(contributorHash: string) {
  const blocked = sqlite.prepare("SELECT 1 FROM blocked_contributors WHERE contributor_hash = ?").get(contributorHash);
  if (blocked) throw new Error("Beiträge von diesem Browser wurden gesperrt.");
}

export function consumeRateLimit(keyHash: string, action: string, limit: number, windowSeconds: number) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const update = sqlite.prepare(`
    INSERT INTO rate_limits (key_hash, action, window_start, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(key_hash, action, window_start) DO UPDATE SET count = count + 1
    RETURNING count
  `).get(keyHash, action, windowStart) as { count: number };
  if (update.count > limit) throw new Error("Zu viele Beiträge. Bitte versuche es später erneut.");
}

export function verifyAdminPassword(password: string) {
  const encoded = process.env.ADMIN_PASSWORD_HASH;
  if (!encoded) return process.env.NODE_ENV !== "production" && password === "benchly-admin";
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generatePasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

export async function createAdminSession() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(`${secret("ADMIN_SESSION_SECRET", "benchly-local-admin-secret")}:${token}`);
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  sqlite.prepare("INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)")
    .run(tokenHash, expires.toISOString(), now.toISOString());
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires });
}

export async function isAdmin() {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  const tokenHash = sha256(`${secret("ADMIN_SESSION_SECRET", "benchly-local-admin-secret")}:${token}`);
  const session = sqlite.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(tokenHash) as { expires_at: string } | undefined;
  return Boolean(session && new Date(session.expires_at).getTime() > Date.now());
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value;
  if (token) {
    const tokenHash = sha256(`${secret("ADMIN_SESSION_SECRET", "benchly-local-admin-secret")}:${token}`);
    sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
  }
  cookieStore.delete(ADMIN_COOKIE);
}
