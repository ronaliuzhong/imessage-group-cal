"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
const shortDateFormat = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

// Shows a time range in the viewer's own timezone, e.g.
// "Thursday, October 1 · 7:00 – 9:30 PM". Renders nothing on the server,
// which doesn't know the viewer's timezone.
export function LocalTimeRange({ start, end, short = false }: { start: string; end: string; short?: boolean }) {
  const isBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);
  if (!isBrowser) return <span className="invisible">…</span>;

  const s = new Date(start);
  const e = new Date(end);
  const day = (short ? shortDateFormat : dateFormat).format(s);
  const endPart =
    s.toDateString() === e.toDateString()
      ? timeFormat.format(e)
      : `${(short ? shortDateFormat : dateFormat).format(e)} ${timeFormat.format(e)}`;
  return (
    <span>
      {day} · {timeFormat.format(s)} – {endPart}
    </span>
  );
}
