"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { computeSegments, type Segment } from "@/lib/availability";
import type { CalendarMember } from "@/lib/calendar-data";
import type { CalendarPlan } from "@/lib/plans";

const HOUR_PX = 44; // height of one hour row
const INITIAL_SCROLL_HOUR = 7; // open scrolled to 7am; earlier/later is a scroll away
const MINUTE_PX = HOUR_PX / 60;

type Props = {
  members: CalendarMember[];
  viewerId: string;
  weekOffset: number;
  // "personal": one person's busy blocks. "group": a heat map of who's free.
  variant: "personal" | "group";
  // If set, clicking the calendar picks a start time (snapped to the half hour).
  onPickTime?: (start: Date) => void;
  // A time range to outline, e.g. the plan being proposed.
  selection?: { start: Date; end: Date } | null;
  // Group plans, drawn as purple blocks with their names on top of everything.
  plans?: CalendarPlan[];
  // Show which group each plan belongs to (the home page mixes groups).
  showPlanGroup?: boolean;
};

type Hover =
  | { kind: "segment"; segment: Segment; x: number; y: number }
  | { kind: "plan"; plan: CalendarPlan; x: number; y: number };

// Phones can't hover, so tapping a time pins its details at the bottom of the
// screen instead (with a button to propose that time).
type Tapped = { segment: Segment; start: Date; weekOffset: number };

const SNAP_MINUTES = 30;
// Phone-sized: narrow hour labels. From the `sm` breakpoint up: roomier.
const COLUMNS = "grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] sm:grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]";
// Fits a phone screen, capped at the desktop height.
const HEIGHT = "h-[75svh] max-h-[640px]";

// The server doesn't know the viewer's timezone, so rendering there would put
// blocks at the wrong hours. This reports false during server rendering and
// true in the browser, and we only draw the grid once it's true.
const noopSubscribe = () => () => {};
function useIsBrowser() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function WeekCalendar(props: Props) {
  if (!useIsBrowser()) {
    return <div className={`${HEIGHT} animate-pulse rounded-xl border border-zinc-200 dark:border-zinc-800`} />;
  }
  return <CalendarGrid {...props} />;
}

const dayName = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const hourLabel = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

// Position on the day's timeline, in minutes after midnight (local time).
function minutesIntoDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

// "Thu, Oct 1 · 7:00 – 9:30 PM" (or with both dates if it spans days).
function formatRange(start: Date, end: Date) {
  const sameDay = start.toDateString() === end.toDateString() || minutesIntoDay(end) === 0;
  return sameDay
    ? `${longDate.format(start)} · ${clock.format(start)} – ${clock.format(end)}`
    : `${longDate.format(start)} ${clock.format(start)} – ${longDate.format(end)} ${clock.format(end)}`;
}

