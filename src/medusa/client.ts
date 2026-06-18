import type { AppConfig } from "../types.js";

export class MedusaRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "MedusaRequestError";
    this.status = status;
  }
}

export class MedusaAuthError extends MedusaRequestError {
  constructor(message = "Medusa session is no longer valid") {
    super(message, 401);
    this.name = "MedusaAuthError";
  }
}

export interface MedusaCustomer {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  [key: string]: unknown;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function assertMedusaConfigured(config: AppConfig): void {
  const missing: string[] = [];
  if (!config.medusa.baseUrl) missing.push("MEDUSA_BASE_URL");
  if (!config.medusa.publishableKey) missing.push("MEDUSA_PUBLISHABLE_KEY");

  if (missing.length > 0) {
    throw new Error(`Missing Medusa configuration: ${missing.join(", ")}`);
  }
}

export async function medusaRequest<T>(
  config: AppConfig,
  path: string,
  medusaToken: string | null,
  init: RequestInit = {}
): Promise<T> {
  assertMedusaConfigured(config);

  const response = await fetch(`${normalizeBaseUrl(config.medusa.baseUrl)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-publishable-api-key": config.medusa.publishableKey,
      ...(medusaToken ? { authorization: `Bearer ${medusaToken}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const bodyText = await response.text();
  let body: unknown = null;
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      `Medusa request failed with status ${response.status}`;

    if (response.status === 401) {
      throw new MedusaAuthError(message);
    }
    throw new MedusaRequestError(message, response.status);
  }

  return body as T;
}

export async function loginCustomer(
  config: AppConfig,
  email: string,
  password: string
): Promise<string> {
  const body = await medusaRequest<{ token?: string }>(
    config,
    "/auth/customer/emailpass",
    null,
    { method: "POST", body: JSON.stringify({ email, password }) }
  );

  if (!body?.token) {
    throw new Error("Medusa did not return a customer token.");
  }

  return body.token;
}

export async function refreshCustomerToken(
  config: AppConfig,
  medusaToken: string
): Promise<string> {
  const body = await medusaRequest<{ token?: string }>(
    config,
    "/auth/token/refresh",
    medusaToken,
    { method: "POST" }
  );

  if (!body?.token) {
    throw new MedusaAuthError("Medusa did not return a refreshed token.");
  }

  return body.token;
}

export async function fetchCustomerProfile(
  config: AppConfig,
  medusaToken: string
): Promise<MedusaCustomer> {
  const body = await medusaRequest<{ customer?: MedusaCustomer }>(
    config,
    "/store/customers/me",
    medusaToken
  );
  return body?.customer ?? {};
}

export function customerDisplayName(customer: MedusaCustomer): string {
  const parts = [customer.first_name, customer.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Customer";
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !String(email).includes("@")) return null;
  const [name = "", domain = ""] = String(email).split("@");
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(name.length - visible.length, 3))}@${domain}`;
}
