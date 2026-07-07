import type { Money } from "./types.js";

// Medusa returns monetary amounts in the currency's minor units (e.g. 29731 =
// €297.31, 2500 = $25.00). The number of minor-unit digits is currency
// dependent, so normalize using ISO 4217 exponents.
const ZERO_DECIMAL = new Set([
  "JPY",
  "KRW",
  "VND",
  "CLP",
  "ISK",
  "HUF",
  "XOF",
  "XAF",
  "PYG",
  "RWF",
  "UGX",
  "VUV",
  "GNF",
]);

const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "TND", "JOD", "IQD", "LYD"]);

export function minorUnitExponent(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

export function toMajorUnits(amount: number, currency: string): number {
  const exponent = minorUnitExponent(currency);
  const factor = 10 ** exponent;
  // Medusa can produce fractional minor units (tax/discount math); round the
  // minor units first so exact halves round half-up without FP drift.
  return Math.round(amount) / factor;
}

export function money(amount: unknown, currencyCode: unknown): Money {
  const currency = String(currencyCode ?? "EUR").toUpperCase();
  return {
    amount: toMajorUnits(toNumber(amount), currency),
    currency,
  };
}
