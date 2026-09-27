import Foundation
import Testing
@testable import GroupCal

// The server checks the same example (src/lib/app-auth.test.ts), so passing
// both means the app and server agree on the sign-in math.
struct PKCETests {
    @Test func matchesTheSpecExample() {
        // RFC 7636, Appendix B.
        #expect(PKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
            == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func makesWellFormedSecrets() {
        let pkce = PKCE()
        let urlSafe = /^[A-Za-z0-9_-]+$/
        #expect(pkce.verifier.count == 43)
        #expect(pkce.challenge.count == 43)
        #expect(pkce.verifier.wholeMatch(of: urlSafe) != nil)
        #expect(pkce.challenge.wholeMatch(of: urlSafe) != nil)
        #expect(pkce.challenge == PKCE.challenge(for: pkce.verifier))
    }

    @Test func makesADifferentSecretEachTime() {
        #expect(PKCE().verifier != PKCE().verifier)
    }
}
