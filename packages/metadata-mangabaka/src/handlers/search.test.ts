import { describe, expect, it, vi } from "vitest";
import type { MangaBakaClient } from "../api.js";
import { DEFAULT_CONFIG } from "../config.js";
import { parseExternalId } from "../externalId.js";
import type { MbCollection, MbCover, MbSeries } from "../types.js";
import { handleSearch } from "./search.js";

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
    ...partial,
  };
}

function makeCollection(partial: Partial<MbCollection> = {}): MbCollection {
  return {
    id: "col-digital",
    series_id: 1357,
    title: "Goodnight Punpun",
    language: { iso: "en", language: "English" },
    publisher: { id: 240, type: "imprint", name: "VIZ Signature" },
    edition: { id: "e", name: "Standard Edition" },
    medium: "digital",
    count_main: 7,
    ...partial,
  };
}

function fakeClient(opts: { series: MbSeries[]; collections?: Record<number, MbCollection[]> }): {
  client: MangaBakaClient;
  getCollections: ReturnType<typeof vi.fn>;
} {
  const getCollections = vi.fn(async (id: number) => opts.collections?.[id] ?? []);
  const client = {
    search: vi.fn(async () => ({
      data: opts.series,
      total: opts.series.length,
      page: 1,
      totalPages: 1,
    })),
    getCollections,
  } as unknown as MangaBakaClient;
  return { client, getCollections };
}

describe("handleSearch edition expansion", () => {
  it("returns the base series followed by its editions, base ranked first", async () => {
    const series = makeSeries();
    const { client } = fakeClient({
      series: [series],
      collections: {
        1357: [
          makeCollection({ id: "col-digital", medium: "digital" }),
          makeCollection({ id: "col-paper", medium: "paperback" }),
        ],
      },
    });

    const res = await handleSearch({ query: "Goodnight Punpun" }, client, DEFAULT_CONFIG);

    expect(res.results).toHaveLength(3);

    const base = res.results[0];
    expect(base?.externalId).toBe("1357");
    expect(base?.preview?.bookCount).toBe(13);

    const editions = res.results.slice(1);
    for (const e of editions) {
      expect(parseExternalId(e.externalId)?.collectionId).toBeDefined();
      expect(e.preview?.bookCount).toBe(7);
      // Editions never outrank their base series without a preference.
      expect(e.relevanceScore ?? 0).toBeLessThanOrEqual(base?.relevanceScore ?? 0);
    }
  });

  it("does not call the collections endpoint when expansion is disabled", async () => {
    const { client, getCollections } = fakeClient({ series: [makeSeries()] });

    const res = await handleSearch({ query: "Goodnight Punpun" }, client, {
      ...DEFAULT_CONFIG,
      expandEditions: false,
    });

    expect(getCollections).not.toHaveBeenCalled();
    expect(res.results).toHaveLength(1);
    expect(res.results[0]?.externalId).toBe("1357");
  });

  it("promotes the preferred edition above the base series", async () => {
    const series = makeSeries();
    const { client } = fakeClient({
      series: [series],
      collections: {
        1357: [
          makeCollection({ id: "col-digital", medium: "digital" }),
          makeCollection({ id: "col-paper", medium: "paperback" }),
        ],
      },
    });

    const res = await handleSearch({ query: "Goodnight Punpun" }, client, {
      ...DEFAULT_CONFIG,
      preferEdition: { medium: "paperback" },
    });

    const base = res.results.find((r) => r.externalId === "1357");
    const preferred = res.results.find(
      (r) => parseExternalId(r.externalId)?.collectionId === "col-paper",
    );
    const other = res.results.find(
      (r) => parseExternalId(r.externalId)?.collectionId === "col-digital",
    );

    expect(preferred?.relevanceScore ?? 0).toBeGreaterThan(base?.relevanceScore ?? 0);
    expect(preferred?.relevanceScore ?? 0).toBeGreaterThan(other?.relevanceScore ?? 0);
  });
});
