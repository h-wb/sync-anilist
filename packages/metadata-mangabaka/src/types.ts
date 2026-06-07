/**
 * MangaBaka API response types
 * Based on: https://api.mangabaka.org/
 */

/**
 * Standard API response wrapper
 */
export interface MbApiResponse<T> {
  status: number;
  data: T;
  pagination?: MbPagination;
}

export interface MbPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

/**
 * Series type enum
 */
export type MbSeriesType = "manga" | "novel" | "manhwa" | "manhua" | "oel" | "other";

/**
 * Publication status enum
 */
export type MbStatus = "cancelled" | "completed" | "hiatus" | "releasing" | "unknown" | "upcoming";

/**
 * Content rating enum
 */
export type MbContentRating = "safe" | "suggestive" | "erotica" | "pornographic";

/**
 * Genre enum
 */
export type MbGenre =
  | "action"
  | "adult"
  | "adventure"
  | "avant_garde"
  | "award_winning"
  | "boys_love"
  | "comedy"
  | "doujinshi"
  | "drama"
  | "ecchi"
  | "erotica"
  | "fantasy"
  | "gender_bender"
  | "girls_love"
  | "gourmet"
  | "harem"
  | "hentai"
  | "historical"
  | "horror"
  | "josei"
  | "lolicon"
  | "mahou_shoujo"
  | "martial_arts"
  | "mature"
  | "mecha"
  | "music"
  | "mystery"
  | "psychological"
  | "romance"
  | "school_life"
  | "sci-fi"
  | "seinen"
  | "shotacon"
  | "shoujo"
  | "shoujo_ai"
  | "shounen"
  | "shounen_ai"
  | "slice_of_life"
  | "smut"
  | "sports"
  | "supernatural"
  | "suspense"
  | "thriller"
  | "tragedy"
  | "yaoi"
  | "yuri";

/**
 * Series state
 */
export type MbSeriesState = "active" | "merged" | "deleted";

/**
 * Publisher information
 */
export interface MbPublisher {
  name: string;
  type: string;
  note?: string | null;
}

/**
 * Cover image structure
 */
export interface MbCover {
  raw: {
    url: string | null;
    size?: number | null;
    height?: number | null;
    width?: number | null;
    blurhash?: string | null;
    thumbhash?: string | null;
    format?: string | null;
  };
  x150: MbScaledImage;
  x250: MbScaledImage;
  x350: MbScaledImage;
}

export interface MbScaledImage {
  x1: string | null;
  x2: string | null;
  x3: string | null;
}

/**
 * Secondary title entry
 */
export interface MbSecondaryTitle {
  type: "alternative" | "native" | "official" | "unofficial";
  title: string;
  note?: string | null;
}

/**
 * Secondary titles by language code
 */
export interface MbSecondaryTitles {
  [languageCode: string]: MbSecondaryTitle[] | null;
}

/**
 * Source information (e.g., anilist, mal, etc.)
 */
export interface MbSourceInfo {
  id: number | string | null;
  rating?: number | null;
  rating_normalized?: number | null;
}

/**
 * Series relationships
 */
export interface MbRelationships {
  main_story?: number[];
  adaptation?: number[];
  prequel?: number[];
  sequel?: number[];
  side_story?: number[];
  spin_off?: number[];
  alternative?: number[];
  other?: number[];
}

/**
 * Series data from search or get endpoints
 */
export interface MbSeries {
  id: number;
  state: MbSeriesState;
  merged_with?: number | null;
  title: string;
  native_title?: string | null;
  romanized_title?: string | null;
  secondary_titles?: MbSecondaryTitles | null;
  cover: MbCover;
  authors?: string[] | null;
  artists?: string[] | null;
  publishers?: MbPublisher[] | null;
  description?: string | null;
  year?: number | null;
  final_volume?: string | null;
  total_chapters?: string | null;
  status: MbStatus;
  is_licensed?: boolean;
  has_anime?: boolean;
  type: MbSeriesType;
  country_of_origin?: string | null;
  content_rating?: MbContentRating | null;
  genres?: MbGenre[] | null;
  tags?: string[] | null;
  relationships?: MbRelationships | null;
  source?: {
    anilist?: MbSourceInfo;
    my_anime_list?: MbSourceInfo;
    mangadex?: MbSourceInfo;
    manga_updates?: MbSourceInfo;
    kitsu?: MbSourceInfo;
    anime_planet?: MbSourceInfo;
    anime_news_network?: MbSourceInfo;
    shikimori?: MbSourceInfo;
    [key: string]: MbSourceInfo | undefined;
  };
  rating?:
    | number
    | {
        average?: number | null;
        bayesian?: number | null;
        distribution?: Record<string, number> | null;
      }
    | null;
  last_updated_at?: string | null;
}

/**
 * Search response - array of series
 */
export type MbSearchResponse = MbApiResponse<MbSeries[]>;

/**
 * Get series response - single series
 */
export type MbGetSeriesResponse = MbApiResponse<MbSeries>;

// =============================================================================
// Collection types (per-edition data: /v1/series/{id}/collections)
// =============================================================================

/**
 * A language descriptor as returned on collection/edition objects.
 */
export interface MbCollectionLanguage {
  iso: string;
  language: string;
}

/**
 * Publisher reference embedded in a collection.
 */
export interface MbCollectionPublisher {
  id: number;
  type: string;
  sub_type?: string | null;
  aliases?: string[] | null;
  parent_id?: number | null;
  name: string;
}

/**
 * Edition reference embedded in a collection (e.g. "Standard Edition",
 * "Deluxe Edition", "Omnibus").
 */
export interface MbCollectionEdition {
  id: string;
  name: string;
  language?: MbCollectionLanguage | null;
  description?: string | null;
  override_text?: string | null;
}

/**
 * Free-text description block attached to a collection.
 */
export interface MbCollectionDescription {
  desc?: string | null;
  source?: string | null;
}

/**
 * External link attached to a collection.
 */
export interface MbCollectionLink {
  type: string;
  link: string;
  language?: string | null;
}

/**
 * A single published edition of a series ("Collection").
 *
 * This is the unit the website surfaces under "Collections" (e.g. the VIZ
 * 7-volume omnibus vs. the original 13-volume Japanese run). `count_main` is
 * the number of volumes in the main run for this specific edition.
 */
export interface MbCollection {
  id: string;
  series_id: number;
  title: string;
  language?: MbCollectionLanguage | null;
  publisher?: MbCollectionPublisher | null;
  edition?: MbCollectionEdition | null;
  /** e.g. "volume" */
  type?: string | null;
  /** e.g. "paged" */
  format?: string | null;
  /** e.g. "digital", "paperback", "hardcover" */
  medium?: string | null;
  status?: string | null;
  /** Reading direction, e.g. "rtl" | "ltr" */
  reading?: string | null;
  licensed?: boolean | null;
  description?: MbCollectionDescription | null;
  /** Volume count for the main run of this edition. */
  count_main?: number | null;
  /** Extra/bonus volume count (specials, side stories). */
  count_extra?: number | null;
  /** Other volume count. */
  count_other?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  related_collection_id?: string | null;
  links?: MbCollectionLink[] | null;
  note?: string | null;
  updated_at?: string | null;
}

/**
 * Collections response - array of collections for a series
 */
export type MbCollectionsResponse = MbApiResponse<MbCollection[]>;
