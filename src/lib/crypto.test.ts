import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("token encryption", () => {
  it("round-trips a token", () => {
    const token = "ya29.a0AfH6SMB-example-token";
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it("never stores the plaintext", () => {
    expect(encrypt("secret-refresh-token")).not.toContain("secret-refresh-token");
  });

  it("gives different output each time for the same input", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
});
