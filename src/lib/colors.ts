// Group colors. The presets are Google Calendar's own event colors, so a group
// looks the same in our app and in Google Calendar. People can also pick any
// custom color ("#rrggbb"); since Google events can only use its 11 presets
// (identified by colorId "1"–"11"), a custom color shows in Google Calendar as
// the closest preset.

export type GroupColor = {
  id: string; // preset colorId, or the "#rrggbb" of a custom color
  name: string;
  hex: string;
  // Text color that stays readable on top of `hex`.
  text: "#ffffff" | "#1f2937";
  // What to send Google for events in this color.
  googleColorId: string;
};

type Preset = Omit<GroupColor, "googleColorId">;

// Hex values match how Google Calendar displays these colors today.
const PRESETS: Preset[] = [
  { id: "11", name: "Tomato", hex: "#D50000", text: "#ffffff" },
  { id: "4", name: "Flamingo", hex: "#E67C73", text: "#ffffff" },
  { id: "6", name: "Tangerine", hex: "#F4511E", text: "#ffffff" },
  { id: "5", name: "Banana", hex: "#F6BF26", text: "#1f2937" },
  { id: "2", name: "Sage", hex: "#33B679", text: "#ffffff" },
  { id: "10", name: "Basil", hex: "#0B8043", text: "#ffffff" },
  { id: "7", name: "Peacock", hex: "#039BE5", text: "#ffffff" },
  { id: "9", name: "Blueberry", hex: "#3F51B5", text: "#ffffff" },
  { id: "1", name: "Lavender", hex: "#7986CB", text: "#ffffff" },
  { id: "3", name: "Grape", hex: "#8E24AA", text: "#ffffff" },
  { id: "8", name: "Graphite", hex: "#616161", text: "#ffffff" },
];

export const GROUP_COLORS: GroupColor[] = PRESETS.map((p) => ({ ...p, googleColorId: p.id }));

export const DEFAULT_GROUP_COLOR = "3"; // Grape

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function toRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The preset that looks most like `hex` (smallest distance in RGB space).
export function nearestPreset(hex: string): GroupColor {
  const [r, g, b] = toRgb(hex);
  let best = GROUP_COLORS[0];
  let bestDistance = Infinity;
  for (const preset of GROUP_COLORS) {
    const [pr, pg, pb] = toRgb(preset.hex);
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (distance < bestDistance) {
      best = preset;
      bestDistance = distance;
    }
  }
  return best;
}

// Dark text on light colors, white text on dark ones. Uses the standard
// "relative luminance" formula, which weights green most because eyes are
// most sensitive to it.
export function readableTextColor(hex: string): GroupColor["text"] {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#1f2937" : "#ffffff";
}

// Cleans up a color from a form or the database: a preset ID stays as is, a
// custom "#rrggbb" is lowercased, and anything else becomes the default.
export function normalizeColor(value: string | null | undefined): string {
  if (value && GROUP_COLORS.some((c) => c.id === value)) return value;
  if (value && HEX_PATTERN.test(value)) return value.toLowerCase();
  return DEFAULT_GROUP_COLOR;
}

// Looks up a color (preset ID or custom hex), falling back to the default.
export function groupColor(value: string | null | undefined): GroupColor {
  const normalized = normalizeColor(value);
  const preset = GROUP_COLORS.find((c) => c.id === normalized);
  if (preset) return preset;
  return {
    id: normalized,
    name: "Custom",
    hex: normalized,
    text: readableTextColor(normalized),
    googleColorId: nearestPreset(normalized).id,
  };
}

// The color a particular person sees a group in: their own pick if they've
// made one, otherwise the group's starting color.
export function viewerGroupColor(
  group: { color: string },
  membership: { color: string | null } | null | undefined,
): GroupColor {
  return groupColor(membership?.color ?? group.color);
}
