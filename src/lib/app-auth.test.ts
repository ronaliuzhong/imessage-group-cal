import { describe, expect, it } from "vitest";
import { isValidChallenge, sha256, verifierMatches } from "./app-auth";

// The example from the PKCE spec (RFC 7636, Appendix B), which is what the
// iOS app's code has to agree with.
const SPEC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const SPEC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE", () => {
  it("hashes a verifier into its challenge like the spec", () => {
    expect(sha256(SPEC_VERIFIER)).toBe(SPEC_CHALLENGE);
  });

  it("matches only the right verifier", () => {
    expect(verifierMatches(SPEC_VERIFIER, SPEC_CHALLENGE)).toBe(true);
    expect(verifierMatches(SPEC_VERIFIER + "x", SPEC_CHALLENGE)).toBe(false);
    expect(verifierMatches(SPEC_VERIFIER, "short")).toBe(false);
  });

  it("accepts only well-formed challenges", () => {
    expect(isValidChallenge(SPEC_CHALLENGE)).toBe(true);
    expect(isValidChallenge("too-short")).toBe(false);
    expect(isValidChallenge(SPEC_CHALLENGE.slice(0, 42) + "!")).toBe(false);
    expect(isValidChallenge(undefined)).toBe(false);
    expect(isValidChallenge(["an", "array"])).toBe(false);
  });
});
