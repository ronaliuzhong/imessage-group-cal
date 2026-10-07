import Foundation
import Testing
@testable import GroupCal

struct GlanceTests {
    // A day from 0:00 to 24:00 (as hours after an arbitrary midnight).
    let midnight = Date(timeIntervalSince1970: 1_800_000_000)
    func at(_ hours: Double) -> Date { midnight.addingTimeInterval(hours * 3600) }

    func segment(_ start: Double, _ end: Double, busy: [String]) -> Availability.Segment {
        .init(start: at(start), end: at(end), busyMemberIds: busy)
    }

    // You: busy 9–12. Sam: busy 11–14. Jo: calendar not connected.
    var availability: Availability {
        Availability(
            group: GroupSummary(id: "g", name: "Test", autoNamed: false, inviteCode: "c", joinUrl: URL(string: "https://example.com/join/c")!),
            members: [
                .init(id: "you", name: "You", isYou: true, connected: true),
                .init(id: "sam", name: "Sam", isYou: false, connected: true),
                .init(id: "jo", name: "Jo", isYou: false, connected: false),
            ],
            segments: [
                segment(0, 9, busy: []),
                segment(9, 11, busy: ["you"]),
                segment(11, 12, busy: ["sam", "you"]),
                segment(12, 14, busy: ["sam"]),
                segment(14, 24, busy: []),
            ],
            plans: [],
            upcoming: []
        )
    }

    @Test func busyUntilTheEndOfTheirBusyStretch() {
        // At 10 you're busy; your busy time continues through 11–12.
        #expect(availability.status(of: "you", at: at(10)) == .busy(until: at(12)))
        #expect(availability.status(of: "sam", at: at(11.5)) == .busy(until: at(14)))
    }

    @Test func freeUntilTheirNextBusyTime() {
        // At 10 Sam is free, until their busy time starts at 11.
        #expect(availability.status(of: "sam", at: at(10)) == .free(until: at(11)))
        #expect(availability.status(of: "you", at: at(8)) == .free(until: at(9)))
    }

    @Test func freeForTheRestOfTheDay() {
        #expect(availability.status(of: "you", at: at(13)) == .free(until: nil))
        #expect(availability.status(of: "sam", at: at(20)) == .free(until: nil))
    }

    @Test func noStatusWithoutACalendarOrOutsideTheDay() {
        #expect(availability.status(of: "jo", at: at(10)) == nil)
        #expect(availability.status(of: "you", at: at(25)) == nil)
        #expect(availability.status(of: "nobody", at: at(10)) == nil)
    }

    @Test func findsWhoIsBusyDuringAProposedTime() {
        // You: busy 9–12. Sam: busy 11–14.
        #expect(availability.busyMembers(from: at(8), to: at(9))?.map(\.id) == [])
        #expect(availability.busyMembers(from: at(8), to: at(10))?.map(\.id) == ["you"])
        #expect(availability.busyMembers(from: at(10), to: at(13))?.map(\.id) == ["you", "sam"])
        #expect(availability.busyMembers(from: at(12), to: at(15))?.map(\.id) == ["sam"])
        // Outside the loaded day: unknown.
        #expect(availability.busyMembers(from: at(23), to: at(25)) == nil)
    }

    @Test func joinsEachPersonsBusyTimeIntoStretches() {
        // You: busy 9–11 and 11–12 (split because Sam's status changed) → 9–12.
        #expect(availability.busyStretches(of: "you", from: at(0), to: at(24))
            == [DateInterval(start: at(9), end: at(12))])
        #expect(availability.busyStretches(of: "sam", from: at(0), to: at(24))
            == [DateInterval(start: at(11), end: at(14))])
        // Clipped to the range asked for.
        #expect(availability.busyStretches(of: "you", from: at(10), to: at(11.5))
            == [DateInterval(start: at(10), end: at(11.5))])
        #expect(availability.busyStretches(of: "jo", from: at(0), to: at(24)).isEmpty)
    }

    @Test func countsWhoIsFree() {
        let a = availability
        #expect(a.connectedMembers.map(\.id) == ["you", "sam"])
        #expect(a.unconnectedMembers.map(\.id) == ["jo"])
        #expect(a.freeCount(in: a.segments[0]) == 2)
        #expect(a.freeCount(in: a.segments[2]) == 0)
        #expect(a.freeCount(in: a.segments[3]) == 1)
    }
}
