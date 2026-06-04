import crypto from "node:crypto";
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: null,
});

const sensitiveKeyPattern =
  /authorization|password|passwd|secret|token|card|cvv|iban|refresh/i;

function sanitize(value) {
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

export function hashUserId(userId) {
  if (!userId) return null;
  const salt = process.env.LOG_HASH_SALT ?? "";
  return crypto
    .createHash("sha256")
    .update(`${salt}:${String(userId)}`)
    .digest("hex");
}

export function createAppLogger(config, options = {}) {
  const runtimeFields = {
    serviceName: config.telemetry.serviceName,
    serviceEnv: config.telemetry.serviceEnv,
    gitSha: config.telemetry.gitSha,
    deploymentUrl: config.telemetry.deploymentUrl,
    vercelEnv: config.telemetry.vercelEnv,
    vercelRegion: config.telemetry.vercelRegion,
  };

  function trackTask(promise) {
    if (typeof options.waitUntil === "function") {
      options.waitUntil(promise);
      return;
    }

    void promise;
  }

  async function sendToOpenObserve(event) {
    if (!config.openObserve.ingestUrl) return;

    const headers = {
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

  function emit(level, eventName, payload = {}) {
    const event = sanitize({
      ts: new Date().toISOString(),
      event: eventName,
      ...runtimeFields,
      ...payload,
    });

    logger[level](event, eventName);
    trackTask(sendToOpenObserve(event));
  }

  return {
    info: (eventName, payload) => emit("info", eventName, payload),
    warn: (eventName, payload) => emit("warn", eventName, payload),
    error: (eventName, payload) => emit("error", eventName, payload),
  };
}