function CalendarGrid({
  members,
  viewerId,
  weekOffset,
  variant,
  onPickTime,
  selection,
  plans = [],
  showPlanGroup = false,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  // Whether the latest press was a finger (vs. a mouse), read when the click lands.
  const touchRef = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: INITIAL_SCROLL_HOUR * HOUR_PX });
  }, []);

  // Sunday through Saturday of the current week (plus 7 days per week of
  // offset), in local time. getDay() is 0 on Sunday, so subtracting it lands on
  // this week's Sunday. Building dates from year/month/day keeps each one at
  // local midnight, even across daylight-saving changes.
  const now = new Date();
  const sunday = now.getDate() - now.getDay() + weekOffset * 7;
  const days = Array.from(
    { length: 8 }, // 8 midnights = the start and end of 7 days
    (_, i) => new Date(now.getFullYear(), now.getMonth(), sunday + i),
  );

  // Only people whose calendar we could read count towards "who's free".
  const connected = members.filter((m) => m.busy !== null);
  const segments = computeSegments(
    connected.map((m) => ({ memberId: m.id, busy: m.busy! })),
    days[0].getTime(),
    days[7].getTime(),
  );

  const nameOf = (id: string) =>
    id === viewerId ? "You" : (members.find((m) => m.id === id)?.name ?? "Someone");

  // Left over from a different week (after tapping ‹ Prev / Next ›)? Hide it.
  const tappedNow = tapped?.weekOffset === weekOffset ? tapped : null;

  return (
    <div className="flex flex-col gap-3">
      <WeekNav weekOffset={weekOffset} first={days[0]} last={days[6]} />

      <div
        ref={scrollRef}
        className={`${HEIGHT} overflow-y-auto rounded-xl border border-zinc-200 dark:border-zinc-800`}
      >
        {/* Day names row: stays pinned while the hours scroll underneath. */}
        <div className={`sticky top-0 z-10 grid ${COLUMNS} border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950`}>
          <div />
          {days.slice(0, 7).map((day) => {
            const isToday = day.toDateString() === now.toDateString();
            return (
              <div key={day.getTime()} className="py-2 text-center">
                <div className="text-[10px] uppercase text-zinc-500 sm:text-xs">{dayName.format(day)}</div>
                <div
                  className={`mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-base sm:h-8 sm:w-8 sm:text-lg ${
                    isToday ? "bg-emerald-600 font-semibold text-white" : ""
                  }`}
                >
                  {day.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        <div className={`grid ${COLUMNS}`}>
          {/* Hour labels down the left edge. */}
          <div className="relative" style={{ height: 24 * HOUR_PX }}>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 whitespace-nowrap text-[10px] text-zinc-500 sm:right-2 sm:text-xs"
                style={{ top: hour * HOUR_PX }}
              >
                {hourLabel.format(new Date(2000, 0, 1, hour))}
              </div>
            ))}
          </div>

          {days.slice(0, 7).map((dayStart, i) => {
            const dayEnd = days[i + 1];
            const isToday = dayStart.toDateString() === now.toDateString();
            return (
              <div
                key={dayStart.getTime()}
                className={`relative border-l border-zinc-200 dark:border-zinc-800 ${onPickTime ? "cursor-pointer" : ""}`}
                style={{ height: 24 * HOUR_PX }}
                onPointerDown={(e) => {
                  touchRef.current = e.pointerType !== "mouse";
                }}
                onClick={(e) => {
                  // Where in the column was clicked → minutes after midnight.
                  const offsetPx = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const exact = offsetPx / MINUTE_PX;
                  const snapped = Math.floor(exact / SNAP_MINUTES) * SNAP_MINUTES;
                  const at = (minutes: number) =>
                    new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, minutes);
                  if (touchRef.current) {
                    const tappedAt = at(exact).getTime();
                    const segment = segments.find((s) => s.start <= tappedAt && s.end > tappedAt);
                    if (segment) return setTapped({ segment, start: at(snapped), weekOffset });
                  }
                  onPickTime?.(at(snapped));
                }}
              >
                {/* Faint line at each hour. */}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-900"
                    style={{ top: hour * HOUR_PX }}
                  />
                ))}

                {/* Segments overlapping this day, clipped to it. */}
                {segments
                  .filter((s) => s.start < dayEnd.getTime() && s.end > dayStart.getTime())
                  .map((segment) => {
                    const top = minutesIntoDay(new Date(Math.max(segment.start, dayStart.getTime())));
                    const bottom =
                      segment.end >= dayEnd.getTime() ? 24 * 60 : minutesIntoDay(new Date(segment.end));
                    const look = blockLook(segment, connected.length, variant);
                    return (
                      <div
                        key={segment.start}
                        className={`absolute inset-x-0.5 overflow-hidden rounded-md px-1 text-[10px] leading-tight sm:px-1.5 sm:text-xs ${look.className} ${
                          tappedNow?.segment.start === segment.start ? "ring-2 ring-inset ring-zinc-900 dark:ring-white" : ""
                        }`}
                        style={{ top: top * MINUTE_PX, height: (bottom - top) * MINUTE_PX, ...look.style }}
                        // Hover cards are for mice only; fingers get the tap card instead.
                        onPointerMove={(e) =>
                          e.pointerType === "mouse" && setHover({ kind: "segment", segment, x: e.clientX, y: e.clientY })
                        }
                        onPointerLeave={() => setHover(null)}
                      >
                        {look.label && (bottom - top) * MINUTE_PX >= 18 && (
                          <>
                            <span className="block pt-0.5 sm:hidden">{look.shortLabel}</span>
                            <span className="hidden leading-5 sm:inline">{look.label}</span>
                          </>
                        )}
                      </div>
                    );
                  })}

                {/* Plans, on top of the free/busy view. Clicking opens the plan. */}
                {plans
                  .filter((p) => new Date(p.start) < dayEnd && new Date(p.end) > dayStart)
                  .map((plan) => {
                    const start = new Date(plan.start);
                    const end = new Date(plan.end);
                    const top = minutesIntoDay(start < dayStart ? dayStart : start);
                    const bottom = end >= dayEnd ? 24 * 60 : minutesIntoDay(end);
                    const heightPx = (bottom - top) * MINUTE_PX;
                    return (
                      <Link
                        key={plan.id}
                        // Repeating plans open on this particular date.
                        href={
                          plan.repeatLabel
                            ? `/p/${plan.shareCode}?at=${encodeURIComponent(plan.originalStart)}`
                            : `/p/${plan.shareCode}`
                        }
                        // Don't also trigger "propose a time here" on the column.
                        onClick={(e) => e.stopPropagation()}
                        onPointerMove={(e) =>
                          e.pointerType === "mouse" && setHover({ kind: "plan", plan, x: e.clientX, y: e.clientY })
                        }
                        onPointerLeave={() => setHover(null)}
                        className={`absolute inset-x-0.5 z-[3] overflow-hidden rounded-md px-1 py-0.5 text-[10px] leading-tight shadow-sm hover:brightness-95 sm:inset-x-1 sm:px-1.5 sm:text-xs sm:leading-normal ${plan.myResponse === "NOT_GOING" ? "line-through opacity-50" : ""}`}
                        style={{ top: top * MINUTE_PX, height: heightPx, ...planStyle(plan) }}
                      >
                        {/* Phones: the name wraps onto as many lines as fit. */}
                        <div className="break-words font-semibold sm:truncate">{plan.title}</div>
                        {heightPx >= 34 && (
                          <div className="hidden truncate opacity-90 sm:block">
                            {clock.format(start)} – {clock.format(end)}
                          </div>
                        )}
                      </Link>
                    );
                  })}

                {/* Fade out time that's already passed. Hover still works through it. */}
                {dayStart < now && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 z-[4] bg-white/60 dark:bg-zinc-950/60"
                    style={{ height: (dayEnd <= now ? 24 * 60 : minutesIntoDay(now)) * MINUTE_PX }}
                  />
                )}

                {/* Outline of the selected range, clipped to this day. */}
                {selection && selection.start < dayEnd && selection.end > dayStart && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[6] rounded-md border-2 border-zinc-900 bg-zinc-900/10 dark:border-white dark:bg-white/10"
                    style={{
                      top: minutesIntoDay(selection.start < dayStart ? dayStart : selection.start) * MINUTE_PX,
                      bottom:
                        selection.end >= dayEnd
                          ? 0
                          : (24 * 60 - minutesIntoDay(selection.end)) * MINUTE_PX,
                    }}
                  />
                )}

                {/* Red "now" line on today's column. */}
                {isToday && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-[5] border-t-2 border-red-500"
                    style={{ top: minutesIntoDay(now) * MINUTE_PX }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Legend variant={variant} hasPlans={plans.length > 0} />

      {tappedNow && (
        <TapCard onClose={() => setTapped(null)}>
          <SegmentDetails
            segment={tappedNow.segment}
            variant={variant}
            nameOf={nameOf}
            memberIds={connected.map((m) => m.id)}
          />
          {onPickTime && (
            <button
              onClick={() => {
                onPickTime(tappedNow.start);
                setTapped(null);
              }}
              className="mt-3 w-full rounded-lg bg-black px-4 py-2 font-medium text-white dark:bg-white dark:text-black"
            >
              Propose {clock.format(tappedNow.start)} on {longDate.format(tappedNow.start)}
            </button>
          )}
        </TapCard>
      )}

      {hover && (
        <HoverCard x={hover.x} y={hover.y}>
          {hover.kind === "segment" ? (
            <SegmentDetails
              segment={hover.segment}
              variant={variant}
              nameOf={nameOf}
              memberIds={connected.map((m) => m.id)}
            />
          ) : (
            <PlanDetails plan={hover.plan} viewerId={viewerId} showGroup={showPlanGroup} />
          )}
        </HoverCard>
      )}
    </div>
  );
}

// Drawn in the group's color. Solid = you're going; dashed outline = you
// haven't answered; faded and crossed out (see className) = you can't make it.
function planStyle(plan: CalendarPlan): React.CSSProperties {
  const { hex, text } = plan.color;
  if (plan.myResponse === "GOING") return { backgroundColor: hex, color: text };
  return {
    // "26" on the end of a hex color = ~15% opacity: a light tint of the color.
    backgroundColor: `${hex}26`,
    border: `2px ${plan.myResponse === "NOT_GOING" ? "solid" : "dashed"} ${hex}`,
    color: "inherit",
  };
}

// How a block is colored/labeled.
function blockLook(segment: Segment, memberCount: number, variant: Props["variant"]) {
  const free = memberCount - segment.busyMemberIds.length;

  // shortLabel is for phones, where each day column is only ~45px wide.
  if (variant === "personal") {
    return free === 0
      ? { className: "bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100", label: "Busy", shortLabel: "Busy", style: {} }
      : { className: "hover:bg-emerald-50 dark:hover:bg-emerald-950", label: "", shortLabel: "", style: {} };
  }

  if (memberCount === 0 || free === 0) {
    return { className: "hover:bg-zinc-100 dark:hover:bg-zinc-900", label: "", shortLabel: "", style: {} };
  }
  if (free === memberCount) {
    return { className: "bg-emerald-500 font-medium text-white", label: "Everyone free", shortLabel: "All free", style: {} };
  }
  // Partially free: the more people free, the stronger the green.
  const opacity = 0.12 + 0.5 * (free / memberCount);
  return {
    className: "text-emerald-900 dark:text-emerald-100",
    label: `${free}/${memberCount} free`,
    shortLabel: `${free}/${memberCount}`,
    style: { backgroundColor: `rgba(16, 185, 129, ${opacity})` },
  };
}

function WeekNav({ weekOffset, first, last }: { weekOffset: number; first: Date; last: Date }) {
  const pathname = usePathname();
  const linkClass = "rounded-lg border border-zinc-200 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900";
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-medium">
        {shortDate.format(first)} – {shortDate.format(last)}
      </h2>
      <div className="flex gap-2">
        {weekOffset > 0 ? (
          <Link className={linkClass} href={`${pathname}?week=${weekOffset - 1}`}>
            ‹ Prev
          </Link>
        ) : (
          <span className={`${linkClass} cursor-not-allowed opacity-40`}>‹ Prev</span>
        )}
        {weekOffset > 0 && (
          <Link className={linkClass} href={pathname}>
            Today
          </Link>
        )}
        <Link className={linkClass} href={`${pathname}?week=${weekOffset + 1}`}>
          Next ›
        </Link>
      </div>
    </div>
  );
}

