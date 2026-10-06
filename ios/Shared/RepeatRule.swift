import Foundation

/// How a plan repeats, in the same shape the server (and the website) uses.
struct RepeatRule: Codable, Equatable, Sendable {
    enum Frequency: String, Codable, CaseIterable, Sendable {
        case daily = "DAILY"
        case weekly = "WEEKLY"
        case monthly = "MONTHLY"
    }

    enum Ends: String, Codable, CaseIterable, Sendable {
        case never
        /// On `untilDate`.
        case on
        /// After `count` times.
        case after
    }

    var freq: Frequency
    /// Every N days / weeks / months.
    var interval = 1
    /// Weekly only: 0 = Sunday … 6 = Saturday. Empty = the start's weekday.
    var weekdays: [Int] = []
    var ends: Ends = .never
    /// "YYYY-MM-DD", when `ends` is `.on`.
    var untilDate = ""
    /// When `ends` is `.after`.
    var count = 10

    static let maxInterval = 30
    static let maxCount = 100
}

/// The quick choices, like the website's: most plans use one of these.
enum RepeatPreset: String, CaseIterable, Identifiable, Sendable {
    case none, daily, weekly, weekdays, monthly, custom
    var id: Self { self }

    /// The rule for this choice, for a plan starting at `start` (nil =
    /// doesn't repeat; `.custom` starts from "weekly").
    func rule(for start: Date, calendar: Calendar = .current) -> RepeatRule? {
        let weekday = calendar.component(.weekday, from: start) - 1 // 0 = Sunday
        switch self {
        case .none: return nil
        case .daily: return RepeatRule(freq: .daily)
        case .weekly, .custom: return RepeatRule(freq: .weekly, weekdays: [weekday])
        case .weekdays: return RepeatRule(freq: .weekly, weekdays: [1, 2, 3, 4, 5])
        case .monthly: return RepeatRule(freq: .monthly)
        }
    }

    /// Which quick choice a rule matches (`.custom` if none).
    init(_ rule: RepeatRule?, start: Date, calendar: Calendar = .current) {
        guard let rule else {
            self = .none
            return
        }
        for preset in [RepeatPreset.daily, .weekly, .weekdays, .monthly] {
            let p = preset.rule(for: start, calendar: calendar)!
            if rule.freq == p.freq, rule.interval == 1, rule.ends == .never,
               Self.days(rule, start, calendar) == Self.days(p, start, calendar) {
                self = preset
                return
            }
        }
        self = .custom
    }

    /// The menu label: "Weekly on Thursday", "Monthly on day 4".
    func label(for start: Date, calendar: Calendar = .current) -> String {
        switch self {
        case .none: "Doesn't repeat"
        case .daily: "Daily"
        case .weekly: "Weekly on \(calendar.weekdaySymbols[calendar.component(.weekday, from: start) - 1])"
        case .weekdays: "Every weekday (Mon–Fri)"
        case .monthly: "Monthly on day \(calendar.component(.day, from: start))"
        case .custom: "Custom…"
        }
    }

    private static func days(_ rule: RepeatRule, _ start: Date, _ calendar: Calendar) -> [Int] {
        guard rule.freq == .weekly else { return [] }
        let days = rule.weekdays.isEmpty ? [calendar.component(.weekday, from: start) - 1] : rule.weekdays
        return Array(Set(days)).sorted()
    }
}

extension RepeatRule {
    /// A plain-English summary, like the website's: "Every 2 weeks on Mon,
    /// Wed · 6 times".
    func summary(start: Date, calendar: Calendar = .current) -> String {
        let unit = [Frequency.daily: "day", .weekly: "week", .monthly: "month"][freq]!
        var text = interval == 1
            ? [Frequency.daily: "Daily", .weekly: "Weekly", .monthly: "Monthly"][freq]!
            : "Every \(interval) \(unit)s"
        switch freq {
        case .weekly:
            let days = Array(Set(weekdays.isEmpty ? [calendar.component(.weekday, from: start) - 1] : weekdays)).sorted()
            if days == [1, 2, 3, 4, 5] {
                text += " on weekdays"
            } else if days.count == 1 {
                text += " on \(calendar.weekdaySymbols[days[0]])"
            } else {
                text += " on " + days.map { calendar.shortWeekdaySymbols[$0] }.joined(separator: ", ")
            }
        case .monthly:
            text += " on day \(calendar.component(.day, from: start))"
        case .daily:
            break
        }
        switch ends {
        case .never: break
        case .after: text += " · \(count) times"
        case .on: text += " · until \(untilDate)"
        }
        return text
    }
}
