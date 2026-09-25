import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/..." → "src/..." shortcut as tsconfig.json, so tested files can
    // import each other the way the app does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
