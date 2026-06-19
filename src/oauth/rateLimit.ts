import { incrementWithExpiry } from "./storage.js";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limit backed by the shared session store (Redis in
 * production, memory locally). A non-positive limit disables the check.
 */
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  if (limit <= 0) {
    return { allowed: true, count: 0, limit, retryAfterSec: 0 };
  }

  const count = await incrementWithExpiry(`ratelimit:${bucket}:${identifier}`, windowSec);
  return {
    allowed: count <= limit,
    count,
    limit,
    retryAfterSec: count <= limit ? 0 : windowSec,
  };
}
