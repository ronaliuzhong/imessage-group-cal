import Foundation

enum PlanTime {
    /// "Sat, Oct 4 · 7:00 – 8:30 PM", or with both dates if it runs past
    /// midnight.
    static func describe(_ start: Date, _ end: Date, calendar: Calendar = .current) -> String {
        let day = Date.FormatStyle(calendar: calendar, timeZone: calendar.timeZone).weekday(.abbreviated).month(.abbreviated).day()
        let time = Date.FormatStyle(date: .omitted, time: .shortened, calendar: calendar, timeZone: calendar.timeZone)
        // Ending exactly at midnight still counts as the same day.
        let lastMoment = end.addingTimeInterval(-1)
        if calendar.isDate(start, inSameDayAs: lastMoment) {
            return "\(start.formatted(day)) · \(start.formatted(time)) – \(end.formatted(time))"
        }
        return "\(start.formatted(day)) \(start.formatted(time)) – \(end.formatted(day)) \(end.formatted(time))"
    }
}
