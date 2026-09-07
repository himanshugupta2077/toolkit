import { describe, expect, it } from "vitest";
import { ApiError } from "../api/http.ts";
import { apiErrorText, LAPTOP_DOWN, laptopErrorText } from "./copy.ts";

describe("error copy", () => {
  it("prefers the API error string, then issues, then HTTP status", () => {
    expect(apiErrorText(new ApiError(400, { error: "Name is required." }))).toBe(
      "Name is required.",
    );
    expect(
      apiErrorText(new ApiError(400, { issues: [{ message: "from = to" }] })),
    ).toBe("from = to");
    expect(apiErrorText(new ApiError(503, null))).toBe("HTTP 503");
    expect(apiErrorText(new Error("boom"))).toBe("boom");
  });

  it("says the laptop is down when the phone cannot reach /api", () => {
    expect(laptopErrorText(new Error("Failed to fetch"))).toBe(LAPTOP_DOWN);
    expect(laptopErrorText(new ApiError(503, null))).toBe(LAPTOP_DOWN);
    expect(laptopErrorText(new ApiError(401, { error: "Not on this tailnet." }))).toBe(
      `${LAPTOP_DOWN} Not on this tailnet.`,
    );
  });
});
