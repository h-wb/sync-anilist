import { describe, expect, it } from "vitest";
import { collectionMatchesPreference, DEFAULT_CONFIG, parseConfig } from "./config.js";
import type { MbCollection } from "./types.js";

function makeCollection(partial: Partial<MbCollection> = {}): MbCollection {
  return {
    id: "c1",
    series_id: 1,
    title: "T",
    language: { iso: "en", language: "English" },
    medium: "digital",
    count_main: 7,
    ...partial,
  };
}

describe("parseConfig", () => {
  it("returns defaults for empty config", () => {
    expect(parseConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("parses booleans and numbers from strings", () => {
    const config = parseConfig({ expand_editions: "false", expand_editions_limit: "5" });
    expect(config.expandEditions).toBe(false);
    expect(config.expandEditionsLimit).toBe(5);
  });

  it("builds an edition preference and lowercases it", () => {
    const config = parseConfig({
      prefer_edition_language: "EN",
      prefer_edition_medium: "Digital",
    });
    expect(config.preferEdition).toEqual({ language: "en", medium: "digital" });
  });

  it("leaves preference unset when both fields are blank", () => {
    expect(parseConfig({ prefer_edition_language: "  " }).preferEdition).toBeUndefined();
  });
});

describe("collectionMatchesPreference", () => {
  it("matches on language and medium together", () => {
    expect(
      collectionMatchesPreference(makeCollection(), { language: "en", medium: "digital" }),
    ).toBe(true);
    expect(
      collectionMatchesPreference(makeCollection(), { language: "en", medium: "paperback" }),
    ).toBe(false);
  });

  it("matches on a single dimension when only one is set", () => {
    expect(collectionMatchesPreference(makeCollection(), { medium: "digital" })).toBe(true);
    expect(collectionMatchesPreference(makeCollection(), { language: "fr" })).toBe(false);
  });

  it("never matches an empty preference", () => {
    expect(collectionMatchesPreference(makeCollection(), undefined)).toBe(false);
    expect(collectionMatchesPreference(makeCollection(), {})).toBe(false);
  });
});
