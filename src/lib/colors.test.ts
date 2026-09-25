import { describe, expect, it } from "vitest";
import { groupColor, nearestPreset, normalizeColor, readableTextColor, viewerGroupColor } from "./colors";

describe("normalizeColor", () => {
  it("keeps preset IDs and lowercases custom hex colors", () => {
    expect(normalizeColor("7")).toBe("7");
    expect(normalizeColor("#12AB34")).toBe("#12ab34");
  });

  it("falls back to the default for anything else", () => {
    for (const bad of ["99", "red", "#12ab3", "#12ab345", "javascript:alert(1)", "", null, undefined]) {
      expect(normalizeColor(bad)).toBe("3");
    }
  });
});

describe("groupColor", () => {
  it("returns presets with their own Google color ID", () => {
    const peacock = groupColor("7");
    expect(peacock.name).toBe("Peacock");
    expect(peacock.googleColorId).toBe("7");
  });

  it("maps a custom color to the closest preset for Google", () => {
    const custom = groupColor("#0aa0e0"); // a light blue, close to Peacock (#039BE5)
    expect(custom.hex).toBe("#0aa0e0");
    expect(custom.name).toBe("Custom");
    expect(custom.googleColorId).toBe("7");
  });
});

describe("nearestPreset", () => {
  it("picks an exact match when there is one", () => {
    expect(nearestPreset("#D50000").name).toBe("Tomato");
  });

  it("picks the closest one otherwise", () => {
    expect(nearestPreset("#ffd000").name).toBe("Banana"); // yellow
    expect(nearestPreset("#006400").name).toBe("Basil"); // dark green
  });
});

describe("readableTextColor", () => {
  it("uses dark text on light colors and white text on dark ones", () => {
    expect(readableTextColor("#ffffff")).toBe("#1f2937");
    expect(readableTextColor("#F6BF26")).toBe("#1f2937"); // Banana
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#3F51B5")).toBe("#ffffff"); // Blueberry
  });
});

describe("viewerGroupColor", () => {
  it("prefers the member's own choice, else the group's starting color", () => {
    expect(viewerGroupColor({ color: "3" }, { color: "#123456" }).hex).toBe("#123456");
    expect(viewerGroupColor({ color: "3" }, { color: null }).name).toBe("Grape");
    expect(viewerGroupColor({ color: "3" }, null).name).toBe("Grape");
  });
});
