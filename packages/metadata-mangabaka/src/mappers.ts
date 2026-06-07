/**
 * Mappers to convert MangaBaka API responses to Codex plugin protocol types
 */

import type {
  AlternateTitle,
  BookAuthor,
  ExternalId,
  ExternalLink,
  ExternalRating,
  PluginSeriesMetadata,
  ReadingDirection,
  SearchResult,
  SeriesStatus,
} from "@ashdev/codex-plugin-sdk";
import { encodeCollectionExternalId, encodeSeriesExternalId } from "./externalId.js";
import type { MbCollection, MbContentRating, MbSeries, MbSeriesType, MbStatus } from "./types.js";

/**
 * Parse MangaBaka's volume count strings (e.g. "40") into a positive integer.
 * Returns undefined for null/empty/non-numeric/non-positive inputs.
 */
function parseVolumeCount(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Parse MangaBaka's chapter count strings (e.g. "109", "47.5") into a positive
 * float. Returns undefined for null/empty/non-numeric/non-positive inputs.
 */
function parseChapterCount(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/**
 * Coerce a numeric volume count (already a number on collections) to a positive
 * integer, or undefined.
 */
function positiveInt(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.trunc(value);
}

/**
 * Strip HTML tags from text, converting <br> to newlines
 */
function stripHtml(html: string | undefined | null): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<br\s*\/?>/gi, "\n") // Convert <br> to newlines
    .replace(/<[^>]*>/g, "") // Strip remaining HTML tags
    .trim();
}

/**
 * Map MangaBaka status to protocol SeriesStatus
 * MangaBaka uses: cancelled, completed, hiatus, releasing, unknown, upcoming
 * Codex uses: ongoing, ended, hiatus, abandoned, unknown
 */
function mapStatus(mbStatus: MbStatus): SeriesStatus {
  switch (mbStatus) {
    case "completed":
      return "ended";
    case "releasing":
    case "upcoming":
      return "ongoing";
    case "hiatus":
      return "hiatus";
    case "cancelled":
      return "abandoned";
    default:
      return "unknown";
  }
}

/**
 * Format genre from snake_case to Title Case
 */
