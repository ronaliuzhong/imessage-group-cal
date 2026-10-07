import AuthenticationServices
import SwiftUI

/// Everything Coucal shows inside a chat. Most people only ever use Group
/// Cal here, so they sign in here too (the app and the extension share the
/// saved sign-in).
struct MessagesRootView: View {
    let model: ChatModel
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        switch model.auth.state {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signedOut:
            SignInPanel(auth: model.auth) {
                Task { await model.signIn(using: webAuthenticationSession) }
            }
        case .unreachable(let message):
            Problem(title: "Can't reach Coucal", message: message) {
                Task { await model.activateAgain() }
            }
        case .signedIn:
            chatScreen
        }
    }

    @ViewBuilder private var chatScreen: some View {
        switch model.screen {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .working(let label):
            ProgressView(label).frame(maxWidth: .infinity, maxHeight: .infinity)
        case .start:
            StartPanel(
                isOneOnOne: model.isOneOnOne,
                existingGroups: model.existingGroups,
                onStart: { model.beginStart() },
                onLink: { group in Task { await model.link(to: group) } }
            )
        case .naming:
            NameGroupForm(
                onStart: { name in Task { await model.startGroup(named: name) } },
                onCancel: { model.cancelStart() }
            )
        case .glance(let availability):
            GlanceView(
                availability: availability,
                participantCount: model.participantCount,
                span: model.span,
                range: model.range,
                canGoBack: model.offset > 0,
                isChangingRange: model.isChangingRange,
                onSpan: { span in Task { await model.setSpan(span) } },
                onMove: { step in Task { await model.move(by: step) } },
                onToday: { Task { await model.goToToday() } },
                onInvite: { Task { await model.sendInvite(for: availability.group) } },
                onRefresh: { Task { await model.load() } },
                onPropose: { start, minutes in model.beginProposal(at: start, minutes: minutes) },
                onOpenPlan: { code, date in Task { await model.openPlan(shareCode: code, date: date) } }
            )
        case .proposing(let start, let minutes):
            ProposeForm(
                initialStart: start,
                initialMinutes: minutes,
                availability: model.lastAvailability,
                onSend: { draft, _ in Task { await model.sendProposal(draft) } },
                onCancel: { model.cancelProposal() }
            )
        case .plan(let plan):
            PlanView(
                plan: plan,
                isAnswering: model.isAnswering,
                onAnswer: { response, justThisDate in Task { await model.answer(response, justThisDate: justThisDate) } },
                onBack: { Task { await model.backToCalendar() } },
                onEdit: { model.beginEdit() }
            )
        case .editing(let plan):
            ProposeForm(
                heading: "Edit plan",
                submitLabel: "Save",
                footnote: "Everyone who's going gets the change in their Google Calendar.",
                initialTitle: plan.title,
                initialLocation: plan.location ?? "",
                initialStart: plan.start,
                initialMinutes: Int(plan.end.timeIntervalSince(plan.start) / 60),
                initialRepeat: plan.repeat,
                repeatingEdit: plan.repeats ? .init(isFirstDate: plan.isFirstDate) : nil,
                availability: model.lastAvailability,
                onSend: { draft, scope in Task { await model.saveEdit(draft, scope: scope) } },
                onCancel: { model.cancelEdit() }
            )
        case .problem(let message):
            Problem(title: "Something went wrong", message: message) {
                Task { await model.load() }
            }
        }
    }
}

private struct SignInPanel: View {
    let auth: AuthModel
    let onSignIn: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text("See when your group is free")
                .font(.headline)
            Text("Connect your Google Calendar. We only ever see busy/free times, never what your events are.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button(action: onSignIn) {
                if auth.isSigningIn {
                    ProgressView()
                } else {
                    Text("Sign in with Google")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(auth.isSigningIn)
            if let error = auth.signInError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct StartPanel: View {
    let isOneOnOne: Bool
    let existingGroups: [GroupListItem]
    let onStart: () -> Void
    let onLink: (GroupListItem) -> Void
    @State private var showingGroups = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Text(isOneOnOne ? "See when you're both free" : "See when this chat is free")
                    .font(.headline)
                Text(isOneOnOne
                    ? "Start Coucal here and send an invite. Once they tap it, you'll both see each other's free/busy times."
                    : "Start Coucal here and send an invite. Everyone who joins shares their free/busy times with the chat.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button("Start Coucal in this chat", action: onStart)
                    .buttonStyle(.borderedProminent)

                Text("Already started? Tap the Coucal invite in this chat to join.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                // Coucal can't tell a brand-new chat from one it doesn't
                // recognize anymore (e.g. after reinstalling), so the way to
                // link an existing group stays tucked behind one small link.
                if !existingGroups.isEmpty && !showingGroups {
                    Button("Link to an existing group") { showingGroups = true }
                        .font(.footnote)
                }
                if showingGroups {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Which group is this chat?")
                            .font(.subheadline.weight(.semibold))
                        ForEach(existingGroups) { group in
                            Button { onLink(group) } label: {
                                HStack {
                                    Text(group.name)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(group.memberCount == 1 ? "1 member" : "\(group.memberCount) members")
                                        .font(.footnote)
                                        .foregroundStyle(.secondary)
                                    Image(systemName: "chevron.right")
                                        .font(.footnote)
                                        .foregroundStyle(.tertiary)
                                }
                                .padding(.vertical, 10)
                                .padding(.horizontal, 12)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Color(uiColor: .secondarySystemBackground)))
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .padding()
            .frame(maxWidth: .infinity)
        }
    }
}

private struct NameGroupForm: View {
    let onStart: (String) -> Void
    let onCancel: () -> Void
    // Messages doesn't tell us the chat's name, so ask, with a default that
    // makes skipping one tap.
    @State private var name = "Group chat"
    @FocusState private var focused: Bool

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Name this group")
                .font(.title3.bold())
            Text("Shown on the Coucal website, to tell your groups apart.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("e.g. Roommates", text: $name)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .submitLabel(.done)
                .onSubmit { if !trimmed.isEmpty { onStart(trimmed) } }
            HStack {
                Button("Cancel", action: onCancel)
                Spacer()
                Button("Start and send invite") { onStart(trimmed) }
                    .buttonStyle(.borderedProminent)
                    .disabled(trimmed.isEmpty)
            }
            Spacer()
        }
        .padding()
        .onAppear { focused = true }
    }
}

private struct Problem: View {
    let title: String
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Try again", action: onRetry)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
