import SwiftUI

/// A chat's group at a glance: the overlap calendar for a week or a day, then
/// who's free right now and who we're still waiting for.
struct GlanceView: View {
    let availability: Availability
    /// Everyone in the chat, including you (from Messages).
    let participantCount: Int
    let span: ChatModel.Span
    let range: DateInterval
    let canGoBack: Bool
    let isChangingRange: Bool
    let onSpan: (ChatModel.Span) -> Void
    let onMove: (Int) -> Void
    let onToday: () -> Void
    let onInvite: () -> Void
    let onRefresh: () -> Void
    /// Propose a plan: at a tapped time or a held-and-dragged range (start and
    /// length in minutes), or (nil) the next hour.
    let onPropose: (Date?, Int?) -> Void
    /// Tapping a plan (on the calendar or in "Upcoming plans").
    let onOpenPlan: (String) -> Void

    var body: some View {
        GeometryReader { panel in
            ScrollView {
                GlanceContent(
                    availability: availability, participantCount: participantCount, span: span, range: range,
                    canGoBack: canGoBack, isChangingRange: isChangingRange,
                    // Fit the calendar to the panel (leaving room for the name,
                    // arrows and Day | Week switch), so the current hours show
                    // without expanding it.
                    calendarHeight: min(max(panel.size.height - 150, 160), 460),
                    onSpan: onSpan, onMove: onMove, onToday: onToday, onInvite: onInvite, onRefresh: onRefresh,
                    onPropose: onPropose, onOpenPlan: onOpenPlan
                )
            }
        }
    }
}

/// GlanceView without the scrolling (so it can also be drawn to an image).
struct GlanceContent: View {
    let availability: Availability
    let participantCount: Int
    let span: ChatModel.Span
    let range: DateInterval
    let canGoBack: Bool
    let isChangingRange: Bool
    /// Height of the calendar's scrolling area.
    let calendarHeight: CGFloat
    let onSpan: (ChatModel.Span) -> Void
    let onMove: (Int) -> Void
    let onToday: () -> Void
    let onInvite: () -> Void
    let onRefresh: () -> Void
    let onPropose: (Date?, Int?) -> Void
    let onOpenPlan: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(availability.group.name)
                    .font(.title3.bold())
                Spacer()
                Button(action: onRefresh) {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh")
            }
            // The calendar comes first; the Day | Week switch sits under it.
            VStack(alignment: .leading, spacing: 12) {
                RangeNavigator(span: span, range: range, canGoBack: canGoBack, isLoading: isChangingRange,
                               onMove: onMove, onToday: onToday)
                OverlapGrid(availability: availability, range: range, span: span, viewportHeight: calendarHeight,
                            onTapTime: { onPropose($0, nil) },
                            onPickRange: { start, end in onPropose(start, Int(end.timeIntervalSince(start) / 60)) },
                            onOpenPlan: onOpenPlan)
                    .opacity(isChangingRange ? 0.5 : 1)
                SpanPicker(span: span, onSpan: onSpan)
                Button { onPropose(nil, nil) } label: {
                    Label("Propose a time", systemImage: "plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Text("Or tap a time on the calendar, or hold and drag to pick a range.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
            // "Right now" only makes sense when the day or week on screen
            // includes now.
            if range.contains(.now) {
                FreeNowSection(availability: availability)
            }
            if !availability.upcoming.isEmpty {
                UpcomingSection(plans: availability.upcoming, onOpenPlan: onOpenPlan)
            }
            WaitingSection(availability: availability, participantCount: participantCount, onInvite: onInvite)
        }
        .padding()
    }
}

// MARK: - Free right now

private struct FreeNowSection: View {
    let availability: Availability

    private static let clock = Date.FormatStyle(date: .omitted, time: .shortened)

    private struct Row: Identifiable {
        let member: Availability.Member
        let status: MemberStatus
        var id: String { member.id }
        var isFree: Bool { if case .free = status { true } else { false } }
    }

