import {
  createLogger,
  type MetadataSearchParams,
  type MetadataSearchResponse,
  type SearchResult,
} from "@ashdev/codex-plugin-sdk";
import type { MangaBakaClient } from "../api.js";
import { collectionMatchesPreference, DEFAULT_CONFIG, type PluginConfig } from "../config.js";
import { mapCollectionSearchResult, mapSearchResult } from "../mappers.js";
import { similarity } from "../similarity.js";
import type { MbSeries } from "../types.js";

const logger = createLogger({ name: "mangabaka-search", level: "debug" });

/** MangaBaka API enforces a maximum of 50 results per request */
const MAX_LIMIT = 50;

/**
 * Editions rank just below their base series unless a configured preference
 * promotes one of them. This keeps the base series the auto-match winner while
 * still listing editions right under it for manual selection.
 */
const EDITION_RANK_FACTOR = 0.99;

/**
 * Score a search result against the query using title similarity.
 * Checks both primary title and alternate titles, returning the best score.
 */
export function scoreSearchResult(result: SearchResult, query: string): number {
  let best = similarity(result.title, query);
  for (const alt of result.alternateTitles) {
    best = Math.max(best, similarity(alt, query));
  }
  return best;
}

/**
 * Expand a single base series into its base result plus one result per edition.
 *
 * Scoring rule: the base series keeps the full title-similarity score so it
 * wins auto-match — UNLESS a configured edition preference matches one of the
 * editions, in which case that edition is promoted above the base.
 */
async function expandSeries(
  series: MbSeries,
  baseResult: SearchResult,
  baseScore: number,
  client: MangaBakaClient,
  config: PluginConfig,
): Promise<SearchResult[]> {
  let collections: Awaited<ReturnType<MangaBakaClient["getCollections"]>> = [];
  try {
    collections = await client.getCollections(series.id);
  } catch (error) {
    // Editions are best-effort; never fail the whole search over them.
    logger.debug(`Failed to fetch collections for ${series.id}: ${String(error)}`);
  }

  if (collections.length === 0) {
    return [{ ...baseResult, relevanceScore: baseScore }];
  }

  const preferredId = config.preferEdition
    ? collections.find((c) => collectionMatchesPreference(c, config.preferEdition))?.id
    : undefined;

  const out: SearchResult[] = [
    {
      ...baseResult,
      // Demote the base only when a preferred edition will outrank it.
      relevanceScore: preferredId ? baseScore * EDITION_RANK_FACTOR : baseScore,
    },
  ];

  for (const collection of collections) {
    const editionResult = mapCollectionSearchResult(series, collection);
    editionResult.relevanceScore =
      preferredId && collection.id === preferredId ? baseScore : baseScore * EDITION_RANK_FACTOR;
    out.push(editionResult);
  }

  return out;
}

export async function handleSearch(
  params: MetadataSearchParams,
  client: MangaBakaClient,
  config: PluginConfig = DEFAULT_CONFIG,
): Promise<MetadataSearchResponse> {
  logger.debug("Search params received:", params);

  const limit = Math.min(params.limit ?? 20, MAX_LIMIT);

  // Parse cursor as page number (default to 1)
  const page = params.cursor ? Number.parseInt(params.cursor, 10) : 1;

  logger.debug(`Searching for: "${params.query}" (page ${page}, limit ${limit})`);

  const response = await client.search(params.query, page, limit);

  // Map base results and score by similarity to the search query
  const scored = response.data
    .map((series) => {
      const result = mapSearchResult(series);
      const score = scoreSearchResult(result, params.query);
      result.relevanceScore = score;
      return { series, result, score };
    })
    .sort((a, b) => b.score - a.score);

  // Expand the top-N base results into their editions (bounded API calls).
  const results: SearchResult[] = [];
  const expandLimit = config.expandEditions ? config.expandEditionsLimit : 0;
  for (let i = 0; i < scored.length; i++) {
    const entry = scored[i];
    if (!entry) continue;
    if (i < expandLimit) {
      const expanded = await expandSeries(entry.series, entry.result, entry.score, client, config);
      results.push(...expanded);
    } else {
      results.push(entry.result);
    }
  }

  // Calculate next cursor (next page number) if there are more results
  const hasNextPage = response.page < response.totalPages;
  const nextCursor = hasNextPage ? String(response.page + 1) : undefined;

  return {
    results,
    nextCursor,
  };
}
