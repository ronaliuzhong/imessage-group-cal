import Foundation

struct AppUser: Decodable, Equatable, Sendable {
    let id: String
    let name: String
    let email: String
}

/// GET /api/app/me
struct Me: Decodable, Equatable, Sendable {
    let user: AppUser
    let calendarConnected: Bool
}

/// POST /api/app/token
private struct TokenResponse: Decodable {
    let token: String
    let user: AppUser
}

enum APIError: LocalizedError {
    /// The token is missing, wrong or signed out.
    case notSignedIn
    /// The server said no, with a message meant for people.
    case server(String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .notSignedIn: "You're signed out. Please sign in again."
        case .server(let message): message
        case .badResponse: "Something went wrong talking to Group Cal."
        }
    }
}

/// Talks to the Group Cal server's app endpoints (src/app/api/app/).
struct APIClient {
    var baseURL = Config.apiBaseURL

    /// Trades a sign-in's one-time code (plus its PKCE verifier) for a token.
    func exchange(code: String, verifier: String) async throws -> String {
        var request = URLRequest(url: baseURL.appending(path: "api/app/token"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["code": code, "verifier": verifier])
        let response: TokenResponse = try await send(request)
        return response.token
    }

    func me(token: String) async throws -> Me {
        try await send(authorized(URLRequest(url: baseURL.appending(path: "api/app/me")), token: token))
    }

    /// Signs this device out on the server. Failures are ignored: the app
    /// forgets the token either way.
    func signOut(token: String) async {
        var request = URLRequest(url: baseURL.appending(path: "api/app/token"))
        request.httpMethod = "DELETE"
        _ = try? await URLSession.shared.data(for: authorized(request, token: token))
    }

    private func authorized(_ request: URLRequest, token: String) -> URLRequest {
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        if http.statusCode == 401 { throw APIError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            // The server's errors look like { "error": "…" }.
            let message = try? JSONDecoder().decode([String: String].self, from: data)["error"]
            throw message.map(APIError.server) ?? APIError.badResponse
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
