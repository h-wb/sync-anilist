/**
 * External ID codec for MangaBaka.
 *
 * Codex persists the `externalId` a metadata result reports and replays it on
 * every refresh (`metadata/get`). We use that string as the join key not just
 * for the series, but optionally for a specific *edition* ("Collection").
 *
 * Scheme:
 *   - Base series:        "1357"
 *   - A specific edition: "1357:c:<collectionId>"
 *
 * The base form is unchanged from upstream, so existing matches keep working.
 * Collection IDs are UUIDs (no `:`), but we parse defensively by treating
 * everything after the `c:` marker as the collection id.
 */

const COLLECTION_MARKER = "c";

export interface ParsedExternalId {
  /** The MangaBaka series id. */
  seriesId: number;
  /** Present when the external id pins a specific edition/collection. */
  collectionId?: string;
}

/**
 * Build the external id for a base series.
 */
export function encodeSeriesExternalId(seriesId: number): string {
  return String(seriesId);
}

/**
 * Build the external id that pins a specific edition (collection) of a series.
 */
export function encodeCollectionExternalId(seriesId: number, collectionId: string): string {
  return `${seriesId}:${COLLECTION_MARKER}:${collectionId}`;
}

/**
 * Parse an external id into its series id and optional collection id.
 *
 * Returns `null` when the series id is not a positive integer, so callers can
 * surface a clean NotFoundError instead of fetching garbage.
 */
export function parseExternalId(externalId: string): ParsedExternalId | null {
  const trimmed = externalId.trim();
  if (trimmed.length === 0) return null;

  const firstColon = trimmed.indexOf(":");
  const seriesPart = firstColon === -1 ? trimmed : trimmed.slice(0, firstColon);
  const seriesId = Number.parseInt(seriesPart, 10);
  if (!Number.isInteger(seriesId) || seriesId <= 0) return null;

  if (firstColon === -1) {
    return { seriesId };
  }

  const remainder = trimmed.slice(firstColon + 1);
  const markerColon = remainder.indexOf(":");
  if (markerColon === -1) {
    // Unknown suffix shape — treat as base series rather than failing hard.
    return { seriesId };
  }

  const marker = remainder.slice(0, markerColon);
  const collectionId = remainder.slice(markerColon + 1).trim();
  if (marker !== COLLECTION_MARKER || collectionId.length === 0) {
    return { seriesId };
  }

  return { seriesId, collectionId };
}
