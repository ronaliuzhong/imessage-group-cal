import AuthenticationServices
import SwiftUI

/// The home-screen app. Deliberately minimal (see ROADMAP.md): for now it
/// signs you in and shows whether your calendar is connected.
struct ContentView: View {
    @State private var auth = AuthModel()
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        NavigationStack {
            Group {
                switch auth.state {
                case .loading:
                    ProgressView()
                case .signedOut:
                    SignInView(auth: auth) {
                        Task { await auth.signIn(using: webAuthenticationSession) }
                    }
                case .signedIn(let me):
                    SignedInView(
                        me: me,
                        onSignOut: { Task { await auth.signOut() } },
                        onDeleteAccount: { await auth.deleteAccount() }
                    )
                case .unreachable(let message):
                    ContentUnavailableView {
                        Label("Can't reach Coucal", systemImage: "wifi.slash")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await auth.restore() } }
                    }
                }
            }
            .navigationTitle("Coucal")
        }
        .task { await auth.restore() }
    }
}

private struct SignInView: View {
    let auth: AuthModel
    let onSignIn: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 64))
                .foregroundStyle(.green)
            Text("See when your group is free")
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            Text("Connect your Google Calendar. We only ever see busy/free times, never what your events are.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button(action: onSignIn) {
                Group {
                    if auth.isSigningIn {
                        ProgressView()
                    } else {
                        Text("Sign in with Google")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(auth.isSigningIn)
            if let error = auth.signInError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Link("Privacy policy", destination: Config.privacyPolicyURL)
                .font(.footnote)
        }
        .padding(24)
    }
}

private struct SignedInView: View {
    let me: Me
    let onSignOut: () -> Void
    /// Returns an error message if deleting didn't work.
    let onDeleteAccount: () async -> String?

    @State private var confirmingDelete = false
    @State private var deleteError: String?

    var body: some View {
        List {
            // Coucal lives in Messages; this app is mostly the way in.
            Section("Use Coucal in Messages") {
                HowToStep(number: 1, text: "Open a group chat (or a chat with one friend) in Messages.")
                HowToStep(number: 2, text: "Tap + next to the text box, then Coucal (under More if you don't see it).")
                HowToStep(number: 3, text: "Start Coucal in the chat and send the invite. Friends join by tapping it.")
                HowToStep(number: 4, text: "See when everyone's free, then tap or hold-and-drag on the calendar to propose a plan.")
            }
            Section("Signed in as") {
                LabeledContent(me.user.name, value: me.user.email)
            }
            Section {
                if me.calendarConnected {
                    Label("Google Calendar connected", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                } else {
                    Label("Google Calendar not connected. Sign out and sign in again.", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }
            }
            Section {
                Link("Privacy policy", destination: Config.privacyPolicyURL)
                Button("Sign out", action: onSignOut)
                Button("Delete account", role: .destructive) { confirmingDelete = true }
            }
        }
        .confirmationDialog("Delete your Coucal account?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) {
                Task { deleteError = await onDeleteAccount() }
            }
        } message: {
            Text(DeleteAccount.explanation)
        }
        .alert("Couldn't delete your account", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
            Button("OK") {}
        } message: {
            Text(deleteError ?? "")
        }
    }
}

#Preview {
    ContentView()
}

/// One numbered step of "Use Coucal in Messages".
private struct HowToStep: View {
    let number: Int
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.footnote.bold())
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Circle().fill(Color.green))
            Text(text)
        }
        .padding(.vertical, 2)
    }
}

