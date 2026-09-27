import CryptoKit
import Foundation

/// A fresh secret for one sign-in (see src/lib/app-auth.ts on the server).
/// The challenge goes to the sign-in page; the verifier stays in the app
/// until it trades the one-time code for a token, proving the code is ours.
struct PKCE {
    let verifier: String
    let challenge: String

    init() {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "Couldn't generate random bytes")
        verifier = Data(bytes).base64URLEncodedString()
        challenge = PKCE.challenge(for: verifier)
    }

    /// SHA-256 of the verifier, base64url-encoded (the PKCE "S256" method).
    static func challenge(for verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()
    }
}

extension Data {
    /// Base64 with URL-safe characters and no "=" padding.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
