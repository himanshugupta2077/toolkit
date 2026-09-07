import { describe, expect, it } from "vitest";
import { appBasename, withBase } from "./basePath.ts";

describe("basePath", () => {
  it("is empty in tests so /api stays /api", () => {
    expect(appBasename()).toBe("");
    expect(withBase("/api/health")).toBe("/api/health");
    expect(withBase("/home")).toBe("/home");
  });
});
