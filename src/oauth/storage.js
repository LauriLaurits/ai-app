import crypto from "node:crypto";
import { config } from "../config.js";

const memoryStore = new Map();

function namespaced(key) {
  return `${config.broker.storageNamespace}:${key}`;
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString("base64url")}`;
}

async function redisCommand(args) {
  if (!config.storage.upstashUrl || !config.storage.upstashToken) {
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

  const body = await response.json();
  if (body?.error) {
    throw new Error(`Redis command failed: ${body.error}`);
  }

  return body?.result ?? null;
}

function memoryCleanup(key) {
  const record = memoryStore.get(key);
  if (!record) return null;

  if (record.expiresAt <= Date.now()) {
    memoryStore.delete(key);
    return null;
  }

  return record.value;
}

export async function setJson(key, value, ttlSec) {
  const safeKey = namespaced(key);

  if (config.storage.upstashUrl && config.storage.upstashToken) {
    await redisCommand(["SET", safeKey, JSON.stringify(value), "EX", String(ttlSec)]);
    return;
  }

  memoryStore.set(safeKey, {
    value,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

export async function getJson(key) {
  const safeKey = namespaced(key);

  if (config.storage.upstashUrl && config.storage.upstashToken) {
    const value = await redisCommand(["GET", safeKey]);
    return value ? JSON.parse(value) : null;
  }

  return memoryCleanup(safeKey);
}

export async function deleteKey(key) {
  const safeKey = namespaced(key);

  if (config.storage.upstashUrl && config.storage.upstashToken) {
    await redisCommand(["DEL", safeKey]);
    return;
  }

  memoryStore.delete(safeKey);
}

export async function storeAuthorizationCode(code, payload, ttlSec) {
  await setJson(`oauth:code:${hashToken(code)}`, payload, ttlSec);
}

export async function consumeAuthorizationCode(code) {
  const key = `oauth:code:${hashToken(code)}`;
  const payload = await getJson(key);
  if (payload) {
    await deleteKey(key);
  }
  return payload;
}

export async function storeAccessToken(token, payload, ttlSec) {
  await setJson(`oauth:access:${hashToken(token)}`, payload, ttlSec);
}

export async function getAccessTokenSession(token) {
  return getJson(`oauth:access:${hashToken(token)}`);
}

export async function storeRefreshToken(token, payload, ttlSec) {
  await setJson(`oauth:refresh:${hashToken(token)}`, payload, ttlSec);
}

export async function consumeRefreshToken(token) {
  const key = `oauth:refresh:${hashToken(token)}`;
  const payload = await getJson(key);
  if (payload) {
    await deleteKey(key);
  }
  return payload;
}
