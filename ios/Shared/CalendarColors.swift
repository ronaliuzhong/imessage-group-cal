import Foundation

/// Google Calendar's 11 event colors, the same presets as the website's
/// (src/lib/colors.ts): picking one matches Google Calendar exactly.
enum CalendarColors {
    struct Preset: Identifiable, Sendable {
        /// Google's colorId.
        let id: String
        let name: String
        let hex: String
    }

    static let presets: [Preset] = [
        Preset(id: "11", name: "Tomato", hex: "#D50000"),
        Preset(id: "4", name: "Flamingo", hex: "#E67C73"),
        Preset(id: "6", name: "Tangerine", hex: "#F4511E"),
        Preset(id: "5", name: "Banana", hex: "#F6BF26"),
        Preset(id: "2", name: "Sage", hex: "#33B679"),
        Preset(id: "10", name: "Basil", hex: "#0B8043"),
        Preset(id: "7", name: "Peacock", hex: "#039BE5"),
        Preset(id: "9", name: "Blueberry", hex: "#3F51B5"),
        Preset(id: "1", name: "Lavender", hex: "#7986CB"),
        Preset(id: "3", name: "Grape", hex: "#8E24AA"),
        Preset(id: "8", name: "Graphite", hex: "#616161"),
    ]
}
