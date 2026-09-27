import Foundation

enum Config {
    /// The Group Cal server: the Mac's dev server when running from Xcode,
    /// the live site in release builds. Set per build in project.yml.
    static let apiBaseURL: URL = {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let url = URL(string: value)
        else { fatalError("API_BASE_URL is missing from Info.plist (see project.yml)") }
        return url
    }()

    /// Where the sign-in window hands control back to the app. Must match
    /// APP_CALLBACK_URL in src/lib/app-auth.ts on the server.
    static let callbackScheme = "groupcal"
}
