import { describe, expect, it } from "vitest";
import { generateTempPassword, passwordSchema } from "@/lib/auth/password";

describe("passwordSchema", () => {
  it.each([["abc12", false], ["abcdefgh", false], ["12345678", false], ["abcd1234", true], ["Clave-Segura9", true]])(
    "%s -> %s",
    (pw, ok) => expect(passwordSchema.safeParse(pw).success).toBe(ok),
  );
});

describe("generateTempPassword", () => {
  it("cumple la politica, tiene largo y es distinta cada vez", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(14);
      expect(passwordSchema.safeParse(p).success).toBe(true);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
