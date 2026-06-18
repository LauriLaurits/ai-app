import crypto from "node:crypto";
import pino from "pino";
import type { AppConfig, AppLogger } from "../types.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null,
});

const sensitiveKeyPattern =
  /authorization|password|passwd|secret|token|card|cvv|iban|refresh/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKeyPattern.test(key) ? "[redacted]" : sanitize(nested),
      ])
    );
  }

  return value;
}

export function hashUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const salt = process.env.LOG_HASH_SALT ?? "";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(userId)}`)
    .digest("hex");
}

export interface LoggerOptions {
  waitUntil?: (promise: Promise<unknown>) => void;
}

export function createAppLogger(config: AppConfig, options: LoggerOptions = {}): AppLogger {
  const runtimeFields = {
    serviceName: config.telemetry.serviceName,
    serviceEnv: config.telemetry.serviceEnv,
    gitSha: config.telemetry.gitSha,
    deploymentUrl: config.telemetry.deploymentUrl,
    vercelEnv: config.telemetry.vercelEnv,
    vercelRegion: config.telemetry.vercelRegion,
  };

  function trackTask(promise: Promise<unknown>): void {
    if (typeof options.waitUntil === "function") {
      options.waitUntil(promise);
      return;
    }

    void promise;
  }

  async function sendToOpenObserve(event: Record<string, unknown>): Promise<void> {
    if (!config.openObserve.ingestUrl) return;

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (config.openObserve.authHeader) {
      headers.Authorization = config.openObserve.authHeader;
    }

    try {
      await fetch(config.openObserve.ingestUrl, {
        method: "POST",
        headers,
        body: JSON.stringify([event]),
      });
    } catch (error) {
      logger.warn(
        {
          event: "openobserve_ingest_failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "OpenObserve ingest failed"
      );
    }
  }

  function emit(
    level: "info" | "warn" | "error",
    eventName: string,
    payload: Record<string, unknown> = {}
  ): void {
    const event = sanitize({
      ts: new Date().toISOString(),
      event: eventName,
      ...runtimeFields,
      ...payload,
    }) as Record<string, unknown>;

    logger[level](event, eventName);
    trackTask(sendToOpenObserve(event));
  }

  return {
    info: (eventName, payload) => emit("info", eventName, payload),
    warn: (eventName, payload) => emit("warn", eventName, payload),
    error: (eventName, payload) => emit("error", eventName, payload),
  };
}
