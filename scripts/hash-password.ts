import { generatePasswordHash } from "../src/lib/security";

const password = process.argv[2];
if (!password) throw new Error("Aufruf: npx tsx scripts/hash-password.ts <passwort>");
console.log(generatePasswordHash(password));
