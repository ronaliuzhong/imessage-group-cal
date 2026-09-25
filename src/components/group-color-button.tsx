"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { setMyGroupColor } from "@/app/actions";
import { GROUP_COLORS, groupColor, nearestPreset, type GroupColor } from "@/lib/colors";

// The group's color dot. Clicking it opens a picker with Google's preset
// colors plus a custom color wheel. The choice is personal: only the viewer
// sees it (in the app and on their own Google Calendar).
export function GroupColorButton({ groupId, color }: { groupId: string; color: GroupColor }) {
  const [open, setOpen] = useState(false);
  // useOptimistic shows the new color right away, before the server (which
  // also recolors your Google Calendar events) has finished saving.
  const [shownValue, setShownValue] = useOptimistic(color.id);
  const [saving, startTransition] = useTransition();
  const shown = groupColor(shownValue);
  // The color wheel's current (not yet saved) pick. <input type="color">
  // only accepts lowercase "#rrggbb".
  const [customHex, setCustomHex] = useState(shown.hex.toLowerCase());
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close when clicking anywhere outside the picker, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function save(value: string) {
    startTransition(async () => {
      setShownValue(value);
      await setMyGroupColor(groupId, value);
    });
  }

  const customDiffers = customHex !== shown.hex.toLowerCase();

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change your color for this group"
        aria-expanded={open}
        title="Change your color"
        className="h-4 w-4 rounded-full ring-zinc-400 ring-offset-2 transition hover:ring-2 dark:ring-offset-zinc-950"
        style={{ backgroundColor: shown.hex }}
      />

      {open && (
        <div
          role="dialog"
          aria-label="Your color for this group"
          className="absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-sm font-normal shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <div className="flex items-baseline justify-between">
            <p className="font-medium">Your color</p>
            {saving && <span className="text-xs text-zinc-500">Saving…</span>}
          </div>
          <p className="text-xs text-zinc-500">Only you see it.</p>

          <div className="mt-3 grid grid-cols-6 gap-2">
            {GROUP_COLORS.map((preset) => {
              const selected = preset.id === shown.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.name}
                  aria-label={preset.name}
                  aria-pressed={selected}
                  onClick={() => {
                    setCustomHex(preset.hex.toLowerCase());
                    save(preset.id);
                  }}
                  className={`h-7 w-7 rounded-full ring-zinc-900 ring-offset-2 dark:ring-white dark:ring-offset-zinc-900 ${selected ? "ring-2" : "hover:ring-1"}`}
                  style={{ backgroundColor: preset.hex }}
                />
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
            <label className="flex cursor-pointer items-center gap-2">
              {/* The browser's own color picker (a color wheel on Mac and iPhone). */}
              <input
                type="color"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-transparent p-0.5 dark:border-zinc-700"
              />
              <span>Custom color</span>
            </label>
            {customDiffers && (
              <button
                type="button"
                onClick={() => save(customHex)}
                className="self-start rounded-md bg-black px-3 py-1 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black"
              >
                Use this color
              </button>
            )}
            {/* Google events can only use the 11 presets, so a custom color
                shows there as the nearest one. Presets match exactly. */}
            {shown.name === "Custom" && (
              <p className="text-xs text-zinc-500">
                Shows as {nearestPreset(shown.hex).name} in Google Calendar.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
