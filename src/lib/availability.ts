// Pure scheduling math: no Google, no database, so it's easy to unit test.

import type { BusyBlock } from "@/lib/google";

export type MemberBusy = { memberId: string; busy: BusyBlock[] };

// A stretch of time during which the same set of people are busy.
// Times are milliseconds since the Unix epoch (what Date.getTime() returns).
export type Segment = { start: number; end: number; busyMemberIds: string[] };

// Splits [rangeStart, rangeEnd) into consecutive segments, each labeled with
// who is busy during it. Adjacent segments always differ in who's busy.
//
// How: every busy block's start and end is a moment where somebody's status
// changes. Between two neighboring moments nobody's status changes, so we
// check each gap once and merge neighbors that come out the same.
export function computeSegments(
  members: MemberBusy[],
  rangeStart: number,
  rangeEnd: number,
): Segment[] {
  const intervals = members
    .flatMap(({ memberId, busy }) =>
      busy.map((block) => ({
        memberId,
        start: Math.max(Date.parse(block.start), rangeStart),
        end: Math.min(Date.parse(block.end), rangeEnd),
      })),
    )
    .filter((interval) => interval.start < interval.end);

  const moments = [
    ...new Set([rangeStart, rangeEnd, ...intervals.flatMap((i) => [i.start, i.end])]),
  ].sort((a, b) => a - b);

  const segments: Segment[] = [];
  for (let k = 0; k < moments.length - 1; k++) {
    const start = moments[k];
    const end = moments[k + 1];
    // Keeps member order stable, so two busy lists can be compared by join().
    const busyMemberIds = members
      .map((m) => m.memberId)
      .filter((id) =>
        intervals.some((i) => i.memberId === id && i.start < end && i.end > start),
      );

    const previous = segments.at(-1);
    if (previous && previous.busyMemberIds.join() === busyMemberIds.join()) {
      previous.end = end;
    } else {
      segments.push({ start, end, busyMemberIds });
    }
  }
  return segments;
}
