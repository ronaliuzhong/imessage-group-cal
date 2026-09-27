import Foundation

/// Turning taps and hold-and-drag on the calendar into times, like the
/// website on phones: a tap picks a start (snapped to the half hour); holding
/// drops a 1-hour block whose end you then drag (in 15-minute steps).
enum CalendarPick {
    static let tapSnapMinutes = 30
    static let dragSnapMinutes = 15
    static let dayMinutes = 24 * 60

    /// A tap `minute` minutes into `day`, snapped down to the half hour. Taps
    /// on time that's already passed pick the next half hour instead.
    static func tapTime(day: Date, minute: Double, now: Date = .now) -> Date {
        let snapped = (minute / Double(tapSnapMinutes)).rounded(.down) * Double(tapSnapMinutes)
        let tapped = day.addingTimeInterval(snapped * 60)
        return max(tapped, nextSlot(after: now, minutes: tapSnapMinutes))
    }

    /// The range a hold-and-drag covers, in minutes into the day: it starts
    /// where the finger went down (snapped down to 15 minutes) and lasts an
    /// hour, plus however far the finger has moved since.
    static func dragRange(downMinute: Double, currentMinute: Double) -> ClosedRange<Int> {
        let step = Double(dragSnapMinutes)
        let start = min(Int((downMinute / step).rounded(.down) * step), dayMinutes - dragSnapMinutes)
        let rawEnd = Double(start) + 60 + (currentMinute - downMinute)
        let end = Int((rawEnd / step).rounded() * step)
        return max(start, 0)...min(max(end, start + dragSnapMinutes), dayMinutes)
    }

    /// A dragged range on `day` as times. If it starts in the past, it's moved
    /// to the next 15-minute slot, keeping its length.
    static func dates(day: Date, range: ClosedRange<Int>, now: Date = .now) -> (start: Date, end: Date) {
        var start = day.addingTimeInterval(Double(range.lowerBound) * 60)
        let length = Double(range.upperBound - range.lowerBound) * 60
        start = max(start, nextSlot(after: now, minutes: dragSnapMinutes))
        return (start, start.addingTimeInterval(length))
    }

    private static func nextSlot(after date: Date, minutes: Int) -> Date {
        let seconds = Double(minutes * 60)
        return Date(timeIntervalSinceReferenceDate: (date.timeIntervalSinceReferenceDate / seconds).rounded(.up) * seconds)
    }
}