function Legend({ variant, hasPlans }: { variant: Props["variant"]; hasPlans: boolean }) {
  const swatch = "inline-block h-3 w-3 rounded-sm align-middle";
  if (variant === "personal" && !hasPlans) return null;
  return (
    <div className="flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
      {variant === "group" ? (
        <>
          <span><span className={`${swatch} bg-emerald-500`} /> Everyone free</span>
          <span><span className={swatch} style={{ backgroundColor: "rgba(16,185,129,0.35)" }} /> Some free</span>
          <span><span className={`${swatch} border border-zinc-300 dark:border-zinc-700`} /> Nobody free</span>
        </>
      ) : (
        <span><span className={`${swatch} bg-zinc-300 dark:bg-zinc-700`} /> Busy</span>
      )}
      {/* Plans use their group's color, so these swatches are neutral. */}
      <span><span className={`${swatch} bg-zinc-600 dark:bg-zinc-400`} /> Plan you&apos;re going to</span>
      <span><span className={`${swatch} border-2 border-dashed border-zinc-600 dark:border-zinc-400`} /> Plan you haven&apos;t answered</span>
      {variant === "group" && (
        <>
          <span className="text-zinc-500 sm:hidden">Tap a time to see who&apos;s free.</span>
          <span className="hidden text-zinc-500 sm:inline">Hover to see who&apos;s free · click to propose a time.</span>
        </>
      )}
    </div>
  );
}

