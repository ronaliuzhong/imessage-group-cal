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
    /// Goes behind the plan bubble (the website's plan page, on this date).
    let url: URL
    /// Which date of a repeating plan this is (its start as first planned).
    let originalStart: Date
    /// The plan's first date (where "this and following" is the same as all).
    let isFirstDate: Bool
    /// e.g. "Weekly on Thursday · 5 times"; nil if it doesn't repeat.
    let repeatLabel: String?
    /// How it repeats, for editing; nil if it doesn't.
    let `repeat`: RepeatRule?
}

/// For repeating plans: which dates an edit applies to.
enum EditScope: String, Sendable {
    /// Just the date being viewed.
    case this
    /// It and every later date (continues as a new plan).
    case following
    case all
}

/// A plan being proposed or edited.
struct PlanDraft: Equatable, Sendable {
    var title: String
    var start: Date
    var durationMinutes: Int
    var location: String
    var `repeat`: RepeatRule?
}

/// A plan's details as the server expects them.
private struct PlanBody: Encodable {
    let title: String
    let start: String
    let durationMinutes: Int
    let location: String
    let timeZone: String
    /// Always sent (null = doesn't repeat), so an edit can stop a repeat.
    let `repeat`: RepeatRule?
    var scope: String?
    var occurrence: String?

    init(_ draft: PlanDraft) {
        title = draft.title
        start = draft.start.formatted(Date.ISO8601FormatStyle())
        durationMinutes = draft.durationMinutes
        location = draft.location
        timeZone = TimeZone.current.identifier
        self.repeat = draft.repeat
    }

    enum CodingKeys: String, CodingKey {
        case title, start, durationMinutes, location, timeZone, `repeat`, scope, occurrence
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(start, forKey: .start)
        try c.encode(durationMinutes, forKey: .durationMinutes)
        try c.encode(location, forKey: .location)
        try c.encode(timeZone, forKey: .timeZone)
        try c.encode(self.repeat, forKey: .repeat) // null when it doesn't repeat
        try c.encodeIfPresent(scope, forKey: .scope)
        try c.encodeIfPresent(occurrence, forKey: .occurrence)
    }
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
        /// Which date of the plan this is (its start as first planned).
        let originalStart: Date
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
        case .badResponse: "Something went wrong talking to Coucal."
        }
    }
}

/// Talks to the Coucal server's app endpoints (src/app/api/app/).
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

    /// "Start Coucal in this chat". A nil name lets the server name it from
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

    /// Proposes a plan in a group (optionally repeating). You're marked as
    /// going and it's added to your Google Calendar.
    func proposePlan(groupId: String, _ draft: PlanDraft, token: String) async throws -> PlanSummary {
        let response: PlanResponse = try await send(
            postJSON("api/app/groups/\(groupId)/plans", PlanBody(draft), token: token)
        )
        return response.plan
    }

    /// Edits a plan. For repeating plans `scope` says which dates and
    /// `occurrence` is the date being edited. Everyone's Google Calendar is
    /// updated. ("This and following" comes back as a new plan.)
    func editPlan(
        shareCode: String, _ draft: PlanDraft, scope: EditScope = .all, occurrence: Date? = nil, token: String
    ) async throws -> PlanSummary {
        var body = PlanBody(draft)
        body.scope = scope.rawValue
        body.occurrence = occurrence?.formatted(Date.ISO8601FormatStyle())
        var request = try postJSON("api/app/plans/\(shareCode)", body, token: token)
        request.httpMethod = "PATCH"
        let response: PlanResponse = try await send(request)
        return response.plan
    }

    /// A plan, on a given date if it repeats (else its next date).
    func plan(shareCode: String, at date: Date? = nil, token: String) async throws -> PlanSummary {
        var url = baseURL.appending(path: "api/app/plans/\(shareCode)")
        if let date {
            url.append(queryItems: [URLQueryItem(name: "at", value: date.formatted(Date.ISO8601FormatStyle()))])
        }
        let response: PlanResponse = try await send(authorized(URLRequest(url: url), token: token))
        return response.plan
    }

    /// Going / Can't make it. For repeating plans: `justThisDate` answers only
    /// `occurrence`, otherwise every date. Updates your Google Calendar.
    func answer(
        shareCode: String, _ answer: PlanSummary.Response, occurrence: Date? = nil, justThisDate: Bool = false,
        token: String
    ) async throws -> PlanSummary {
        struct Body: Encodable {
            let response: String
            let occurrence: String?
            let scope: String
        }
        let body = Body(
            response: answer.rawValue,
            occurrence: occurrence?.formatted(Date.ISO8601FormatStyle()),
            scope: justThisDate ? "this" : "all"
        )
        let response: PlanResponse = try await send(postJSON("api/app/plans/\(shareCode)/rsvp", body, token: token))
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
