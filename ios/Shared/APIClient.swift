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

/// One of your groups, from GET /api/app/groups.
struct GroupListItem: Decodable, Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let autoNamed: Bool
    let inviteCode: String
    let joinUrl: URL
    let memberCount: Int
}

private struct GroupListResponse: Decodable {
    let groups: [GroupListItem]
}

/// A plan, from the viewer's side (GET /api/app/plans/:code and friends).
struct PlanSummary: Decodable, Equatable, Sendable {
    struct Person: Decodable, Equatable, Sendable, Identifiable {
        let id: String
        let name: String
        let isYou: Bool
    }

    enum Response: String, Decodable, Sendable {
        case going = "GOING"
        case notGoing = "NOT_GOING"
    }

    let id: String
    let shareCode: String
    let title: String
    let start: Date
    let end: Date
    let location: String?
    let notes: String?
    let groupId: String
    let groupName: String
    /// Whether you're in the plan's group.
    let inGroup: Bool
    /// Repeating plans are answered on the website.
    let repeats: Bool
    let cancelled: Bool
    let going: [Person]
    let notGoing: [Person]
    let myResponse: Response?
    /// Goes behind the plan bubble (the website's plan page).
    let url: URL
}

private struct PlanResponse: Decodable {
    let plan: PlanSummary
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

    /// A plan (or one date of a repeating plan) in the group.
    struct Plan: Decodable, Equatable, Sendable, Identifiable {
        struct Color: Decodable, Equatable, Sendable {
            /// "#8E24AA": your color for the group.
            let hex: String
            /// A text color that stays readable on top of `hex`.
            let text: String
        }

        /// Unique per date: "<plan id>:<date>".
        let id: String
        let shareCode: String
        let title: String
        let start: Date
        let end: Date
        let location: String?
        /// e.g. "Weekly on Thursday"; nil if it doesn't repeat.
        let repeatLabel: String?
        let color: Color
        let goingCount: Int
        let myResponse: PlanSummary.Response?
    }

    let group: GroupSummary
    let members: [Member]
    let segments: [Segment]
    /// Plans in the day or week on screen.
    let plans: [Plan]
    /// The next few plans (up to a month ahead).
    let upcoming: [Plan]
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

    /// Your groups, most recently joined first.
    func myGroups(token: String) async throws -> [GroupListItem] {
        let response: GroupListResponse = try await send(authorized(URLRequest(url: baseURL.appending(path: "api/app/groups")), token: token))
        return response.groups
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

    /// Proposes a (one-time) plan in a group. You're marked as going and it's
    /// added to your Google Calendar.
    func proposePlan(
        groupId: String, title: String, start: Date, durationMinutes: Int, location: String, token: String
    ) async throws -> PlanSummary {
        struct Body: Encodable {
            let title: String
            let start: String
            let durationMinutes: Int
            let location: String
            let timeZone: String
        }
        let body = Body(
            title: title,
            start: start.formatted(Date.ISO8601FormatStyle()),
            durationMinutes: durationMinutes,
            location: location,
            timeZone: TimeZone.current.identifier
        )
        let response: PlanResponse = try await send(postJSON("api/app/groups/\(groupId)/plans", body, token: token))
        return response.plan
    }

    /// Edits a (one-time) plan. Everyone's Google Calendar is updated.
    func editPlan(
        shareCode: String, title: String, start: Date, durationMinutes: Int, location: String, token: String
    ) async throws -> PlanSummary {
        struct Body: Encodable {
            let title: String
            let start: String
            let durationMinutes: Int
            let location: String
        }
        let body = Body(
            title: title, start: start.formatted(Date.ISO8601FormatStyle()),
            durationMinutes: durationMinutes, location: location
        )
        var request = try postJSON("api/app/plans/\(shareCode)", body, token: token)
        request.httpMethod = "PATCH"
        let response: PlanResponse = try await send(request)
        return response.plan
    }

    func plan(shareCode: String, token: String) async throws -> PlanSummary {
        let response: PlanResponse = try await send(
            authorized(URLRequest(url: baseURL.appending(path: "api/app/plans/\(shareCode)")), token: token)
        )
        return response.plan
    }

    /// Going / Can't make it. Updates your Google Calendar to match.
    func answer(shareCode: String, _ answer: PlanSummary.Response, token: String) async throws -> PlanSummary {
        let response: PlanResponse = try await send(
            postJSON("api/app/plans/\(shareCode)/rsvp", ["response": answer.rawValue], token: token)
        )
        return response.plan
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
