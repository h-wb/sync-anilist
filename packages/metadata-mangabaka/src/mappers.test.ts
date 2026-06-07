import { describe, expect, it } from "vitest";
import { parseExternalId } from "./externalId.js";
import {
  applyCollectionToMetadata,
  collectionEditionLabel,
  collectionVolumeCount,
  mapCollectionSearchResult,
  mapSearchResult,
  mapSeriesMetadata,
} from "./mappers.js";
import type { MbCollection, MbCover, MbSeries } from "./types.js";

const COVER: MbCover = {
  raw: { url: null },
  x150: { x1: null, x2: null, x3: null },
  x250: { x1: null, x2: null, x3: null },
  x350: { x1: null, x2: null, x3: null },
};

function makeSeries(partial: Partial<MbSeries> = {}): MbSeries {
  return {
    id: 1357,
    state: "active",
    title: "Goodnight Punpun",
    cover: COVER,
    status: "completed",
    type: "manga",
    final_volume: "13",
    total_chapters: "147",
    year: 2007,
    ...partial,
  };
}

function makeCollection(partial: Partial<MbCollection> = {}): MbCollection {
  return {
    id: "019e1d1b-b52d-7a5e-b609-18f87987c7a4",
    series_id: 1357,
    title: "Goodnight Punpun",
    language: { iso: "en", language: "English (English)" },
    publisher: { id: 240, type: "imprint", name: "VIZ Signature" },
    edition: { id: "ed-1", name: "Standard Edition" },
    medium: "digital",
    reading: "rtl",
    count_main: 7,
    count_extra: 0,
    count_other: 0,
    description: { desc: "Meet Punpun.", source: "VIZ Signature" },
    ...partial,
  };
}

describe("collectionVolumeCount", () => {
  it("uses count_main", () => {
    expect(collectionVolumeCount(makeCollection({ count_main: 7 }))).toBe(7);
  });

  it("falls back to count_extra when no main run", () => {
    expect(collectionVolumeCount(makeCollection({ count_main: 0, count_extra: 3 }))).toBe(3);
  });

  it("returns undefined when nothing is positive", () => {
    expect(
      collectionVolumeCount(makeCollection({ count_main: 0, count_extra: 0, count_other: 0 })),
    ).toBeUndefined();
  });
});

describe("collectionEditionLabel", () => {
  it("includes publisher, medium and count, skipping a generic edition name", () => {
    expect(collectionEditionLabel(makeCollection())).toBe("VIZ Signature · Digital · 7 vol");
  });

  it("includes a meaningful edition name", () => {
    const label = collectionEditionLabel(
      makeCollection({ edition: { id: "e", name: "Deluxe Edition" }, medium: "hardcover" }),
    );
    expect(label).toBe("VIZ Signature · Deluxe Edition · Hardcover · 7 vol");
  });

  it("falls back to language code when no publisher", () => {
    const label = collectionEditionLabel(
      makeCollection({ publisher: null, language: { iso: "fr", language: "French" } }),
    );
    expect(label).toBe("FR · Digital · 7 vol");
  });
});

describe("mapCollectionSearchResult", () => {
  it("pins the collection in the externalId and uses the edition volume count", () => {
    const series = makeSeries();
    const collection = makeCollection();
    const result = mapCollectionSearchResult(series, collection);

    expect(parseExternalId(result.externalId)).toEqual({
      seriesId: 1357,
      collectionId: collection.id,
    });
    expect(result.title).toBe("Goodnight Punpun — VIZ Signature · Digital · 7 vol");
    expect(result.preview?.bookCount).toBe(7);
  });
});

describe("mapSearchResult", () => {
  it("uses the series final_volume for the base result", () => {
    const result = mapSearchResult(makeSeries());
    expect(result.externalId).toBe("1357");
    expect(result.preview?.bookCount).toBe(13);
  });
});

describe("applyCollectionToMetadata", () => {
  it("overlays the edition volume count and pins the externalId", () => {
    const series = makeSeries();
    const base = mapSeriesMetadata(series);
    expect(base.totalVolumeCount).toBe(13);

    const overlaid = applyCollectionToMetadata(base, series, makeCollection());

    expect(overlaid.totalVolumeCount).toBe(7);
    expect(overlaid.publisher).toBe("VIZ Signature");
    expect(overlaid.summary).toBe("Meet Punpun.");
    expect(parseExternalId(overlaid.externalId)).toEqual({
      seriesId: 1357,
      collectionId: makeCollection().id,
    });
    // Canonical identity is preserved.
    expect(overlaid.title).toBe(base.title);
    expect(overlaid.totalChapterCount).toBe(base.totalChapterCount);
  });

  it("keeps the base volume count when the edition has no usable count", () => {
    const series = makeSeries();
    const base = mapSeriesMetadata(series);
    const overlaid = applyCollectionToMetadata(
      base,
      series,
      makeCollection({ count_main: 0, count_extra: 0, count_other: 0 }),
    );
    expect(overlaid.totalVolumeCount).toBe(13);
  });
});
