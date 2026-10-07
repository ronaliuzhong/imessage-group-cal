import MapKit
import Observation

/// Apple Maps place suggestions as someone types a location ("Joe's Pi…" →
/// "Joe's Pizza, 7 Carmine St, New York"), like Google Calendar's. Uses
/// MapKit's search completer: free, no account or location permission.
@MainActor
@Observable
final class LocationSearch: NSObject, MKLocalSearchCompleterDelegate {
    struct Suggestion: Identifiable, Equatable {
        let id = UUID()
        let title: String
        let subtitle: String

        /// What goes in the plan's location: "Joe's Pizza, 7 Carmine St, New York".
        var text: String { subtitle.isEmpty ? title : "\(title), \(subtitle)" }
    }

    private(set) var suggestions: [Suggestion] = []
    private let completer = MKLocalSearchCompleter()

    override init() {
        super.init()
        completer.delegate = self
        completer.resultTypes = [.pointOfInterest, .address]
    }

    /// Call as the text changes. Short text clears the suggestions.
    func update(_ text: String) {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.count < 2 {
            suggestions = []
            completer.cancel()
        } else {
            completer.queryFragment = query
        }
    }

    func clear() {
        suggestions = []
        completer.cancel()
    }

    // MapKit calls these on the main thread.
    nonisolated func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
        MainActor.assumeIsolated {
            // Apple sometimes lists the same place twice; keep the first.
            var seen = Set<String>()
            suggestions = self.completer.results
                .map { Suggestion(title: $0.title, subtitle: $0.subtitle) }
                .filter { seen.insert($0.text).inserted }
                .prefix(5)
                .map { $0 }
        }
    }

    nonisolated func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
        MainActor.assumeIsolated { suggestions = [] }
    }

    /// Opens a location in Apple Maps.
    static func mapsURL(for location: String) -> URL {
        var components = URLComponents(string: "https://maps.apple.com/")!
        components.queryItems = [URLQueryItem(name: "q", value: location)]
        return components.url!
    }
}
