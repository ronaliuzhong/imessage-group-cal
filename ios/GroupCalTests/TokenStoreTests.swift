import Testing
@testable import GroupCal

// Saving under the App Group only works if the app has the App Group
// entitlement, so this also checks the project is set up right.
@Suite(.serialized)
struct TokenStoreTests {
    @Test func savesReadsAndDeletesTheToken() {
        let previous = TokenStore.read()
        defer {
            if let previous { TokenStore.save(previous) } else { TokenStore.delete() }
        }

        TokenStore.save("test-token-1")
        #expect(TokenStore.read() == "test-token-1")
        TokenStore.save("test-token-2")
        #expect(TokenStore.read() == "test-token-2")
        TokenStore.delete()
        #expect(TokenStore.read() == nil)
    }
}
