import "server-only";
import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(pbkdf2);
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const parts = String(storedHash ?? "").split(":");
  if (parts.length !== 2 || !/^[0-9a-f]{32}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) {
    return false;
  }

  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  const actual = await deriveKey(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  return timingSafeEqual(actual, expected);
}
