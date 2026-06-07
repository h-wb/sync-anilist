/**
 * Plugin configuration parsed from Codex admin config.
 */

import type { MbCollection } from "./types.js";

export interface EditionPreference {
  /** Preferred edition language ISO code, e.g. "en". */
  language?: string;
  /** Preferred edition medium, e.g. "digital", "paperback". */
  medium?: string;
}

export interface PluginConfig {
  /** Expand search results into their per-edition ("collection") entries. */
  expandEditions: boolean;
  /**
   * How many of the top search results to expand into editions. Bounds the
   * number of extra `/collections` calls per search.
   */
  expandEditionsLimit: number;
  /**
   * When set, auto-match prefers the edition matching this language/medium
   * (ranked above the base series). When unset, auto-match resolves to the
   * base series and editions are a manual choice.
   */
  preferEdition?: EditionPreference;
}

export const DEFAULT_CONFIG: PluginConfig = {
  expandEditions: true,
  expandEditionsLimit: 3,
};

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|1|yes|on)$/i.test(value)) return true;
    if (/^(false|0|no|off)$/i.test(value)) return false;
  }
  return fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.trunc(n);
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse the edition-related fields out of Codex admin config.
 */
export function parseConfig(adminConfig: Record<string, unknown> | undefined): PluginConfig {
  if (!adminConfig) return { ...DEFAULT_CONFIG };

  const language = asTrimmedString(adminConfig.prefer_edition_language)?.toLowerCase();
  const medium = asTrimmedString(adminConfig.prefer_edition_medium)?.toLowerCase();
  const preferEdition: EditionPreference | undefined =
    language || medium ? { language, medium } : undefined;

  return {
    expandEditions: asBoolean(adminConfig.expand_editions, DEFAULT_CONFIG.expandEditions),
    expandEditionsLimit: asPositiveInt(
      adminConfig.expand_editions_limit,
      DEFAULT_CONFIG.expandEditionsLimit,
    ),
    preferEdition,
  };
}

/**
 * Does a collection satisfy the configured edition preference?
 *
 * A preference with both language and medium requires both to match. A
 * preference with only one dimension matches on that dimension alone.
 */
export function collectionMatchesPreference(
  collection: MbCollection,
  preference: EditionPreference | undefined,
): boolean {
  if (!preference || (!preference.language && !preference.medium)) return false;

  if (preference.language) {
    const iso = collection.language?.iso?.toLowerCase();
    if (iso !== preference.language) return false;
  }
  if (preference.medium) {
    const medium = collection.medium?.toLowerCase();
    if (medium !== preference.medium) return false;
  }
  return true;
}
