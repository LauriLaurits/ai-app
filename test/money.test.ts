import { describe, expect, it } from "vitest";
import { money, toMajorUnits } from "../src/money.js";

describe("money normalization", () => {
  it("converts 2-decimal currencies from minor units", () => {
    expect(toMajorUnits(29731, "EUR")).toBe(297.31);
    expect(toMajorUnits(180, "EUR")).toBe(1.8);
    expect(toMajorUnits(2500, "USD")).toBe(25);
  });

  it("leaves zero-decimal currencies untouched", () => {
    expect(toMajorUnits(1500, "JPY")).toBe(1500);
  });

  it("handles three-decimal currencies", () => {
    expect(toMajorUnits(1234, "BHD")).toBe(1.234);
  });

  it("builds a Money object with an uppercased currency and default EUR", () => {
    expect(money(29731, "eur")).toEqual({ amount: 297.31, currency: "EUR" });
    expect(money(500, undefined)).toEqual({ amount: 5, currency: "EUR" });
  });

  it("coerces string and missing amounts", () => {
    expect(money("29731", "EUR")).toEqual({ amount: 297.31, currency: "EUR" });
    expect(money(undefined, "EUR")).toEqual({ amount: 0, currency: "EUR" });
  });

  it("rounds fractional minor units to the currency exponent", () => {
    expect(money(735.3, "eur")).toEqual({ amount: 7.35, currency: "EUR" });
    expect(money(735.5, "eur")).toEqual({ amount: 7.36, currency: "EUR" });
    expect(money(1500.6, "jpy")).toEqual({ amount: 1501, currency: "JPY" });
    expect(money(1234.4, "bhd")).toEqual({ amount: 1.234, currency: "BHD" });
  });

  it("keeps whole minor units exact", () => {
    expect(money(29731, "eur")).toEqual({ amount: 297.31, currency: "EUR" });
  });

  it("rounds exact half minor units without floating point drift", () => {
    expect(money(29021.5, "eur")).toEqual({ amount: 290.22, currency: "EUR" });
  });
});
