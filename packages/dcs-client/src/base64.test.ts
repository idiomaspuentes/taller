import { describe, expect, it } from "vitest";
import { encodeBase64, decodeBase64 } from "./base64.js";

describe("base64", () => {
  it("round-trips plain ASCII", () => {
    expect(decodeBase64(encodeBase64("hello world"))).toBe("hello world");
  });

  it("round-trips UTF-8 (accented/non-Latin1 characters)", () => {
    const text = "Traducción bíblica — café, niño, 日本語";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it("round-trips markdown-shaped content", () => {
    const text = "# Lección 1\n\n- IF score >= 70 THEN pass\n- año, mañana";
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });
});
