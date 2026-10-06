import AuthenticationServices
import Messages
import Observation
import SwiftUI

/// What Group Cal shows in one chat, and the actions behind it.
///
/// A chat becomes a group when someone taps "Start Group Cal in this chat":
/// that creates the group and puts an invite bubble in the chat. Everyone else
/// joins by tapping the bubble. After that, opening Group Cal in the chat
/// shows its group at a glance, where anyone can propose a plan: that sends a
/// plan bubble people answer (Going / Can't make it) right in the chat.
@MainActor
@Observable
final class ChatModel {
    enum Screen: Equatable {
        case loading
        /// This chat has no group yet (on this device).
        case start
        /// Typing the new group's name.
        case naming
        case working(String)
        case glance(Availability)
        /// Filling in a plan: its start and length (minutes).
        case proposing(Date, Int)
        /// A plan, opened from its bubble.
        case plan(PlanSummary)
        /// Changing a plan's details.
        case editing(PlanSummary)
        case problem(String)
    }

    /// How much of the calendar the at-a-glance view shows.
    enum Span: String, CaseIterable, Identifiable {
        case day = "Day"
        case week = "Week"
        var id: Self { self }
    }

    let auth = AuthModel()
    private(set) var screen: Screen = .loading
    /// Everyone in the chat, including you.
    private(set) var participantCount = 1
    /// Your groups, offered on the start screen so a chat Group Cal doesn't
    /// recognize can be linked instead of starting a duplicate.
    private(set) var existingGroups: [GroupListItem] = []
    /// The calendar last shown, for "Sam is busy then" while proposing.
    private(set) var lastAvailability: Availability?
    /// Answering Going / Can't make it on the plan screen.
    private(set) var isAnswering = false

    /// Opens on the day; the Day | Week switch is under the calendar.
    private(set) var span: Span = .day
    /// Days (day view) or weeks (week view) from now. Never negative: like
    /// the website, you can look ahead but not back.
    private(set) var offset = 0
    /// Loading a different day or week (the current one stays on screen).
    private(set) var isChangingRange = false

