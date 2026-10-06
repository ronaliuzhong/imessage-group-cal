import SwiftUI

/// Filling in a plan: proposing a new one (the time comes from where the
/// calendar was tapped) or editing one. It warns if anyone's busy then, like
/// the website.
struct ProposeForm: View {
    /// Editing a repeating plan: saving asks which dates the change is for.
    struct RepeatingEdit {
        /// The plan's own first date ("this and following" = all).
        let isFirstDate: Bool
    }

    let heading: String
    let submitLabel: String
    /// Shown under the buttons.
    let footnote: String?
    let initialStart: Date
    /// Length in minutes (from a held-and-dragged range, or 60).
    let initialMinutes: Int
    let initialRepeat: RepeatRule?
    let repeatingEdit: RepeatingEdit?
    /// The calendar on screen, for the "busy then" warning.
    let availability: Availability?
    let onSend: (PlanDraft, EditScope) -> Void
    let onCancel: () -> Void

    @State private var title: String
    @State private var start: Date
    @State private var minutes: Int
    @State private var location: String
    @State private var preset: RepeatPreset
    /// The "Custom…" settings (kept while switching presets back and forth).
    @State private var custom: RepeatRule
    @State private var askingScope = false
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
        initialRepeat: RepeatRule? = nil,
        repeatingEdit: RepeatingEdit? = nil,
        availability: Availability?,
        onSend: @escaping (PlanDraft, EditScope) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.heading = heading
        self.submitLabel = submitLabel
        self.footnote = footnote
        self.initialStart = initialStart
        self.initialMinutes = initialMinutes
        self.initialRepeat = initialRepeat
        self.repeatingEdit = repeatingEdit
        self.availability = availability
        self.onSend = onSend
        self.onCancel = onCancel
        _title = State(initialValue: initialTitle)
        _location = State(initialValue: initialLocation)
        _start = State(initialValue: initialStart)
        _minutes = State(initialValue: initialMinutes)
        let preset = RepeatPreset(initialRepeat, start: initialStart)
        _preset = State(initialValue: preset)
        _custom = State(initialValue: initialRepeat ?? RepeatPreset.custom.rule(for: initialStart)!)
    }

    /// The usual lengths, plus a dragged one like 1 hr 45 min.
    private var lengths: [Int] {
        Self.lengths.contains(initialMinutes) ? Self.lengths : (Self.lengths + [initialMinutes]).sorted()
    }

    private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var end: Date { start.addingTimeInterval(Double(minutes) * 60) }

    /// A quick choice follows the start ("Weekly on Thursday" becomes Friday
    /// if the start moves to a Friday), like the website.
    private var currentRepeat: RepeatRule? {
        preset == .custom ? custom : preset.rule(for: start)
    }

    private var draft: PlanDraft {
        PlanDraft(title: trimmedTitle, start: start, durationMinutes: minutes, location: location, repeat: currentRepeat)
    }

    /// "This event" can't change how a plan repeats, like the website.
    private var repeatChanged: Bool { currentRepeat != initialRepeat }

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
                LabeledContent("Repeat") {
                    Picker("Repeat", selection: $preset) {
                        ForEach(RepeatPreset.allCases) { Text($0.label(for: start)).tag($0) }
                    }
                }
                if preset == .custom {
                    CustomRepeatEditor(rule: $custom, start: start)
                }
                TextField("Location (optional)", text: $location)
                    .textFieldStyle(.roundedBorder)
                busyWarning
                HStack {
                    Button("Cancel", action: onCancel)
                    Spacer()
                    Button(submitLabel) {
                        if repeatingEdit != nil { askingScope = true } else { onSend(draft, .all) }
                    }
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
        .onAppear { if trimmedTitle.isEmpty { titleFocused = true } }
        // Like Google Calendar: which dates does this change apply to?
        .confirmationDialog("Save changes for…", isPresented: $askingScope, titleVisibility: .visible) {
            if !repeatChanged {
                Button("This event") { onSend(draft, .this) }
            }
            if repeatingEdit?.isFirstDate == false {
                Button("This and following events") { onSend(draft, .following) }
            }
            Button("All events") { onSend(draft, .all) }
        } message: {
            if repeatChanged {
                Text("Changing how it repeats applies to more than one date.")
            }
        }
    }

    @ViewBuilder private var busyWarning: some View {
        if let availability, let busy = availability.busyMembers(from: start, to: end) {
            let firstOnly = currentRepeat != nil ? " (checked for the first one)" : ""
            if availability.connectedMembers.isEmpty {
                EmptyView()
            } else if busy.isEmpty {
                Label("Everyone's free then\(firstOnly)", systemImage: "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(.green)
            } else {
                Label(
                    "Busy during some or all of this\(firstOnly): \(busy.map { $0.isYou ? "You" : $0.name }.joined(separator: ", "))",
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

/// "Custom…" repeat settings, like the website's: every N days/weeks/months,
/// which weekdays, and when it ends.
private struct CustomRepeatEditor: View {
    @Binding var rule: RepeatRule
    let start: Date

    private static let dayFormat: Date.FormatStyle = {
        var style = Date.FormatStyle(date: .numeric, time: .omitted)
        style.timeZone = .current
        return style
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Unit", selection: $rule.freq) {
                Text("Days").tag(RepeatRule.Frequency.daily)
                Text("Weeks").tag(RepeatRule.Frequency.weekly)
                Text("Months").tag(RepeatRule.Frequency.monthly)
            }
            .pickerStyle(.segmented)
            Stepper(value: $rule.interval, in: 1...RepeatRule.maxInterval) {
                Text("Every \(rule.interval) \(unitName)")
            }
            if rule.freq == .weekly {
                weekdayPicker
            }
            Picker("Ends", selection: $rule.ends) {
                Text("Never").tag(RepeatRule.Ends.never)
                Text("On a date").tag(RepeatRule.Ends.on)
                Text("After").tag(RepeatRule.Ends.after)
            }
            .pickerStyle(.segmented)
            switch rule.ends {
            case .never:
                EmptyView()
            case .on:
                DatePicker("Last date", selection: untilBinding, in: start..., displayedComponents: .date)
            case .after:
                Stepper(value: $rule.count, in: 1...RepeatRule.maxCount) {
                    Text(rule.count == 1 ? "1 time" : "\(rule.count) times")
                }
            }
            Text(rule.summary(start: start))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color(uiColor: .secondarySystemBackground)))
        .onChange(of: rule.freq) {
            // Weekdays only mean something for weekly repeats.
            if rule.freq == .weekly, rule.weekdays.isEmpty {
                rule.weekdays = [Calendar.current.component(.weekday, from: start) - 1]
            }
        }
        .onChange(of: rule.ends) {
            // Save the date the picker shows, even if it's never touched.
            if rule.ends == .on, rule.untilDate.isEmpty {
                rule.untilDate = Self.string(from: untilBinding.wrappedValue)
            }
        }
    }

    private var unitName: String {
        let unit = [RepeatRule.Frequency.daily: "day", .weekly: "week", .monthly: "month"][rule.freq]!
        return rule.interval == 1 ? unit : "\(unit)s"
    }

    private var weekdayPicker: some View {
        let symbols = Calendar.current.veryShortWeekdaySymbols
        return HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { day in
                let on = rule.weekdays.contains(day)
                Button {
                    if on {
                        // Keep at least one day picked.
                        if rule.weekdays.count > 1 { rule.weekdays.removeAll { $0 == day } }
                    } else {
                        rule.weekdays = (rule.weekdays + [day]).sorted()
                    }
                } label: {
                    Text(symbols[day])
                        .font(.footnote.weight(.semibold))
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(on ? Color.accentColor : Color(uiColor: .tertiarySystemFill)))
                        .foregroundStyle(on ? Color.white : Color.primary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Calendar.current.weekdaySymbols[day])
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    /// "Ends on" as a date picker, stored as "YYYY-MM-DD" like the server.
    private var untilBinding: Binding<Date> {
        Binding(
            get: { Self.date(from: rule.untilDate) ?? Calendar.current.date(byAdding: .month, value: 1, to: start)! },
            set: { rule.untilDate = Self.string(from: $0) }
        )
    }

    private static func string(from date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    private static func date(from string: String) -> Date? {
        let parts = string.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

/// A plan, opened by tapping its bubble or tapping it on the calendar: when,
/// where, who's going, and Going / Can't make it. For repeating plans it's
/// one date, and answering asks "just this date or all of them".
struct PlanView: View {
    let plan: PlanSummary
    let isAnswering: Bool
    let onAnswer: (_ response: PlanSummary.Response, _ justThisDate: Bool) -> Void
    let onBack: () -> Void
    let onEdit: () -> Void

    /// Waiting for "just this date or all of them".
    @State private var pendingAnswer: PlanSummary.Response?

    /// Any group member can edit, like on the website.
    private var canEdit: Bool { plan.inGroup && !plan.cancelled }

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
                    if let repeats = plan.repeatLabel {
                        Label(repeats, systemImage: "repeat")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
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
                } else {
                    answerButtons
                }

                people
            }
            .padding()
        }
        .confirmationDialog(
            pendingAnswer == .going ? "Going to…" : "Can't make…",
            isPresented: Binding(get: { pendingAnswer != nil }, set: { if !$0 { pendingAnswer = nil } }),
            titleVisibility: .visible,
            presenting: pendingAnswer
        ) { response in
            Button("Just this date") { onAnswer(response, true) }
            Button("All of them") { onAnswer(response, false) }
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
            guard !chosen else { return }
            // Repeating plans: ask whether it's this date or all of them.
            if plan.repeats { pendingAnswer = response } else { onAnswer(response, false) }
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
            Text(plan.repeats ? "Going on this date (\(plan.going.count))" : "Going (\(plan.going.count))")
                .font(.headline)
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
