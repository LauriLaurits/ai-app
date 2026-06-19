import crypto from "node:crypto";
import { config } from "../config.js";

interface MemoryRecord {
  value: unknown;
  expiresAt: number;
}

const memoryStore = new Map<string, MemoryRecord>();

function namespaced(key: string): string {
  return `${config.broker.storageNamespace}:${key}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}

function hasRedis(): boolean {
  return Boolean(config.storage.upstashUrl && config.storage.upstashToken);
}

// Serverless instances are recycled constantly, so in-memory sessions would
// silently log everyone out. Refuse to start without a real store.
function assertPersistentStorage(): void {
  if (process.env.VERCEL && !hasRedis()) {
    throw new Error(
      "OAuth broker storage requires Upstash Redis on serverless deployments. " +
        "Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
    );
  }
}

async function redisCommand(args: string[]): Promise<unknown> {
  if (!hasRedis()) {
    return null;
  }

  const response = await fetch(config.storage.upstashUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${config.storage.upstashToken}`,
    },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    throw new Error(`Redis command failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body?.error) {
    throw new Error(`Redis command failed: ${body.error}`);
  }

  return body?.result ?? null;
}

function memoryCleanup(key: string): unknown {
  const record = memoryStore.get(key);
  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return record.value;
}

export async function setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
  assertPersistentStorage();
  const safeKey = namespaced(key);

  if (hasRedis()) {
    await redisCommand(["SET", safeKey, JSON.stringify(value), "EX", String(ttlSec)]);
    return;
  }

  memoryStore.set(safeKey, {
    value,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

export async function getJson<T>(key: string): Promise<T | null> {
  assertPersistentStorage();
  const safeKey = namespaced(key);

  if (hasRedis()) {
    const value = await redisCommand(["GET", safeKey]);
    return value ? (JSON.parse(String(value)) as T) : null;
  }

  return memoryCleanup(safeKey) as T | null;
}

// Atomic-ish counter used for rate limiting. Returns the running count within
// the current window and sets the expiry on the first hit.
export async function incrementWithExpiry(
  key: string,
  windowSec: number
): Promise<number> {
  assertPersistentStorage();
  const safeKey = namespaced(key);

  if (hasRedis()) {
    const count = Number(await redisCommand(["INCR", safeKey]));
    if (count === 1) {
      await redisCommand(["EXPIRE", safeKey, String(windowSec)]);
    }
    return count;
  }

  const now = Date.now();
  const record = memoryStore.get(safeKey);
  if (!record || record.expiresAt <= now) {
    memoryStore.set(safeKey, { value: 1, expiresAt: now + windowSec * 1000 });
    return 1;
  }

  const next = Number(record.value) + 1;
  record.value = next;
  return next;
}

export async function deleteKey(key: string): Promise<void> {
  const safeKey = namespaced(key);

  if (hasRedis()) {
    await redisCommand(["DEL", safeKey]);
    return;
  }

  memoryStore.delete(safeKey);
}

export async function storeAuthorizationCode(
  code: string,
  payload: unknown,
  ttlSec: number
): Promise<void> {
  await setJson(`oauth:code:${hashToken(code)}`, payload, ttlSec);
}

export async function consumeAuthorizationCode<T>(code: string): Promise<T | null> {
  const key = `oauth:code:${hashToken(code)}`;
  const payload = await getJson<T>(key);
  if (payload) {
    await deleteKey(key);
  }
  return payload;
}

export async function storeAccessToken(
  token: string,
  payload: unknown,
  ttlSec: number
): Promise<void> {
  await setJson(`oauth:access:${hashToken(token)}`, payload, ttlSec);
}

export async function getAccessTokenSession<T>(token: string): Promise<T | null> {
  return getJson<T>(`oauth:access:${hashToken(token)}`);
}

export async function storeRefreshToken(
  token: string,
  payload: unknown,
  ttlSec: number
): Promise<void> {
  await setJson(`oauth:refresh:${hashToken(token)}`, payload, ttlSec);
}

export async function consumeRefreshToken<T>(token: string): Promise<T | null> {
  const key = `oauth:refresh:${hashToken(token)}`;
  const payload = await getJson<T>(key);
  if (payload) {
    await deleteKey(key);
  }
  return payload;
}