// Floating card that follows the mouse. `position: fixed` keeps it from being
// clipped by the scrolling calendar box.
function HoverCard({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  // Flip to the other side of the cursor near the window's right/bottom edge.
  const width = 260;
  const left = x + width + 16 > window.innerWidth ? x - width - 12 : x + 14;
  const top = y + 160 > window.innerHeight ? y - 150 : y + 14;
  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg border border-zinc-200 bg-white p-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      style={{ left, top, width }}
    >
      {children}
    </div>
  );
}

// The phone version of the hover card: pinned to the bottom of the screen
// until closed or another time is tapped.
function TapCard({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        ×
      </button>
      <div className="pr-8">{children}</div>
    </div>
  );
}

function SegmentDetails({
  segment,
  variant,
  nameOf,
  memberIds,
}: {
  segment: Segment;
  variant: Props["variant"];
  nameOf: (id: string) => string;
  memberIds: string[];
}) {
  const busy = segment.busyMemberIds;
  const free = memberIds.filter((id) => !busy.includes(id));
  return (
    <>
      <div className="font-medium">{formatRange(new Date(segment.start), new Date(segment.end))}</div>
      {variant === "personal" ? (
        <div className="mt-1 text-zinc-600 dark:text-zinc-400">{busy.length ? "Busy" : "Free"}</div>
      ) : (
        <div className="mt-1 space-y-1">
          <div className="text-emerald-700 dark:text-emerald-400">
            Free ({free.length}): {free.map(nameOf).join(", ") || "nobody"}
          </div>
          {busy.length > 0 && (
            <div className="text-zinc-600 dark:text-zinc-400">
              Busy ({busy.length}): {busy.map(nameOf).join(", ")}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function PlanDetails({ plan, viewerId, showGroup }: { plan: CalendarPlan; viewerId: string; showGroup: boolean }) {
  const going = plan.going.map((p) => (p.id === viewerId ? "You" : p.name));
  const status =
    plan.myResponse === "GOING"
      ? "You're going"
      : plan.myResponse === "NOT_GOING"
        ? "You can't make it"
        : "You haven't answered yet";
  return (
    <>
      <div className="font-semibold">{plan.title}</div>
      {showGroup && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: plan.color.hex }} />
          {plan.groupName}
        </div>
      )}
      <div className="mt-1">{formatRange(new Date(plan.start), new Date(plan.end))}</div>
      {plan.repeatLabel && <div className="text-xs text-zinc-500">↻ {plan.repeatLabel}</div>}
      {plan.location && <div className="mt-1 text-zinc-600 dark:text-zinc-400">📍 {plan.location}</div>}
      <div className="mt-1 text-zinc-600 dark:text-zinc-400">
        Going ({going.length}): {going.join(", ") || "nobody yet"}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{status} · click to open</div>
    </>
  );
}
