import Foundation
import Testing
@testable import GroupCal

struct PlanTimeTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
    }

    // Formatting uses the device's language, so only check the shape.
    @Test func sameDayShowsTheDateOnce() {
        let text = PlanTime.describe(date(3, 19), date(3, 20, 30), calendar: calendar)
        #expect(text.contains("·"))
        #expect(text.components(separatedBy: "Oct").count == 2) // "Oct" appears once
    }

    @Test func endingAtMidnightIsStillTheSameDay() {
        let text = PlanTime.describe(date(3, 22), date(4, 0), calendar: calendar)
        #expect(text.contains("·"))
    }

    @Test func overnightShowsBothDates() {
        let text = PlanTime.describe(date(3, 22), date(4, 2), calendar: calendar)
        #expect(!text.contains("·"))
        #expect(text.components(separatedBy: "Oct").count == 3) // "Oct" appears twice
    }
}