    var body: some View {
        let now = Date.now
        let rows = availability.connectedMembers
            .compactMap { member in availability.status(of: member.id, at: now).map { Row(member: member, status: $0) } }
            // Free people first, then keep the group's order.
            .sorted { $0.isFree && !$1.isFree }

        VStack(alignment: .leading, spacing: 8) {
            Text("Right now").font(.headline)
            if rows.isEmpty {
                Text("Nobody's calendar is connected yet.")
                    .foregroundStyle(.secondary)
            } else if rows.count > 1, rows.allSatisfy(\.isFree) {
                Label("Everyone's free right now", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }
            ForEach(rows) { row in
                HStack {
                    Circle()
                        .fill(row.isFree ? Color.green : Color.secondary.opacity(0.4))
                        .frame(width: 8, height: 8)
                    Text(row.member.isYou ? "You" : row.member.name)
                    Spacer()
                    Text(describe(row.status))
                        .foregroundStyle(row.isFree ? Color.green : Color.secondary)
                }
                .font(.subheadline)
            }
        }
    }

    private func describe(_ status: MemberStatus) -> String {
        switch status {
        case .free(until: nil): "Free the rest of the day"
        case .free(until: let time?): "Free until \(time.formatted(Self.clock))"
        case .busy(until: let time): "Busy until \(time.formatted(Self.clock))"
        }
    }
}

// MARK: - Upcoming plans

private struct UpcomingSection: View {
    let plans: [Availability.Plan]
    let onOpenPlan: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Upcoming plans").font(.headline)
            ForEach(plans) { plan in
                Button { onOpenPlan(plan.shareCode) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Circle().fill(Color(hex: plan.color.hex)).frame(width: 10, height: 10).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(plan.title).foregroundStyle(.primary)
                            Text(PlanTime.describe(plan.start, plan.end))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            if let repeats = plan.repeatLabel {
                                Text("↻ \(repeats)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Text(status(plan))
                            .font(.footnote)
                            .foregroundStyle(plan.myResponse == .going ? Color.green : Color.secondary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func status(_ plan: Availability.Plan) -> String {
        switch plan.myResponse {
        case .going: "You're going"
        case .notGoing: "Can't make it"
        case nil: "\(plan.goingCount) going"
        }
    }
}

// MARK: - Waiting for...

private struct WaitingSection: View {
    let availability: Availability
    let participantCount: Int
    let onInvite: () -> Void

    var body: some View {
        let unconnected = availability.unconnectedMembers
        // Messages only tells us how many people are in the chat, not who,
        // so people who haven't joined can only be counted, not named.
        let notJoined = max(0, participantCount - availability.members.count)

        if !unconnected.isEmpty || notJoined > 0 {
            VStack(alignment: .leading, spacing: 8) {
                Text("Waiting for").font(.headline)
                ForEach(unconnected) { member in
                    Label {
                        Text("\(member.isYou ? "You" : member.name): calendar not connected")
                    } icon: {
                        Image(systemName: "calendar.badge.exclamationmark")
                    }
                    .font(.subheadline)
                    .foregroundStyle(.orange)
                }
                if notJoined > 0 {
                    Label(
                        notJoined == 1 ? "1 person in this chat hasn't joined" : "\(notJoined) people in this chat haven't joined",
                        systemImage: "person.badge.plus"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    Button("Send the invite again", action: onInvite)
                        .font(.subheadline)
                }
            }
        }
    }
}

// MARK: - Day / week navigation

/// The Day | Week switch. Keeps its own selection so it responds instantly,
/// and follows `span` if it changes elsewhere.
private struct SpanPicker: View {
    let span: ChatModel.Span
    let onSpan: (ChatModel.Span) -> Void
    @State private var selection: ChatModel.Span

    init(span: ChatModel.Span, onSpan: @escaping (ChatModel.Span) -> Void) {
        self.span = span
        self.onSpan = onSpan
        _selection = State(initialValue: span)
    }

    var body: some View {
        Picker("View", selection: $selection) {
            ForEach(ChatModel.Span.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .onChange(of: selection) { _, new in if new != span { onSpan(new) } }
        .onChange(of: span) { _, new in selection = new }
    }
}

private struct RangeNavigator: View {
    let span: ChatModel.Span
    let range: DateInterval
    let canGoBack: Bool
    let isLoading: Bool
    let onMove: (Int) -> Void
    let onToday: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button { onMove(-1) } label: { Image(systemName: "chevron.left") }
                .disabled(!canGoBack)
                .accessibilityLabel(span == .day ? "Previous day" : "Previous week")
            Text(title)
                .font(.subheadline.weight(.medium))
            Button { onMove(1) } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel(span == .day ? "Next day" : "Next week")
            if isLoading { ProgressView().controlSize(.small) }
            Spacer()
            if canGoBack {
                Button("Today", action: onToday).font(.subheadline)
            }
        }
    }

    private var title: String {
        let calendar = Calendar.current
        switch span {
        case .day:
            if calendar.isDateInToday(range.start) { return "Today" }
            if calendar.isDateInTomorrow(range.start) { return "Tomorrow" }
            return range.start.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
        case .week:
            let last = calendar.date(byAdding: .day, value: -1, to: range.end)!
            let day = Date.FormatStyle().month(.abbreviated).day()
            return "\(range.start.formatted(day)) – \(last.formatted(day))"
        }
    }
}

// MARK: - The overlap calendar

/// One or seven day columns. Busy time is drawn as gray blocks (darker = more
/// people busy), like events in Google Calendar, so the empty gaps are when
/// everyone's free. The week view uses short labels. The whole day scrolls
/// inside its own box, opening at the current hour.
private struct OverlapGrid: View {
    let availability: Availability
    let range: DateInterval
    let span: ChatModel.Span
    /// Height of the scrolling box.
    let viewportHeight: CGFloat
    /// Tapping the calendar proposes that time.
    let onTapTime: (Date) -> Void
    /// Holding and dragging proposes that range.
    let onPickRange: (Date, Date) -> Void
    /// Tapping a plan opens it.
    let onOpenPlan: (String) -> Void

    /// A range being held-and-dragged on one day column.
    private struct DragPick: Equatable {
        let day: Int
        let range: ClosedRange<Int>
    }

    @GestureState private var dragging: DragPick?
    /// Width of the day columns, to tell which day a touch is on.
    @State private var columnsWidth: CGFloat = 0
    /// When a hold-and-drag last finished: lifting the finger after holding
    /// still can also count as a tap, which should be ignored.
    @State private var lastPickAt = Date.distantPast

    private let labelWidth: CGFloat = 36
    private static let hourLabel = Date.FormatStyle().hour(.defaultDigits(amPM: .abbreviated))

    private var compact: Bool { span == .week }
    private var hourHeight: CGFloat { compact ? 30 : 40 }

    private var days: [Date] {
        let calendar = Calendar.current
        var days: [Date] = []
        var day = range.start
        while day < range.end {
            days.append(day)
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return days
    }

    /// Where the calendar opens: the current hour (3:25 PM → the 3 PM row at
    /// the top) when now is on screen, otherwise 7 AM like the website.
    private var openingHour: Int {
        range.contains(.now) ? Calendar.current.component(.hour, from: .now) : 7
    }

    var body: some View {
        let total = availability.connectedMembers.count

        VStack(alignment: .leading, spacing: 6) {
            // Day names stay put while the hours scroll underneath.
            if days.count > 1 { dayHeader }
            ScrollViewReader { proxy in
                ScrollView {
                    HStack(alignment: .top, spacing: 4) {
                        VStack(alignment: .trailing, spacing: 0) {
                            ForEach(0..<24, id: \.self) { hour in
                                Text(Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: range.start)!.formatted(Self.hourLabel))
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .frame(width: labelWidth, height: hourHeight, alignment: .topTrailing)
                                    .id(hour)
                            }
                        }
                        HStack(spacing: 2) {
                            ForEach(Array(days.enumerated()), id: \.element) { index, day in
                                DayColumn(availability: availability, day: day, firstHour: 0,
                                          hourHeight: hourHeight, total: total, compact: compact,
                                          dragRange: dragging?.day == index ? dragging?.range : nil,
                                          onOpenPlan: onOpenPlan)
                            }
                        }
                        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { columnsWidth = $0 }
                        .contentShape(Rectangle())
                        .onTapGesture(coordinateSpace: .local) { location in
                            guard Date.now.timeIntervalSince(lastPickAt) > 0.5,
                                  let (day, minute) = locate(location) else { return }
                            onTapTime(CalendarPick.tapTime(day: days[day], minute: minute))
                        }
                        .simultaneousGesture(pickGesture)
                    }
                    .frame(height: 24 * hourHeight)
                }
                .frame(height: viewportHeight)
                // Hold still while a range is being dragged.
                .scrollDisabled(dragging != nil)
                .sensoryFeedback(.selection, trigger: dragging != nil)
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.secondary.opacity(0.2)))
                .onAppear { proxy.scrollTo(openingHour, anchor: .top) }
                // Switching day/week or moving to another one: open at the
                // right hour again.
                .onChange(of: range) { proxy.scrollTo(openingHour, anchor: .top) }
            }
            if total > 0 {
                HStack(spacing: 12) {
                    Swatch(color: .clear, label: "Everyone free")
                    if total > 1 {
                        Swatch(color: DayColumn.busyColor(busy: 1, of: 3), label: "Some busy")
                        Swatch(color: DayColumn.busyColor(busy: 1, of: 1), label: "Everyone busy")
                    } else {
                        Swatch(color: DayColumn.busyColor(busy: 1, of: 1), label: "Busy")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }

    /// Holding (about half a second) then dragging picks a range; a quick tap
    /// (handled separately) picks a time. A quick swipe still scrolls, since
    /// the hold fails as soon as the finger moves.
    private var pickGesture: some Gesture {
        LongPressGesture(minimumDuration: 0.45)
            .sequenced(before: DragGesture(minimumDistance: 0))
            .updating($dragging) { value, state, _ in
                if case .second(true, let drag?) = value {
                    state = pick(from: drag.startLocation, to: drag.location)
                }
            }
            .onEnded { value in
                guard case .second(true, let drag?) = value,
                      let picked = pick(from: drag.startLocation, to: drag.location)
                else { return }
                lastPickAt = .now
                let (start, end) = CalendarPick.dates(day: days[picked.day], range: picked.range)
                onPickRange(start, end)
            }
    }

    /// Which day column a point is on, and how many minutes into that day.
    private func locate(_ point: CGPoint) -> (day: Int, minute: Double)? {
        let count = days.count
        guard count > 0, columnsWidth > 0 else { return nil }
        let columnWidth = (columnsWidth - 2 * CGFloat(count - 1)) / CGFloat(count)
        let day = min(max(Int(point.x / (columnWidth + 2)), 0), count - 1)
        let minute = min(max(Double(point.y / hourHeight) * 60, 0), Double(CalendarPick.dayMinutes))
        return (day, minute)
    }

    private func pick(from start: CGPoint, to current: CGPoint) -> DragPick? {
        guard let (day, downMinute) = locate(start) else { return nil }
        let currentMinute = min(max(Double(current.y / hourHeight) * 60, 0), Double(CalendarPick.dayMinutes))
        return DragPick(day: day, range: CalendarPick.dragRange(downMinute: downMinute, currentMinute: currentMinute))
    }

    private var dayHeader: some View {
        HStack(spacing: 2) {
            Color.clear.frame(width: labelWidth + 2, height: 1)
            ForEach(days, id: \.self) { day in
                let isToday = Calendar.current.isDateInToday(day)
                VStack(spacing: 2) {
                    Text(day.formatted(.dateTime.weekday(.narrow)))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(day.formatted(.dateTime.day()))
                        .font(.footnote.weight(isToday ? .semibold : .regular))
                        .foregroundStyle(isToday ? Color.white : Color.primary)
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(isToday ? Color.green : Color.clear))
                }
                .frame(maxWidth: .infinity)
            }
        }
    }
}

private struct DayColumn: View {
    let availability: Availability
    let day: Date
    let firstHour: Int
    let hourHeight: CGFloat
    let total: Int
    let compact: Bool
    /// The range being held-and-dragged on this day, in minutes into the day.
    let dragRange: ClosedRange<Int>?
    let onOpenPlan: (String) -> Void

    var body: some View {
        let calendar = Calendar.current
        let top = calendar.date(bySettingHour: firstHour, minute: 0, second: 0, of: day)!
        let end = calendar.date(byAdding: .day, value: 1, to: day)!
        let now = Date.now

        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 6)
                .strokeBorder(Color.secondary.opacity(0.25))
            ForEach(firstHour..<24, id: \.self) { hour in
                Rectangle()
                    .fill(Color.secondary.opacity(0.12))
                    .frame(height: 1)
                    .offset(y: CGFloat(hour - firstHour) * hourHeight)
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            ForEach(availability.segments.filter { $0.end > top && $0.start < end }, id: \.start) { segment in
                block(for: segment, top: top, end: end)
            }
            // Plans, on top of the free/busy view. Tapping one opens it.
            ForEach(availability.plans.filter { $0.end > top && $0.start < end }) { plan in
                planBlock(plan, top: top, end: end)
            }
            // Fade time that's already passed.
            if now > top {
                Rectangle()
                    .fill(Color(uiColor: .systemBackground).opacity(0.6))
                    .frame(height: y(min(now, end), from: top))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
            // Red "now" line.
            if now > top, now < end {
                Rectangle()
                    .fill(Color.red)
                    .frame(height: 2)
                    .offset(y: y(now, from: top))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            if let dragRange { dragBox(dragRange) }
        }
        .clipped()
    }

    /// Like the website: solid in the group's color if you're going, a dashed
    /// outline if you haven't answered, faded and crossed out if you can't
    /// make it.
    @ViewBuilder
    private func planBlock(_ plan: Availability.Plan, top: Date, end: Date) -> some View {
        let blockTop = y(max(plan.start, top), from: top)
        let height = max(y(min(plan.end, end), from: top) - blockTop, 14)
        let color = Color(hex: plan.color.hex)
        let going = plan.myResponse == .going
        let declined = plan.myResponse == .notGoing
        let shape = RoundedRectangle(cornerRadius: compact ? 4 : 6)
        let clock = Date.FormatStyle(date: .omitted, time: .shortened)

        shape
            .fill(going ? color : color.opacity(0.15))
            .overlay {
                if !going {
                    shape.strokeBorder(color, style: StrokeStyle(lineWidth: 2, dash: declined ? [] : [4, 3]))
                }
            }
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(plan.title)
                        .fontWeight(.semibold)
                        .strikethrough(declined)
                    if !compact, height >= 34 {
                        Text("\(plan.start.formatted(clock)) – \(plan.end.formatted(clock))")
                    }
                }
                .font(compact ? .caption2 : .caption)
                .foregroundStyle(going ? Color(hex: plan.color.text) : Color.primary)
                .lineLimit(compact ? 3 : 2)
                .padding(.horizontal, compact ? 2 : 6)
                .padding(.top, 2)
            }
            .opacity(declined ? 0.5 : 1)
            .padding(.horizontal, compact ? 1 : 3)
            .frame(height: height)
            .contentShape(shape)
            .onTapGesture { onOpenPlan(plan.shareCode) }
            .accessibilityAddTraits(.isButton)
            .offset(y: blockTop)
            .frame(maxHeight: .infinity, alignment: .top)
    }

    /// The range being dragged: its times and how many are free for all of it.
    private func dragBox(_ range: ClosedRange<Int>) -> some View {
        let start = day.addingTimeInterval(Double(range.lowerBound) * 60)
        let end = day.addingTimeInterval(Double(range.upperBound) * 60)
        let clock = Date.FormatStyle(date: .omitted, time: .shortened)
        let busy = availability.busyMembers(from: start, to: end)?.count
        return RoundedRectangle(cornerRadius: compact ? 4 : 6)
            .fill(Color.accentColor.opacity(0.15))
            .strokeBorder(Color.accentColor, lineWidth: 2)
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(compact ? start.formatted(clock) : "\(start.formatted(clock)) – \(end.formatted(clock))")
                        .fontWeight(.semibold)
                    if let busy, total > 0 {
                        Text("\(total - busy)/\(total) free")
                    }
                }
                .font(compact ? .caption2 : .caption)
                .foregroundStyle(Color.accentColor)
                .lineLimit(2)
                .padding(.horizontal, compact ? 2 : 6)
                .padding(.top, 2)
            }
            .frame(height: CGFloat(range.upperBound - range.lowerBound) / 60 * hourHeight)
            .offset(y: CGFloat(range.lowerBound) / 60 * hourHeight)
    }

    /// Busy time is drawn as blocks, like events in Google Calendar: the more
    /// people busy, the darker. Empty space means everyone's free.
    static func busyColor(busy: Int, of total: Int) -> Color {
        busy >= total ? Color(uiColor: .systemGray) : Color(uiColor: .systemGray).opacity(0.2 + 0.4 * Double(busy) / Double(total))
    }

    @ViewBuilder
    private func block(for segment: Availability.Segment, top: Date, end: Date) -> some View {
        let busy = segment.busyMemberIds.count
        let blockTop = y(max(segment.start, top), from: top)
        let height = y(min(segment.end, end), from: top) - blockTop
        if total > 0, busy > 0 {
            let everyone = busy >= total
            // White text on the dark "everyone busy" block, except where the
            // label sits in the faded past, which would make it unreadable.
            let whiteText = everyone && max(segment.start, top) >= .now
            RoundedRectangle(cornerRadius: compact ? 4 : 6)
                .fill(Self.busyColor(busy: busy, of: total))
                .overlay(alignment: .topLeading) {
                    if height >= 16 {
                        Text(label(for: segment, everyone: everyone))
                            .font((compact ? Font.caption2 : Font.caption).weight(everyone ? .semibold : .regular))
                            .foregroundStyle(whiteText ? Color.white : Color.primary)
                            .lineLimit(2)
                            .padding(.horizontal, compact ? 2 : 6)
                            .padding(.top, 2)
                    }
                }
                .padding(.horizontal, 1)
                .frame(height: height)
                .offset(y: blockTop)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    /// The day view has room to say who's busy ("Sam & Alex busy"); the
    /// narrow week columns show a count ("2 busy").
    private func label(for segment: Availability.Segment, everyone: Bool) -> String {
        if everyone { return total == 1 ? "Busy" : (compact ? "All busy" : "Everyone busy") }
        let busy = segment.busyMemberIds
        if compact || busy.count > 2 { return "\(busy.count) busy" }
        let names = busy.map { id in
            let member = availability.members.first { $0.id == id }
            return member?.isYou == true ? "You" : (member?.name ?? "Someone")
        }
        return "\(names.joined(separator: " & ")) busy"
    }

    private func y(_ time: Date, from top: Date) -> CGFloat {
        CGFloat(time.timeIntervalSince(top) / 3600) * hourHeight
    }
}

private struct Swatch: View {
    let color: Color
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 2)
                .fill(color)
                .overlay(RoundedRectangle(cornerRadius: 2).strokeBorder(Color.secondary.opacity(0.4)))
                .frame(width: 10, height: 10)
            Text(label)
        }
    }
}
