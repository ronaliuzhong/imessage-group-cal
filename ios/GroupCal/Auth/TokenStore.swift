import Foundation
import Security

/// Keeps the app's sign-in token in the iPhone's Keychain, the system's
/// encrypted password storage. (Later, the iMessage extension and widget will
/// read it from a shared Keychain group.)
enum TokenStore {
    private static let service = "com.ronaliuzhong.groupcal"
    private static let account = "appToken"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
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
