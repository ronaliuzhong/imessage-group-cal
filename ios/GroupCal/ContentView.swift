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
                    SignedInView(me: me) {
                        Task { await auth.signOut() }
                    }
                case .unreachable(let message):
                    ContentUnavailableView {
                        Label("Can't reach Group Cal", systemImage: "wifi.slash")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await auth.restore() } }
                    }
                }
            }
            .navigationTitle("Group Cal")
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
        }
        .padding(24)
    }
}

private struct SignedInView: View {
    let me: Me
    let onSignOut: () -> Void

    var body: some View {
        List {
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
                Button("Sign out", role: .destructive, action: onSignOut)
            }
        }
    }
}

#Preview {
    ContentView()
}
