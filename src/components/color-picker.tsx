import { DEFAULT_GROUP_COLOR, GROUP_COLORS } from "@/lib/colors";

// A row of color swatches for a form. They're ordinary radio buttons (so the
// keyboard and screen readers work), visually hidden and drawn as circles; the
// chosen one gets a ring. Submits as the form field `name`.
export function ColorPicker({ name, defaultValue = DEFAULT_GROUP_COLOR }: { name: string; defaultValue?: string }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-1.5 text-sm">
        <span className="font-medium">Color</span>
        <span className="text-zinc-500"> · everyone starts with this and can pick their own</span>
      </legend>
      {GROUP_COLORS.map((color) => (
        <label key={color.id} title={color.name} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={color.id}
            defaultChecked={color.id === defaultValue}
            aria-label={color.name}
            className="peer sr-only"
          />
          <span
            className="block h-6 w-6 rounded-full ring-zinc-900 ring-offset-2 peer-checked:ring-2 peer-focus-visible:ring-2 dark:ring-white dark:ring-offset-zinc-950"
            style={{ backgroundColor: color.hex }}
          />
        </label>
      ))}
    </fieldset>
  );
}
