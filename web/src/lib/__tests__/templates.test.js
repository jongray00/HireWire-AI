import { describe, it, expect } from "vitest";
import { TEMPLATES, getTemplateById } from "../templates.js";

describe("templates module", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(TEMPLATES)).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThan(0);
  });

  it("each template has required fields", () => {
    for (const t of TEMPLATES) {
      expect(typeof t.id).toBe("string");
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(typeof t.color).toBe("string");
      expect(t.icon).toBeTruthy();
      expect(t.defaultData).toBeTruthy();
    }
  });

  it("ids are unique", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateById returns the matching template or undefined", () => {
    const first = TEMPLATES[0];
    expect(getTemplateById(first.id)).toBe(first);
    expect(getTemplateById("nope-not-here")).toBeUndefined();
  });
});