function formatGenre(genre: string): string {
  return genre
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Detect language code from country of origin
 */
function detectLanguageFromCountry(country: string | null | undefined): string | undefined {
  if (!country) return undefined;

  const countryLower = country.toLowerCase();
  if (countryLower === "jp" || countryLower === "japan") return "ja";
  if (countryLower === "kr" || countryLower === "korea" || countryLower === "south korea")
    return "ko";
  if (countryLower === "cn" || countryLower === "china") return "zh";
  if (countryLower === "tw" || countryLower === "taiwan") return "zh-TW";

  return undefined;
}

/**
 * Map MangaBaka content rating to numeric age rating
 */
function mapContentRating(rating: MbContentRating | null | undefined): number | undefined {
  if (!rating) return undefined;

  switch (rating) {
    case "safe":
      return 0; // All ages
    case "suggestive":
      return 13; // Teen
    case "erotica":
      return 16; // Mature
    case "pornographic":
      return 18; // Adults only
    default:
      return undefined;
  }
}

/**
 * Extract rating value from either a number or an object with bayesian/average
 */
function extractRating(
  rating: number | { bayesian?: number | null; average?: number | null } | null | undefined,
): number | undefined {
  if (rating == null) return undefined;
  if (typeof rating === "number") return rating;
  return rating.bayesian ?? rating.average ?? undefined;
}

/**
 * Infer reading direction from series type and country
 */
function inferReadingDirection(
  seriesType: MbSeriesType,
  country: string | null | undefined,
): ReadingDirection | undefined {
  // Manhwa (Korean) and Manhua (Chinese) are typically left-to-right
  if (seriesType === "manhwa" || seriesType === "manhua") {
    return "ltr";
  }

  // Manga (Japanese) is typically right-to-left
  if (seriesType === "manga") {
    return "rtl";
  }

  // OEL (Original English Language) is left-to-right
  if (seriesType === "oel") {
    return "ltr";
  }

  // Fall back to country-based detection
  if (country) {
    const countryLower = country.toLowerCase();
    if (countryLower === "jp" || countryLower === "japan") return "rtl";
    if (countryLower === "kr" || countryLower === "korea" || countryLower === "south korea")
      return "ltr";
    if (countryLower === "cn" || countryLower === "china") return "ltr";
    if (countryLower === "tw" || countryLower === "taiwan") return "ltr";
  }

  return undefined;
}

/**
 * Map a MangaBaka series to a protocol SearchResult
 */
export function mapSearchResult(series: MbSeries): SearchResult {
  // Get cover URL - prefer x250 for search results
  const coverUrl = series.cover?.x250?.x1 ?? series.cover?.raw?.url ?? undefined;

  // Build alternate titles array
  const alternateTitles: string[] = [];
  if (series.native_title && series.native_title !== series.title) {
    alternateTitles.push(series.native_title);
  }
  if (series.romanized_title && series.romanized_title !== series.title) {
    alternateTitles.push(series.romanized_title);
  }

  // Note: relevanceScore is omitted - the API already returns results in relevance order
  const previewAuthors = [...new Set([...(series.authors ?? []), ...(series.artists ?? [])])].slice(
    0,
    3,
  );

  return {
    externalId: encodeSeriesExternalId(series.id),
    title: series.title,
    alternateTitles,
    year: series.year ?? undefined,
    coverUrl: coverUrl ?? undefined,
    preview: {
      status: mapStatus(series.status),
      genres: (series.genres ?? []).slice(0, 3).map(formatGenre),
      rating: extractRating(series.rating),
      description: stripHtml(series.description)?.slice(0, 200) ?? undefined,
      bookCount: parseVolumeCount(series.final_volume),
      authors: previewAuthors.length > 0 ? previewAuthors : undefined,
      format: series.type ?? undefined,
    },
  };
}

/**
 * Volume count for a collection's main run (falls back through extra/other to
 * `undefined`). This is what makes the edition's book count correct.
 */
export function collectionVolumeCount(collection: MbCollection): number | undefined {
  return positiveInt(collection.count_main) ?? positiveInt(collection.count_extra);
}

/**
 * Build a concise, human-readable label distinguishing one edition from the
 * others, e.g. "VIZ Signature · Digital · 7 vol" or "EN · Deluxe · 5 vol".
 */
export function collectionEditionLabel(collection: MbCollection): string {
  const segments: string[] = [];

  const publisher = collection.publisher?.name?.trim();
  const editionName = collection.edition?.name?.trim();
  const medium = collection.medium?.trim();
  const langIso = collection.language?.iso?.trim();

  if (publisher) {
    segments.push(publisher);
  } else if (langIso) {
    segments.push(langIso.toUpperCase());
  }

  // Only add the edition name when it carries information beyond "Standard".
  if (editionName && !/^standard(\s+edition)?$/i.test(editionName)) {
    segments.push(editionName);
  }

  if (medium) {
    segments.push(medium.charAt(0).toUpperCase() + medium.slice(1));
  }

  const count = collectionVolumeCount(collection);
  if (count != null) {
    segments.push(`${count} vol`);
  }

  // Always return something distinguishable even with sparse data.
  return segments.length > 0 ? segments.join(" · ") : (collection.id ?? "Edition");
}

/**
 * Map a series + one of its editions ("collection") to a SearchResult so the
 * edition shows up as its own selectable entry alongside the base series.
 *
 * The externalId pins the edition; refreshes will reapply the edition's volume
 * count via {@link applyCollectionToMetadata}.
 */
export function mapCollectionSearchResult(
  series: MbSeries,
  collection: MbCollection,
): SearchResult {
  const base = mapSearchResult(series);
  const label = collectionEditionLabel(collection);
  const editionCount = collectionVolumeCount(collection);

  const editionDescription = stripHtml(collection.description?.desc) ?? base.preview?.description;

  return {
    ...base,
    externalId: encodeCollectionExternalId(series.id, collection.id),
    title: `${series.title} — ${label}`,
    preview: {
      ...base.preview,
      genres: base.preview?.genres ?? [],
      authors: base.preview?.authors,
      bookCount: editionCount ?? base.preview?.bookCount,
      description: editionDescription?.slice(0, 200),
    },
  };
}

/**
 * Map full series response to protocol PluginSeriesMetadata
 */
export function mapSeriesMetadata(series: MbSeries): PluginSeriesMetadata {
  // Build alternate titles array with language info
  const alternateTitles: AlternateTitle[] = [];

  // Add native title
  if (series.native_title && series.native_title !== series.title) {
    alternateTitles.push({
      title: series.native_title,
      language: detectLanguageFromCountry(series.country_of_origin),
      titleType: "native",
    });
  }

  // Add romanized title
  if (series.romanized_title && series.romanized_title !== series.title) {
    alternateTitles.push({
      title: series.romanized_title,
      language: "en",
      titleType: "romaji",
    });
  }

  // Add secondary titles from all languages
  if (series.secondary_titles) {
    for (const [langCode, titleList] of Object.entries(series.secondary_titles)) {
      if (titleList) {
        for (const titleEntry of titleList) {
          if (titleEntry.title !== series.title) {
            alternateTitles.push({
              title: titleEntry.title,
              language: langCode,
            });
          }
        }
      }
    }
  }

  // Extract authors and artists — merge into unified BookAuthor array
  // Authors get "author" role (generic default), artists get "illustrator" role
  // Deduplicate: if someone is both author and artist, keep them as "author"
  const authorNames = new Set((series.authors ?? []).map((n) => n));
  const authors: BookAuthor[] = (series.authors ?? []).map((name) => ({
    name,
    role: "author" as const,
  }));
  for (const name of series.artists ?? []) {
    if (!authorNames.has(name)) {
      authors.push({ name, role: "illustrator" as const });
    }
  }

  // Format genres
  const genres = (series.genres ?? []).map(formatGenre);

  // Get cover URL - prefer raw for full metadata
  const coverUrl = series.cover?.raw?.url ?? series.cover?.x350?.x1 ?? undefined;

  // Build external links from sources
  // Always include MangaBaka link first
  const externalLinks: ExternalLink[] = [
    {
      url: `https://mangabaka.org/${series.id}`,
      label: "MangaBaka",
      linkType: "provider",
    },
  ];

  // Source configuration: display name, rating key, and URL pattern
  // URL pattern uses {id} as placeholder for the source ID
  const sourceConfig: Record<string, { label: string; ratingKey: string; urlPattern?: string }> = {
    anilist: {
      label: "AniList",
      ratingKey: "anilist",
      urlPattern: "https://anilist.co/manga/{id}",
    },
    my_anime_list: {
      label: "MyAnimeList",
      ratingKey: "myanimelist",
      urlPattern: "https://myanimelist.net/manga/{id}",
    },
    mangadex: {
      label: "MangaDex",
      ratingKey: "mangadex",
      urlPattern: "https://mangadex.org/title/{id}",
    },
    manga_updates: {
      label: "MangaUpdates",
      ratingKey: "mangaupdates",
      urlPattern: "https://www.mangaupdates.com/series/{id}",
    },
    kitsu: { label: "Kitsu", ratingKey: "kitsu", urlPattern: "https://kitsu.app/manga/{id}" },
    anime_planet: {
      label: "Anime-Planet",
      ratingKey: "animeplanet",
      urlPattern: "https://www.anime-planet.com/manga/{id}",
    },
    anime_news_network: { label: "Anime News Network", ratingKey: "animenewsnetwork" },
    shikimori: {
      label: "Shikimori",
      ratingKey: "shikimori",
      urlPattern: "https://shikimori.one/mangas/{id}",
    },
  };

  // Build external links, ratings, and cross-reference IDs from sources in a single pass
  const externalRatings: ExternalRating[] = [];
  const externalIds: ExternalId[] = [
    // Always include the plugin's own API ID so other plugins can cross-reference
    { source: "api:mangabaka", externalId: String(series.id) },
  ];

  if (series.source) {
    for (const [key, info] of Object.entries(series.source)) {
      if (!info) continue;

      const config = sourceConfig[key];
      // Use config if available, otherwise generate defaults from key
      const ratingKey = config?.ratingKey ?? key.replace(/_/g, "");

      // Add cross-reference external ID with api: prefix
      if (info.id != null) {
        externalIds.push({
          source: `api:${ratingKey}`,
          externalId: String(info.id),
        });
      }

      // Add external link if source has an ID and URL pattern
      if (info.id != null && config?.urlPattern) {
        externalLinks.push({
          url: config.urlPattern.replace("{id}", String(info.id)),
          label: config.label,
          linkType: "provider",
        });
      }

      // Add external rating if source has a normalized rating
      if (info.rating_normalized != null) {
        externalRatings.push({ score: info.rating_normalized, source: ratingKey });
      }
    }
  }

  // Get publisher name (pick first one if available)
  const publisher = series.publishers?.[0]?.name ?? undefined;

  const totalVolumeCount = parseVolumeCount(series.final_volume);
  const totalChapterCount = parseChapterCount(series.total_chapters);

  return {
    externalId: encodeSeriesExternalId(series.id),
    externalUrl: `https://mangabaka.org/${series.id}`,
    title: series.title,
    alternateTitles,
    summary: stripHtml(series.description),
    status: mapStatus(series.status),
    year: series.year ?? undefined,
    // Extended metadata
    publisher,
    totalVolumeCount,
    totalChapterCount,
    ageRating: mapContentRating(series.content_rating),
    readingDirection: inferReadingDirection(series.type, series.country_of_origin),
    // Taxonomy
    genres,
    tags: series.tags ?? [],
    authors,
    artists: [],
    coverUrl: coverUrl ?? undefined,
    rating: (() => {
      const r = extractRating(series.rating);
      return r != null ? { score: r, source: "mangabaka" } : undefined;
    })(),
    externalRatings: externalRatings.length > 0 ? externalRatings : undefined,
    externalLinks,
    externalIds,
  };
}

/** Map a collection's `reading` field to a protocol ReadingDirection. */
function mapCollectionReading(reading: string | null | undefined): ReadingDirection | undefined {
  if (!reading) return undefined;
  const r = reading.toLowerCase();
  if (r === "rtl") return "rtl";
  if (r === "ltr") return "ltr";
  return undefined;
}

/**
 * Overlay a specific edition ("collection") onto the base series metadata.
 *
 * The series object carries the canonical identity (title, taxonomy, cross-ref
 * IDs); the collection refines the edition-specific bits — most importantly the
 * volume count — so Codex tracks the edition the user actually owns.
 */
export function applyCollectionToMetadata(
  base: PluginSeriesMetadata,
  series: MbSeries,
  collection: MbCollection,
): PluginSeriesMetadata {
  const editionCount = collectionVolumeCount(collection);
  const editionPublisher = collection.publisher?.name?.trim();
  const editionSummary = stripHtml(collection.description?.desc);
  const editionReading = mapCollectionReading(collection.reading);

  // Append edition-specific links (e.g. the publisher's product page) without
  // dropping the series-level cross-reference links.
  const extraLinks: ExternalLink[] = (collection.links ?? [])
    .filter((l) => typeof l.link === "string" && l.link.length > 0)
    .map((l) => ({
      url: l.link,
      label: collection.publisher?.name ?? "Publisher",
      linkType: "provider" as const,
    }));

  const existingUrls = new Set((base.externalLinks ?? []).map((l) => l.url));
  const mergedLinks = [
    ...(base.externalLinks ?? []),
    ...extraLinks.filter((l) => !existingUrls.has(l.url)),
  ];

  return {
    ...base,
    // Pin the edition so refreshes stay on this edition.
    externalId: encodeCollectionExternalId(series.id, collection.id),
    totalVolumeCount: editionCount ?? base.totalVolumeCount,
    publisher: editionPublisher ?? base.publisher,
    summary: editionSummary ?? base.summary,
    readingDirection: editionReading ?? base.readingDirection,
    externalLinks: mergedLinks,
  };
}
