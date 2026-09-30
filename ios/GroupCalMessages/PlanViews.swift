import SwiftUI

/// Filling in a plan: proposing a new one (the time comes from where the
/// calendar was tapped) or editing one. It warns if anyone's busy then, like
/// the website.
struct ProposeForm: View {
    var heading = "Propose a time"
    var submitLabel = "Send plan"
    /// Shown under the buttons.
    var footnote: String? = "You'll be marked as going, and it's added to your Google Calendar."
    var initialTitle = ""
    var initialLocation = ""
    let initialStart: Date
    /// Length in minutes (from a held-and-dragged range, or 60).
    let initialMinutes: Int
    /// The calendar on screen, for the "busy then" warning.
    let availability: Availability?
    let onSend: (_ title: String, _ start: Date, _ minutes: Int, _ location: String) -> Void
    let onCancel: () -> Void

    @State private var title = ""
    @State private var start: Date
    @State private var minutes = 60
    @State private var location = ""
    @FocusState private var titleFocused: Bool

    private static let lengths = [30, 60, 90, 120, 180, 240]

    init(
        heading: String = "Propose a time",
        submitLabel: String = "Send plan",
        footnote: String? = "You'll be marked as going, and it's added to your Google Calendar.",
        initialTitle: String = "",
        initialLocation: String = "",
        initialStart: Date,
        initialMinutes: Int = 60,
        availability: Availability?,
        onSend: @escaping (String, Date, Int, String) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.heading = heading
        self.submitLabel = submitLabel
        self.footnote = footnote
        self.initialTitle = initialTitle
        self.initialLocation = initialLocation
        self.initialStart = initialStart
        self.initialMinutes = initialMinutes
        self.availability = availability
        self.onSend = onSend
        self.onCancel = onCancel
        _title = State(initialValue: initialTitle)
        _location = State(initialValue: initialLocation)
        _start = State(initialValue: initialStart)
        _minutes = State(initialValue: initialMinutes)
    }

    /// The usual lengths, plus a dragged one like 1 hr 45 min.
    private var lengths: [Int] {
        Self.lengths.contains(initialMinutes) ? Self.lengths : (Self.lengths + [initialMinutes]).sorted()
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var end: Date { start.addingTimeInterval(Double(minutes) * 60) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(heading).font(.title3.bold())
                TextField("What's the plan? e.g. Dinner at Joe's", text: $title)
                    .textFieldStyle(.roundedBorder)
                    .focused($titleFocused)
                    .submitLabel(.done)
                DatePicker("Starts", selection: $start, in: Date.now..., displayedComponents: [.date, .hourAndMinute])
                LabeledContent("Length") {
                    Picker("Length", selection: $minutes) {
                        ForEach(lengths, id: \.self) { Text(Self.lengthLabel($0)).tag($0) }
                    }
                }
                TextField("Location (optional)", text: $location)
                    .textFieldStyle(.roundedBorder)
                busyWarning
                HStack {
                    Button("Cancel", action: onCancel)
                    Spacer()
                    Button(submitLabel) { onSend(trimmedTitle, start, minutes, location) }
                        .buttonStyle(.borderedProminent)
                        .disabled(trimmedTitle.isEmpty)
                }
                if let footnote {
                    Text(footnote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .onAppear { titleFocused = true }
    }

    @ViewBuilder private var busyWarning: some View {
        if let availability, let busy = availability.busyMembers(from: start, to: end) {
            if availability.connectedMembers.isEmpty {
                EmptyView()
            } else if busy.isEmpty {
                Label("Everyone's free then", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            } else {
                Label(
                    "Busy during some or all of this: \(busy.map { $0.isYou ? "You" : $0.name }.joined(separator: ", "))",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.subheadline)
                .foregroundStyle(.orange)
            }
        }
    }

    static func lengthLabel(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        if minutes % 60 != 0 { return "\(minutes / 60) hr \(minutes % 60) min" }
        return minutes == 60 ? "1 hour" : "\(minutes / 60) hours"
    }
}

/// A plan, opened by tapping its bubble: when, where, who's going, and
/// Going / Can't make it.
struct PlanView: View {
    let plan: PlanSummary
    let isAnswering: Bool
    let onAnswer: (PlanSummary.Response) -> Void
    let onBack: () -> Void
    let onEdit: () -> Void

    /// Group members can edit one-time plans here (repeating ones on the
    /// website for now).
    private var canEdit: Bool { plan.inGroup && !plan.cancelled && !plan.repeats }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    // Back to the chat's calendar, top left like other iPhone apps.
                    Button(action: onBack) {
                        Label("Calendar", systemImage: "chevron.left")
                    }
                    Spacer()
                    if canEdit {
                        Button("Edit", action: onEdit)
                    }
                }
                .font(.body.weight(.medium))
                VStack(alignment: .leading, spacing: 4) {
                    Text(plan.groupName.uppercased())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(plan.title)
                        .font(.title2.bold())
                        .strikethrough(plan.cancelled)
                    Text(PlanTime.describe(plan.start, plan.end))
                        .font(.subheadline)
                    if let location = plan.location {
                        Label(location, systemImage: "mappin.and.ellipse")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    if let notes = plan.notes {
                        Text(notes)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                if plan.cancelled {
                    Label("This plan was cancelled.", systemImage: "xmark.circle.fill")
                        .foregroundStyle(.red)
                } else if plan.repeats {
                    // Repeating plans need "just this one / all of them",
                    // which lives on the website for now.
                    VStack(alignment: .leading, spacing: 8) {
                        Text("This plan repeats. Answer it on the Group Cal website.")
                            .font(.subheadline)
                        Link("Open on the website", destination: plan.url)
                    }
                } else {
                    answerButtons
                }

                people
            }
            .padding()
        }
    }

    private var answerButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                answerButton("Going", .going, color: .green)
                answerButton("Can't make it", .notGoing, color: .secondary)
                if isAnswering { ProgressView() }
            }
            Text(plan.myResponse == .going
                ? "It's on your Google Calendar."
                : "Tap Going and it's added to your Google Calendar.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func answerButton(_ label: String, _ response: PlanSummary.Response, color: Color) -> some View {
        let chosen = plan.myResponse == response
        Button {
            if !chosen { onAnswer(response) }
        } label: {
            Label(label, systemImage: chosen ? "checkmark" : (response == .going ? "hand.thumbsup" : "hand.thumbsdown"))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .tint(chosen ? color : .accentColor)
        .disabled(isAnswering)
    }

    private var people: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Going (\(plan.going.count))").font(.headline)
            Text(plan.going.isEmpty ? "Nobody yet" : names(plan.going))
                .font(.subheadline)
                .foregroundStyle(plan.going.isEmpty ? .secondary : .primary)
            if !plan.notGoing.isEmpty {
                Text("Can't make it: \(names(plan.notGoing))")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func names(_ people: [PlanSummary.Person]) -> String {
        people.map { $0.isYou ? "You" : $0.name }.joined(separator: ", ")
    }
}
