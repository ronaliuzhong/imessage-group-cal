import AuthenticationServices
import Messages
import Observation
import SwiftUI

/// What Group Cal shows in one chat, and the actions behind it.
///
/// A chat becomes a group when someone taps "Start Group Cal in this chat":
/// that creates the group and puts an invite bubble in the chat. Everyone else
/// joins by tapping the bubble. After that, opening Group Cal in the chat
/// shows its group at a glance.
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

    /// Opens on the week; the Day | Week switch is under the calendar.
    private(set) var span: Span = .week
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

    private let api = APIClient()
    private var conversationKey: String?
    /// Set when Group Cal was opened by tapping an invite bubble.
    private var pendingInviteCode: String?

    // MARK: Opening

    /// Group Cal opened in a chat (possibly by tapping a bubble).
    func activate(in conversation: MSConversation) async {
        participantCount = conversation.remoteParticipantIdentifiers.count + 1
        conversationKey = ConversationStore.key(for: conversation)
        pendingInviteCode = conversation.selectedMessage?.url.flatMap(Self.inviteCode(in:))
        await auth.restore()
        await load()
    }

    /// A bubble was tapped while Group Cal was already open.
    func selected(_ message: MSMessage) async {
        guard let code = message.url.flatMap(Self.inviteCode(in:)) else { return }
        pendingInviteCode = code
        await load()
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
            if let code = pendingInviteCode {
                screen = .working("Joining…")
                let group = try await api.joinGroup(inviteCode: code, token: token)
                pendingInviteCode = nil
                remember(group.id)
                try await showGlance(groupId: group.id, token: token)
            } else if let key = conversationKey, let groupId = ConversationStore.groupId(for: key) {
                if case .glance = screen {} else { screen = .loading }
                try await showGlance(groupId: groupId, token: token)
            } else {
                screen = .start
            }
        } catch APIError.notSignedIn {
            await auth.signOut()
        } catch APIError.notFound(let message) {
            // A stale invite, or a group they've left: start fresh.
            pendingInviteCode = nil
            if let key = conversationKey { ConversationStore.forget(key: key) }
            screen = .problem(message)
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

    // MARK: Helpers

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
}
