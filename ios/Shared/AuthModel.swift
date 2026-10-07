import AuthenticationServices
import Foundation
import Observation
import SwiftUI // for WebAuthenticationSession

/// Whether the app is signed in, and signing in and out.
@MainActor
@Observable
final class AuthModel {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn(Me)
        /// Has a token but couldn't reach the server (e.g. offline).
        case unreachable(String)
    }

    private(set) var state: State = .loading
    /// Shown under the sign-in button when a sign-in fails.
    private(set) var signInError: String?
    private(set) var isSigningIn = false

    private let api = APIClient()

    /// On launch: pick up where we left off if there's a saved token.
    func restore() async {
        guard let token = TokenStore.read() else {
            state = .signedOut
            return
        }
        do {
            state = .signedIn(try await api.me(token: token))
        } catch APIError.notSignedIn {
            TokenStore.delete()
            state = .signedOut
        } catch {
            state = .unreachable(error.localizedDescription)
        }
    }

    /// Opens the sign-in page in a secure browser window (see
    /// src/lib/app-auth.ts), then trades the code it returns for a token.
    func signIn(using session: WebAuthenticationSession) async {
        signInError = nil
        isSigningIn = true
        defer { isSigningIn = false }

        let pkce = PKCE()
        var page = URLComponents(url: Config.apiBaseURL.appending(path: "app-auth"), resolvingAgainstBaseURL: false)!
        page.queryItems = [URLQueryItem(name: "challenge", value: pkce.challenge)]

        do {
            let callback = try await session.authenticate(
                using: page.url!,
                callback: .customScheme(Config.callbackScheme),
                // A fresh browser each time: no leftover sign-ins, so people
                // always pick which Google account to use.
                preferredBrowserSession: .ephemeral,
                additionalHeaderFields: [:]
            )
            guard let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value
            else { throw APIError.badResponse }

            let token = try await api.exchange(code: code, verifier: pkce.verifier)
            TokenStore.save(token)
            state = .signedIn(try await api.me(token: token))
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // They closed the window: nothing to report.
        } catch {
            signInError = error.localizedDescription
        }
    }

    /// Deletes the account on the server, then forgets the sign-in here.
    /// Returns an error message if it didn't work.
    func deleteAccount() async -> String? {
        guard let token = TokenStore.read() else { return nil }
        do {
            try await api.deleteAccount(token: token)
        } catch APIError.notSignedIn {
            // Already gone on the server.
        } catch {
            return error.localizedDescription
        }
        TokenStore.delete()
        state = .signedOut
        return nil
    }

    func signOut() async {
        if let token = TokenStore.read() {
            await api.signOut(token: token)
        }
        TokenStore.delete()
        state = .signedOut
    }
}

enum DeleteAccount {
    /// What deleting does, shown before confirming (matches the privacy policy).
    static let explanation = """
        This deletes your account and answers, removes the Coucal calendar from your Google Calendar, \
        and removes groups where you're the last member. Plans you proposed stay for the rest of the group. \
        It can't be undone.
        """
}
