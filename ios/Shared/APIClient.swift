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

struct GroupSummary: Codable, Equatable, Sendable {
    let id: String
    let name: String
    /// Nobody typed a name (one-on-one chats): it's made from members' first
    /// names, like "Rona & Sam".
    let autoNamed: Bool
    let inviteCode: String
    /// Goes behind the invite bubble (the website's join page).
    let joinUrl: URL
}

private struct GroupResponse: Decodable {
    let group: GroupSummary
}

/// GET /api/app/groups/:id/availability
struct Availability: Decodable, Equatable, Sendable {
    struct Member: Decodable, Equatable, Sendable, Identifiable {
        let id: String
        let name: String
        let isYou: Bool
        /// False if we can't read their calendar ("Waiting for...").
        let connected: Bool
    }

    /// A stretch of time in which the same people are busy.
    struct Segment: Decodable, Equatable, Sendable {
        let start: Date
        let end: Date
        let busyMemberIds: [String]
    }

    let group: GroupSummary
    let members: [Member]
    let segments: [Segment]
}

enum APIError: LocalizedError {
    /// The token is missing, wrong or signed out.
    case notSignedIn
    /// The group (or invite) doesn't exist, or you're not in it.
    case notFound(String)
    /// The server said no, with a message meant for people.
    case server(String)
    case badResponse

    var errorDescription: String? {
        switch self {
        case .notSignedIn: "You're signed out. Please sign in again."
        case .notFound(let message), .server(let message): message
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

    /// "Start Group Cal in this chat". A nil name lets the server name it from
    /// members' first names (for one-on-one chats).
    func createGroup(name: String?, token: String) async throws -> GroupSummary {
        struct Body: Encodable {
            let name: String?
            let autoName: Bool?
        }
        let body = Body(name: name, autoName: name == nil ? true : nil)
        let response: GroupResponse = try await send(postJSON("api/app/groups", body, token: token))
        return response.group
    }

    /// Tapping an invite bubble. Joining twice is fine.
    func joinGroup(inviteCode: String, token: String) async throws -> GroupSummary {
        let response: GroupResponse = try await send(postJSON("api/app/groups/join", ["inviteCode": inviteCode], token: token))
        return response.group
    }

    /// Who's in the group and when they're busy between `start` and `end`.
    func availability(groupId: String, from start: Date, to end: Date, token: String) async throws -> Availability {
        let iso = Date.ISO8601FormatStyle()
        var url = baseURL.appending(path: "api/app/groups/\(groupId)/availability")
        url.append(queryItems: [
            URLQueryItem(name: "start", value: start.formatted(iso)),
            URLQueryItem(name: "end", value: end.formatted(iso)),
        ])
        return try await send(authorized(URLRequest(url: url), token: token))
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

    private func postJSON(_ path: String, _ body: some Encodable, token: String) throws -> URLRequest {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return authorized(request, token: token)
    }

    /// The server sends times like "2026-09-27T19:30:00.000Z".
    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            return try Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(text)
        }
        return decoder
    }()

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse }
        if http.statusCode == 401 { throw APIError.notSignedIn }
        guard (200..<300).contains(http.statusCode) else {
            // The server's errors look like { "error": "…" }.
            let message = try? JSONDecoder().decode([String: String].self, from: data)["error"]
            if http.statusCode == 404 { throw APIError.notFound(message ?? "Not found.") }
            throw message.map(APIError.server) ?? APIError.badResponse
        }
        return try Self.decoder.decode(T.self, from: data)
    }
}
