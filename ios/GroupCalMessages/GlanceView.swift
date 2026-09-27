import SwiftUI

/// A chat's group at a glance: who's free right now, who we're still waiting
/// for, and the overlap calendar for a day or a week.
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

    var body: some View {
        ScrollView {
            GlanceContent(
                availability: availability, participantCount: participantCount, span: span, range: range,
                canGoBack: canGoBack, isChangingRange: isChangingRange, onSpan: onSpan, onMove: onMove,
                onToday: onToday, onInvite: onInvite, onRefresh: onRefresh
            )
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
    let onSpan: (ChatModel.Span) -> Void
    let onMove: (Int) -> Void
    let onToday: () -> Void
    let onInvite: () -> Void
    let onRefresh: () -> Void

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
            // "Right now" only makes sense when the day or week on screen
            // includes now.
            if range.contains(.now) {
                FreeNowSection(availability: availability)
            }
            WaitingSection(availability: availability, participantCount: participantCount, onInvite: onInvite)
            VStack(alignment: .leading, spacing: 12) {
                SpanPicker(span: span, onSpan: onSpan)
                RangeNavigator(span: span, range: range, canGoBack: canGoBack, isLoading: isChangingRange,
                               onMove: onMove, onToday: onToday)
                OverlapGrid(availability: availability, range: range, span: span)
                    .opacity(isChangingRange ? 0.5 : 1)
            }
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

/// One or seven day columns, shaded by how many people are free (the same
/// look as the website's heat map). The week view uses short labels, like
/// the website on phones.
private struct OverlapGrid: View {
    let availability: Availability
    let range: DateInterval
    let span: ChatModel.Span

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

    /// First hour shown. Today's day view starts at the current hour (but
    /// always shows at least the last 4 hours); otherwise 6 AM.
    private var firstHour: Int {
        if span == .day, Calendar.current.isDateInToday(range.start) {
            return min(Calendar.current.component(.hour, from: .now), 20)
        }
        return 6
    }

    var body: some View {
        let total = availability.connectedMembers.count
        let hours = 24 - firstHour

        VStack(alignment: .leading, spacing: 6) {
            if days.count > 1 { dayHeader }
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach(firstHour..<24, id: \.self) { hour in
                        Text(Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: range.start)!.formatted(Self.hourLabel))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .frame(width: labelWidth, height: hourHeight, alignment: .topTrailing)
                    }
                }
                HStack(spacing: 2) {
                    ForEach(days, id: \.self) { day in
                        DayColumn(availability: availability, day: day, firstHour: firstHour,
                                  hourHeight: hourHeight, total: total, compact: compact)
                    }
                }
            }
            .frame(height: CGFloat(hours) * hourHeight)
            if total > 0 {
                HStack(spacing: 12) {
                    Swatch(color: .green, label: "Everyone free")
                    Swatch(color: .green.opacity(0.35), label: "Some free")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
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
        .clipped()
    }

    @ViewBuilder
    private func block(for segment: Availability.Segment, top: Date, end: Date) -> some View {
        let free = availability.freeCount(in: segment)
        let blockTop = y(max(segment.start, top), from: top)
        let height = y(min(segment.end, end), from: top) - blockTop
        if total > 0, free > 0 {
            let everyone = free == total
            RoundedRectangle(cornerRadius: compact ? 4 : 6)
                .fill(everyone ? Color.green : Color.green.opacity(0.12 + 0.5 * Double(free) / Double(total)))
                .overlay(alignment: .topLeading) {
                    if height >= 16 {
                        Text(label(free: free, everyone: everyone))
                            .font((compact ? Font.caption2 : Font.caption).weight(everyone ? .semibold : .regular))
                            .foregroundStyle(everyone ? Color.white : Color.primary)
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

    /// Phones' week view is narrow: "All" / "2/3" instead of "Everyone free" /
    /// "2/3 free".
    private func label(free: Int, everyone: Bool) -> String {
        if everyone { return total == 1 ? "Free" : (compact ? "All free" : "Everyone free") }
        return compact ? "\(free)/\(total)" : "\(free)/\(total) free"
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
            RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 10, height: 10)
            Text(label)
        }
    }
}
