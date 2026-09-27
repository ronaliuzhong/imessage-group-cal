import { describe, expect, it } from "vitest";
import { autoGroupName, firstName } from "./groups";

describe("firstName", () => {
  it("uses the first word of the name", () => {
    expect(firstName({ name: "Rona Liu-Zhong", email: "r@example.com" })).toBe("Rona");
    expect(firstName({ name: "  Sam  ", email: "s@example.com" })).toBe("Sam");
  });

  it("falls back to the email", () => {
    expect(firstName({ name: null, email: "jordan.lee@example.com" })).toBe("jordan.lee");
    expect(firstName({ name: "   ", email: "alex@example.com" })).toBe("alex");
  });
});

describe("autoGroupName", () => {
  it("names a group by who's in it", () => {
    expect(autoGroupName(["Rona"])).toBe("Rona's chat");
    expect(autoGroupName(["Rona", "Sam"])).toBe("Rona & Sam");
    expect(autoGroupName(["Rona", "Sam", "Alex"])).toBe("Rona, Sam & Alex");
    expect(autoGroupName(["Rona", "Sam", "Alex", "Jo", "Kim"])).toBe("Rona, Sam & 3 others");
  });

  it("stays within the name limit", () => {
    expect(autoGroupName(["A".repeat(50), "B".repeat(50)]).length).toBeLessThanOrEqual(60);
  });
});
