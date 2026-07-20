import { describe, it, expect } from "vitest";
import { CLIENT_VERSION } from "./index";

describe("client", () => {
  it("exports CLIENT_VERSION", () => {
    expect(CLIENT_VERSION).toBeDefined();
    expect(typeof CLIENT_VERSION).toBe("string");
  });
});
