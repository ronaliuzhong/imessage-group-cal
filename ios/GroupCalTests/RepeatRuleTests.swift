import Foundation
import Testing
@testable import GroupCal

struct RepeatRuleTests {
    var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    /// Thursday, Oct 1, 2026, 7 PM New York.
    var thursday: Date { calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 19))! }

    @Test func presetsMakeTheSameRulesAsTheWebsite() {
        #expect(RepeatPreset.none.rule(for: thursday, calendar: calendar) == nil)
        #expect(RepeatPreset.daily.rule(for: thursday, calendar: calendar) == RepeatRule(freq: .daily))
        #expect(RepeatPreset.weekly.rule(for: thursday, calendar: calendar) == RepeatRule(freq: .weekly, weekdays: [4]))
        #expect(RepeatPreset.weekdays.rule(for: thursday, calendar: calendar) == RepeatRule(freq: .weekly, weekdays: [1, 2, 3, 4, 5]))
        #expect(RepeatPreset.monthly.rule(for: thursday, calendar: calendar) == RepeatRule(freq: .monthly))
    }

    @Test func recognizesWhichPresetARuleIs() {
        #expect(RepeatPreset(nil, start: thursday, calendar: calendar) == .none)
        #expect(RepeatPreset(RepeatRule(freq: .weekly, weekdays: [4]), start: thursday, calendar: calendar) == .weekly)
        // No weekdays picked means "the start's day".
        #expect(RepeatPreset(RepeatRule(freq: .weekly), start: thursday, calendar: calendar) == .weekly)
        #expect(RepeatPreset(RepeatRule(freq: .weekly, weekdays: [5, 1, 2, 3, 4]), start: thursday, calendar: calendar) == .weekdays)
        // Anything else is custom.
        #expect(RepeatPreset(RepeatRule(freq: .weekly, interval: 2, weekdays: [4]), start: thursday, calendar: calendar) == .custom)
        #expect(RepeatPreset(RepeatRule(freq: .daily, ends: .after, count: 5), start: thursday, calendar: calendar) == .custom)
    }

    @Test func labelsReadLikeTheWebsite() {
        #expect(RepeatPreset.weekly.label(for: thursday, calendar: calendar) == "Weekly on Thursday")
        #expect(RepeatPreset.monthly.label(for: thursday, calendar: calendar) == "Monthly on day 1")
        #expect(RepeatRule(freq: .weekly, weekdays: [4], ends: .after, count: 5).summary(start: thursday, calendar: calendar)
            == "Weekly on Thursday · 5 times")
        #expect(RepeatRule(freq: .weekly, interval: 2, weekdays: [1, 3]).summary(start: thursday, calendar: calendar)
            == "Every 2 weeks on Mon, Wed")
        #expect(RepeatRule(freq: .weekly, weekdays: [1, 2, 3, 4, 5]).summary(start: thursday, calendar: calendar)
            == "Weekly on weekdays")
    }

    @Test func encodesTheWayTheServerExpects() throws {
        let json = try JSONEncoder().encode(RepeatRule(freq: .weekly, weekdays: [4], ends: .after, count: 5))
        let object = try JSONSerialization.jsonObject(with: json) as! [String: Any]
        #expect(object["freq"] as? String == "WEEKLY")
        #expect(object["ends"] as? String == "after")
        #expect(object["weekdays"] as? [Int] == [4])
        #expect(object["count"] as? Int == 5)
    }
}
