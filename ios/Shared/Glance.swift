import Foundation

/// Where someone stands at a moment: free or busy, and until when.
enum MemberStatus: Equatable, Sendable {
    /// `until` is nil when they're free for the rest of the range.
    case free(until: Date?)
    case busy(until: Date)
}

extension Availability {
    /// Members whose calendar we can read.
    var connectedMembers: [Member] { members.filter(\.connected) }

    /// Members we're "Waiting for...": in the group, calendar not connected.
    var unconnectedMembers: [Member] { members.filter { !$0.connected } }

    /// Whether `memberId` is free or busy at `moment`, and until when. Nil if
    /// we can't read their calendar or `moment` is outside the range.
    func status(of memberId: String, at moment: Date) -> MemberStatus? {
        guard members.contains(where: { $0.id == memberId && $0.connected }),
              let first = segments.firstIndex(where: { $0.start <= moment && moment < $0.end })
        else { return nil }

        // Walk forward while their status stays the same. Neighboring
        // segments differ in who's busy, but not necessarily for this person.
        let busy = segments[first].busyMemberIds.contains(memberId)
        var last = first
        while last + 1 < segments.count, segments[last + 1].busyMemberIds.contains(memberId) == busy {
            last += 1
        }
        let until = segments[last].end
        if busy { return .busy(until: until) }
        return .free(until: last == segments.count - 1 ? nil : until)
    }

    /// Who's busy at any point between `start` and `end` (for "Sam is busy
    /// then" when proposing a time). Nil if that time isn't loaded.
    func busyMembers(from start: Date, to end: Date) -> [Member]? {
        guard let first = segments.first, let last = segments.last,
              first.start <= start, last.end >= end
        else { return nil }
        let busyIds = Set(segments.filter { $0.start < end && $0.end > start }.flatMap(\.busyMemberIds))
        return connectedMembers.filter { busyIds.contains($0.id) }
    }

    /// How many connected members are free during `segment`.
    func freeCount(in segment: Segment) -> Int {
        connectedMembers.count - segment.busyMemberIds.count
    }
}
