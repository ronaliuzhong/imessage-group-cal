import Foundation
import Security

/// Keeps the sign-in token in the iPhone's Keychain, the system's encrypted
/// password storage. It's stored under the App Group, so the app signs in
/// once and the iMessage extension (and later the widget) can use it too.
enum TokenStore {
    /// The App Group ID, from Info.plist (set in project.yml from
    /// Signing.xcconfig, so it follows whoever's Apple account builds it).
    static let appGroup: String = {
        guard let id = Bundle.main.object(forInfoDictionaryKey: "AppGroupID") as? String, !id.isEmpty else {
            fatalError("AppGroupID is missing from Info.plist (see project.yml)")
        }
        return id
    }()
    /// Just a label for the Keychain entry. Changing it would sign everyone
    /// out once, so it stays as it was.
    private static let service = "com.ronaliuzhong.groupcal"
    private static let account = "appToken"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: appGroup,
        ]
    }

    static func save(_ token: String) {
        delete()
        var query = baseQuery
        query[kSecValueData as String] = Data(token.utf8)
        // Readable after the phone's first unlock, so the widget can use it
        // in the background.
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(query as CFDictionary, nil)
        assert(status == errSecSuccess, "Couldn't save the token to the Keychain: \(status)")
    }

    static func read() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