    /// The days on screen: one day, or Sunday through Saturday, in local time.
    var range: DateInterval {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: .now)
        switch span {
        case .day:
            let start = calendar.date(byAdding: .day, value: offset, to: today)!
            return DateInterval(start: start, end: calendar.date(byAdding: .day, value: 1, to: start)!)
        case .week:
            let sunday = calendar.date(byAdding: .day, value: 1 - calendar.component(.weekday, from: today), to: today)!
            let start = calendar.date(byAdding: .day, value: 7 * offset, to: sunday)!
            return DateInterval(start: start, end: calendar.date(byAdding: .day, value: 7, to: start)!)
        }
    }

    /// Hooks to Messages, set by MessagesViewController.
    var requestStyle: @MainActor (MSMessagesAppPresentationStyle) -> Void = { _ in }
    var insertMessage: @MainActor (MSMessage) async throws -> Void = { _ in }
    /// Sends right away (no tap on send), for updating a plan bubble.
    var sendMessage: @MainActor (MSMessage) async throws -> Void = { _ in }

    private let api = APIClient()
    private var conversationKey: String?
    /// Set when Group Cal was opened by tapping an invite bubble.
    private var pendingInviteCode: String?
    /// Set when Group Cal was opened by tapping a plan bubble.
    private var pendingPlanCode: String?
    /// Which date to open a repeating plan on (from its bubble or the calendar).
    private var pendingPlanDate: Date?
    /// The tapped plan bubble's session: sending a message in the same
    /// session replaces the bubble instead of adding a new one.
    private var planSession: MSSession?

    // MARK: Opening

    /// Group Cal opened in a chat (possibly by tapping a bubble).
    func activate(in conversation: MSConversation) async {
        participantCount = conversation.remoteParticipantIdentifiers.count + 1
        conversationKey = ConversationStore.key(for: conversation)
        pendingInviteCode = nil
        pendingPlanCode = nil
        if let message = conversation.selectedMessage { noteBubble(message) }
        await auth.restore()
        await load()
    }

    /// A bubble was tapped while Group Cal was already open.
    func selected(_ message: MSMessage) async {
        guard noteBubble(message) else { return }
        await load()
    }

    /// Remembers what a tapped bubble is (an invite or a plan). Returns false
    /// if it's neither.
    @discardableResult
    private func noteBubble(_ message: MSMessage) -> Bool {
        guard let url = message.url else { return false }
        if let code = Self.inviteCode(in: url) {
            pendingInviteCode = code
            return true
        }
        if let code = Self.planCode(in: url) {
            pendingPlanCode = code
            pendingPlanDate = Self.planDate(in: url)
            planSession = message.session
            return true
        }
        return false
    }

    /// "Try again" after the server couldn't be reached.
    func activateAgain() async {
        await auth.restore()
        await load()
    }

    func signIn(using session: WebAuthenticationSession) async {
        await auth.signIn(using: session)
        await load()
    }

    /// Works out what to show: join from a bubble, this chat's group, or the
    /// "start" screen.
    func load() async {
        guard case .signedIn = auth.state, let token = TokenStore.read() else { return }
        do {
            if let code = pendingPlanCode {
                pendingPlanCode = nil
                let date = pendingPlanDate
                pendingPlanDate = nil
                screen = .working("Opening plan…")
                let plan = try await api.plan(shareCode: code, at: date, token: token)
                // The plan's group is this chat's group, if they're in it.
                if plan.inGroup { remember(plan.groupId) }
                screen = .plan(plan)
            } else if let code = pendingInviteCode {
                screen = .working("Joining…")
                let group = try await api.joinGroup(inviteCode: code, token: token)
                pendingInviteCode = nil
                remember(group.id)
                try await showGlance(groupId: group.id, token: token)
            } else if let key = conversationKey, let groupId = ConversationStore.groupId(for: key) {
                if case .glance = screen {} else { screen = .loading }
                try await showGlance(groupId: groupId, token: token)
            } else {
                // Not recognized (a new chat, or its anonymous IDs changed).
                // Offer their groups too; if that fails, they can still start.
                existingGroups = (try? await api.myGroups(token: token)) ?? []
                screen = .start
            }
        } catch APIError.notSignedIn {
            await auth.signOut()
        } catch APIError.notFound(let message) {
            // A stale invite or plan, or a group they've left: start fresh.
            pendingInviteCode = nil
            pendingPlanCode = nil
            if let key = conversationKey { ConversationStore.forget(key: key) }
            screen = .problem(message)
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    /// "Already have a group for this chat?": link it instead of starting one.
    func link(to group: GroupListItem) async {
        guard let token = TokenStore.read() else { return }
        remember(group.id)
        screen = .loading
        do {
            try await showGlance(groupId: group.id, token: token)
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    // MARK: Starting a group

    /// Everyone in the chat is you and one other person.
    var isOneOnOne: Bool { participantCount == 2 }

    func beginStart() {
        // One-on-one chats don't need a name: it becomes "Rona & Sam" once
        // they join. Send the invite right away.
        if isOneOnOne {
            Task { await startGroup(named: nil) }
            return
        }
        screen = .naming
        // The keyboard only shows in the expanded (full-height) view.
        requestStyle(.expanded)
    }

    func cancelStart() {
        screen = .start
        requestStyle(.compact)
    }

    /// A nil name: named automatically (one-on-one chats).
    func startGroup(named name: String?) async {
        guard let token = TokenStore.read() else { return }
        screen = .working("Starting…")
        do {
            let group = try await api.createGroup(name: name, token: token)
            remember(group.id)
            try await insertInvite(for: group)
            requestStyle(.compact)
            try await showGlance(groupId: group.id, token: token)
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    /// Puts an invite bubble in the message box; the person taps send.
    func sendInvite(for group: GroupSummary) async {
        do {
            try await insertInvite(for: group)
            requestStyle(.compact)
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    // MARK: Proposing a plan

    /// From tapping the calendar (a time), holding and dragging (a time and
    /// length), or the "Propose a time" button (the next hour, 1 hour long).
    func beginProposal(at start: Date? = nil, minutes: Int? = nil) {
        let time = start ?? Calendar.current.nextDate(
            after: .now, matching: DateComponents(minute: 0), matchingPolicy: .nextTime
        )!
        screen = .proposing(time, minutes ?? 60)
        // The keyboard only shows in the expanded (full-height) view.
        requestStyle(.expanded)
    }

    func cancelProposal() {
        requestStyle(.compact)
        if let availability = lastAvailability { screen = .glance(availability) } else { Task { await load() } }
    }

    /// Creates the plan (you're going; it's added to your Google Calendar)
    /// and puts its bubble in the message box for you to send.
    func sendProposal(_ draft: PlanDraft) async {
        guard let token = TokenStore.read(), let groupId = lastAvailability?.group.id else { return }
        screen = .working("Creating plan…")
        do {
            let plan = try await api.proposePlan(groupId: groupId, draft, token: token)
            try await insertMessage(planMessage(for: plan, session: MSSession()))
            requestStyle(.compact)
            try await showGlance(groupId: groupId, token: token)
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    // MARK: Answering a plan

    /// Going / Can't make it. Updates their Google Calendar (on the server)
    /// and the bubble in the chat, so everyone sees who's going.
    /// For repeating plans `justThisDate` answers only the date on screen,
    /// otherwise every date ("all of them").
    func answer(_ response: PlanSummary.Response, justThisDate: Bool = false) async {
        guard case .plan(let current) = screen, let token = TokenStore.read() else { return }
        isAnswering = true
        defer { isAnswering = false }
        do {
            let updated = try await api.answer(
                shareCode: current.shareCode, response, occurrence: current.originalStart,
                justThisDate: justThisDate, token: token
            )
            screen = .plan(updated)
            // Opened from its bubble: update the bubble, so everyone sees
            // who's going. Sending in the bubble's session replaces it; if
            // Messages won't send right away, leave it in the message box.
            if let planSession {
                let message = planMessage(for: updated, session: planSession)
                do { try await sendMessage(message) } catch { try await insertMessage(message) }
            }
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    // MARK: Editing a plan

    func beginEdit() {
        guard case .plan(let plan) = screen else { return }
        screen = .editing(plan)
        // The keyboard only shows in the expanded (full-height) view.
        requestStyle(.expanded)
    }

    func cancelEdit() {
        guard case .editing(let plan) = screen else { return }
        screen = .plan(plan)
    }

    /// Saves the new details (everyone's Google Calendar is updated on the
    /// server) and, if it was opened from its bubble, updates the bubble.
    func saveEdit(_ draft: PlanDraft, scope: EditScope = .all) async {
        guard case .editing(let plan) = screen, let token = TokenStore.read() else { return }
        screen = .working("Saving…")
        do {
            let updated = try await api.editPlan(
                shareCode: plan.shareCode, draft, scope: scope, occurrence: plan.originalStart, token: token
            )
            screen = .plan(updated)
            if let planSession {
                let message = planMessage(for: updated, session: planSession)
                do { try await sendMessage(message) } catch { try await insertMessage(message) }
            }
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    /// Tapping a plan on the calendar or in "Upcoming plans". There's no
    /// bubble to update, so answering there only changes the plan itself.
    func openPlan(shareCode: String, date: Date? = nil) async {
        pendingPlanCode = shareCode
        pendingPlanDate = date
        planSession = nil
        requestStyle(.expanded)
        await load()
    }

    /// From a plan back to the chat's calendar.
    func backToCalendar() async {
        requestStyle(.compact)
        await load()
    }

    // MARK: Helpers

    /// A plan's bubble: its name, when, and how many are going.
    private func planMessage(for plan: PlanSummary, session: MSSession) -> MSMessage {
        let layout = MSMessageTemplateLayout()
        layout.caption = plan.title
        layout.subcaption = plan.repeatLabel.map { "\(PlanTime.describe(plan.start, plan.end)) · ↻ \($0)" }
            ?? PlanTime.describe(plan.start, plan.end)
        layout.trailingSubcaption = plan.going.count == 1 ? "1 going" : "\(plan.going.count) going"
        let message = MSMessage(session: session)
        message.layout = layout
        // The extension recognizes this link; anyone without the app (or on
        // Android) gets the website's plan page instead.
        message.url = plan.url
        message.summaryText = "\(plan.title) · \(PlanTime.describe(plan.start, plan.end))"
        return message
    }

    private func insertInvite(for group: GroupSummary) async throws {
        let layout = MSMessageTemplateLayout()
        // An automatic name ("Rona's chat") would read oddly here.
        let caption = group.autoNamed ? "See when we're both free" : "Join \(group.name) on Group Cal"
        layout.caption = caption
        layout.subcaption = group.autoNamed ? "Tap to join on Group Cal" : "See when everyone's free"
        let message = MSMessage(session: MSSession())
        message.layout = layout
        // The extension recognizes this link; anyone without the app (or on
        // Android) gets the website's join page instead.
        message.url = group.joinUrl
        message.summaryText = caption
        try await insertMessage(message)
    }

    // MARK: Day / week

    func setSpan(_ newSpan: Span) async {
        guard newSpan != span else { return }
        span = newSpan
        offset = 0
        await reloadRange()
    }

    /// ‹ and ›: one day or one week at a time, never before today.
    func move(by step: Int) async {
        let newOffset = max(0, offset + step)
        guard newOffset != offset else { return }
        offset = newOffset
        await reloadRange()
    }

    func goToToday() async {
        guard offset != 0 else { return }
        offset = 0
        await reloadRange()
    }

    /// Loads the new day or week for the group on screen, keeping the current
    /// one visible meanwhile.
    private func reloadRange() async {
        guard case .glance(let current) = screen, let token = TokenStore.read() else { return }
        isChangingRange = true
        defer { isChangingRange = false }
        do {
            try await showGlance(groupId: current.group.id, token: token)
        } catch APIError.notSignedIn {
            await auth.signOut()
        } catch {
            screen = .problem(error.localizedDescription)
        }
    }

    /// The day or week in `range`.
    private func showGlance(groupId: String, token: String) async throws {
        let requested = range
        let availability = try await api.availability(groupId: groupId, from: requested.start, to: requested.end, token: token)
        // Tapping ‹ › quickly: only show the answer for the latest request.
        guard requested == range else { return }
        lastAvailability = availability
        screen = .glance(availability)
    }

    private func remember(_ groupId: String) {
        if let key = conversationKey { ConversationStore.save(groupId: groupId, for: key) }
    }

    /// The invite code in a join link: https://…/join/<code>.
    static func inviteCode(in url: URL) -> String? {
        let parts = url.pathComponents
        return parts.count == 3 && parts[1] == "join" ? parts[2] : nil
    }

    /// The share code in a plan link: https://…/p/<code>.
    /// The date in a plan link (repeating plans): …/p/<code>?at=<ISO date>.
    static func planDate(in url: URL) -> Date? {
        guard let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "at" })?.value
        else { return nil }
        // The server writes times like "2026-10-01T23:00:00.000Z".
        let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        return (try? withFraction.parse(value)) ?? (try? Date.ISO8601FormatStyle().parse(value))
    }

    static func planCode(in url: URL) -> String? {
        let parts = url.pathComponents
        return parts.count == 3 && parts[1] == "p" ? parts[2] : nil
    }
}
