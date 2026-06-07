import { describe, expect, it } from "vitest";
import {
  encodeCollectionExternalId,
  encodeSeriesExternalId,
  parseExternalId,
} from "./externalId.js";

describe("externalId", () => {
  it("encodes and parses a base series id", () => {
    expect(encodeSeriesExternalId(1357)).toBe("1357");
    expect(parseExternalId("1357")).toEqual({ seriesId: 1357 });
  });

  it("encodes and parses a collection-pinned id", () => {
    const uuid = "019e1d1b-b52d-7a5e-b609-18f87987c7a4";
    const id = encodeCollectionExternalId(1357, uuid);
    expect(id).toBe(`1357:c:${uuid}`);
    expect(parseExternalId(id)).toEqual({ seriesId: 1357, collectionId: uuid });
  });

  it("round-trips through encode/parse", () => {
    const uuid = "abc-123";
    const parsed = parseExternalId(encodeCollectionExternalId(42, uuid));
    expect(parsed).toEqual({ seriesId: 42, collectionId: uuid });
  });

  it("trims surrounding whitespace", () => {
    expect(parseExternalId("  1357  ")).toEqual({ seriesId: 1357 });
  });

  it("returns null for non-numeric or non-positive series ids", () => {
    expect(parseExternalId("")).toBeNull();
    expect(parseExternalId("abc")).toBeNull();
    expect(parseExternalId("0")).toBeNull();
    expect(parseExternalId("-5")).toBeNull();
    expect(parseExternalId("x:c:uuid")).toBeNull();
  });

  it("treats unknown suffix shapes as a base series", () => {
    expect(parseExternalId("1357:")).toEqual({ seriesId: 1357 });
    expect(parseExternalId("1357:x:foo")).toEqual({ seriesId: 1357 });
    expect(parseExternalId("1357:c:")).toEqual({ seriesId: 1357 });
  });
});
