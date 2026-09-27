import Foundation
import Testing
@testable import GroupCal

struct CalendarPickTests {
    // Midnight of some day, and "now" as 1:00 AM that day, so the rest of the
    // day is in the future.
    let day = Date(timeIntervalSinceReferenceDate: 800_000_000 - 800_000_000.truncatingRemainder(dividingBy: 86_400))
    var earlyMorning: Date { day.addingTimeInterval(3600) }

    @Test func tapsSnapDownToTheHalfHour() {
        let t = CalendarPick.tapTime(day: day, minute: 19 * 60 + 25, now: earlyMorning)
        #expect(t == day.addingTimeInterval(19 * 3600))
        let u = CalendarPick.tapTime(day: day, minute: 19 * 60 + 31, now: earlyMorning)
        #expect(u == day.addingTimeInterval(19.5 * 3600))
    }

    @Test func tapsInThePastPickTheNextHalfHour() {
        let now = day.addingTimeInterval(15 * 3600 + 10 * 60) // 3:10 PM
        #expect(CalendarPick.tapTime(day: day, minute: 9 * 60, now: now) == day.addingTimeInterval(15.5 * 3600))
    }

    @Test func holdingDropsAnHourThenDraggingMovesTheEnd() {
        // Held at 7:05 PM without moving: 7:00–8:00.
        #expect(CalendarPick.dragRange(downMinute: 19 * 60 + 5, currentMinute: 19 * 60 + 5) == (19 * 60)...(20 * 60))
        // Dragged 50 minutes down: the end moves to 8:45 (rounded to 15 min).
        #expect(CalendarPick.dragRange(downMinute: 19 * 60 + 5, currentMinute: 19 * 60 + 55) == (19 * 60)...(20 * 60 + 45))
    }

    @Test func draggingUpNeverGoesBelowFifteenMinutes() {
        #expect(CalendarPick.dragRange(downMinute: 600, currentMinute: 400) == 600...615)
    }

    @Test func dragsStayWithinTheDay() {
        let late = CalendarPick.dragRange(downMinute: 23 * 60 + 50, currentMinute: 24 * 60)
        #expect(late.lowerBound == 23 * 60 + 45)
        #expect(late.upperBound == 24 * 60)
    }

    @Test func draggedRangesInThePastMoveForwardKeepingTheirLength() {
        let now = day.addingTimeInterval(15 * 3600 + 5 * 60) // 3:05 PM
        let (start, end) = CalendarPick.dates(day: day, range: (14 * 60)...(15 * 60 + 30), now: now)
        #expect(start == day.addingTimeInterval(15.25 * 3600))
        #expect(end.timeIntervalSince(start) == 90 * 60)
    }
}
