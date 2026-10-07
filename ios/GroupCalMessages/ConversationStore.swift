import Foundation
import Messages

/// Remembers which Coucal group belongs to which chat, on this device.
///
/// Messages doesn't give extensions a chat ID or name, only anonymous IDs for
/// the people in it, so a chat is recognized by that set of IDs. If someone
/// joins or leaves the chat, the set changes and the chat is forgotten; tapping
/// any Coucal bubble in it links it again.
enum ConversationStore {
    /// Storage shared through the App Group.
    private static var defaults: UserDefaults {
        UserDefaults(suiteName: TokenStore.appGroup) ?? .standard
    }
    private static let storageKey = "groupIdByConversation"

    static func key(for conversation: MSConversation) -> String {
        ([conversation.localParticipantIdentifier] + conversation.remoteParticipantIdentifiers)
            .map(\.uuidString)
            .sorted()
            .joined(separator: ",")
    }

    static func groupId(for key: String) -> String? {
        mapping[key]
    }

    static func save(groupId: String, for key: String) {
        var updated = mapping
        updated[key] = groupId
        defaults.set(updated, forKey: storageKey)
    }

    static func forget(key: String) {
        var updated = mapping
        updated[key] = nil
        defaults.set(updated, forKey: storageKey)
    }

    private static var mapping: [String: String] {
        defaults.dictionary(forKey: storageKey) as? [String: String] ?? [:]
    }
}
