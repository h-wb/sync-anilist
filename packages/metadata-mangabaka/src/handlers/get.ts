import {
  createLogger,
  type MetadataGetParams,
  NotFoundError,
  type PluginSeriesMetadata,
} from "@ashdev/codex-plugin-sdk";
import type { MangaBakaClient } from "../api.js";
import { parseExternalId } from "../externalId.js";
import { applyCollectionToMetadata, mapSeriesMetadata } from "../mappers.js";

const logger = createLogger({ name: "mangabaka-get", level: "info" });

export async function handleGet(
  params: MetadataGetParams,
  client: MangaBakaClient,
): Promise<PluginSeriesMetadata> {
  const parsed = parseExternalId(params.externalId);

  if (!parsed) {
    throw new NotFoundError(`Invalid external ID: ${params.externalId}`);
  }

  const series = await client.getSeries(parsed.seriesId);
  const base = mapSeriesMetadata(series);

  // Base series (no pinned edition): return as-is.
  if (!parsed.collectionId) {
    return base;
  }

  // A specific edition was pinned — overlay its data (notably volume count).
  const collections = await client.getCollections(parsed.seriesId);
  const collection = collections.find((c) => c.id === parsed.collectionId);

  if (!collection) {
    // The edition disappeared (re-merged/removed upstream). Fall back to the
    // base series rather than failing the refresh outright.
    logger.info(
      `Pinned edition ${parsed.collectionId} not found for series ${parsed.seriesId}; returning base series`,
    );
    return base;
  }

  return applyCollectionToMetadata(base, series, collection);
}
