/**
 * AniList Sync Plugin for Codex
 *
 * Syncs manga reading progress between Codex and AniList.
 * Communicates via JSON-RPC over stdio using the Codex plugin SDK.
 *
 * Capabilities:
 * - Push reading progress from Codex to AniList
 * - Pull reading progress from AniList to Codex
 * - Get user info from AniList
 * - Status reporting for sync state
 */

import {
  createLogger,
  createSyncPlugin,
  type ExternalUserInfo,
  type InitializeParams,
  type SyncEntry,
  type SyncEntryResult,
  type SyncProvider,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncStatusResponse,
} from "@ashdev/codex-plugin-sdk";
import {
  AniListClient,
  type AniListFuzzyDate,
  anilistStatusToSync,
  convertScoreFromAnilist,
  convertScoreToAnilist,
  fuzzyDateToIso,
  isoToFuzzyDate,
  syncStatusToAnilist,
} from "./anilist.js";
import { manifest } from "./manifest.js";

const logger = createLogger({ name: "sync-anilist", level: "debug" });

// Plugin state (set during initialization)
let client: AniListClient | null = null;
let viewerId: number | null = null;
let scoreFormat = "POINT_10";

// Plugin-specific config (from userConfig, set during initialization)
let progressUnit: "volumes" | "chapters" = "volumes";
let pauseAfterDays = 0;
let dropAfterDays = 0;
// Custom features — both OFF by default so the plugin behaves like upstream.
let notesUnit = false;
let enableReread = false;
let rereadRecentDays = 90;
let searchFallback = false;
let privateMode = true;
let hiddenFromStatusLists = false;

/** Set the AniList client (exported for testing) */
export function setClient(c: AniListClient | null): void {
  client = c;
}

/** Set the viewer ID (exported for testing) */
export function setViewerId(id: number | null): void {
  viewerId = id;
}

/** Set the searchFallback flag (exported for testing) */
export function setSearchFallback(enabled: boolean): void {
  searchFallback = enabled;
}

/** Set the privateMode flag (exported for testing) */
export function setPrivateMode(enabled: boolean): void {
  privateMode = enabled;
}

/** Set the hiddenFromStatusLists flag (exported for testing) */
export function setHiddenFromStatusLists(enabled: boolean): void {
  hiddenFromStatusLists = enabled;
}

// =============================================================================
// Staleness Logic
// =============================================================================

/**
 * Apply auto-pause/auto-drop for stale in-progress entries.
 *
 * Only applies to "reading" entries. Drop takes priority over pause
 * when both thresholds are met. A threshold of 0 means disabled.
 */
export function applyStaleness(
  status: SyncEntry["status"],
  latestUpdatedAt: string | undefined,
  pauseDays: number,
  dropDays: number,
  now?: number,
): SyncEntry["status"] {
  if (status !== "reading") return status;
  if (pauseDays === 0 && dropDays === 0) return status;
  if (!latestUpdatedAt) return status;

  const lastActivity = new Date(latestUpdatedAt).getTime();
  if (Number.isNaN(lastActivity)) return status;

  const currentTime = now ?? Date.now();
  const daysInactive = Math.max(0, (currentTime - lastActivity) / (1000 * 60 * 60 * 24));

  // Drop takes priority (stronger action)
  if (dropDays > 0 && daysInactive >= dropDays) {
    return "dropped";
  }
  if (pauseDays > 0 && daysInactive >= pauseDays) {
    return "on_hold";
  }

  return status;
}

// =============================================================================
// Per-series unit & reread helpers
// =============================================================================

const UNIT_CHAPTERS_RE = /\[unit:chapters\]/i;
const UNIT_VOLUMES_RE = /\[unit:volumes\]/i;

/**
 * Resolve the progress unit for a single series.
 *
 * A `[unit:chapters]` / `[unit:volumes]` marker in the Codex series notes
 * overrides the global default. The marker is only used for routing and is
 * never pushed back to AniList.
 */
export function detectUnit(
  notes: string | undefined,
  fallback: "volumes" | "chapters",
): "volumes" | "chapters" {
  if (notes) {
    if (UNIT_CHAPTERS_RE.test(notes)) return "chapters";
    if (UNIT_VOLUMES_RE.test(notes)) return "volumes";
  }
  return fallback;
}

/** Whether a series has reading activity within `withinDays` of `now`. */
export function isRecentActivity(
  latestUpdatedAt: string | undefined,
  withinDays: number,
  now?: number,
): boolean {
  if (!latestUpdatedAt) return false;
  if (withinDays <= 0) return true;
  const t = new Date(latestUpdatedAt).getTime();
  if (Number.isNaN(t)) return false;
  const currentTime = now ?? Date.now();
  const daysSince = (currentTime - t) / (1000 * 60 * 60 * 24);
  return daysSince <= withinDays;
}

export interface RereadDecision {
  /** AniList MediaListStatus to push */
  status: string;
  /** New repeat count, set only when a reread is being finished */
  repeat?: number;
}

/**
 * Decide the AniList status to push, layering reread (REPEATING) handling on
 * top of the base status mapping. Codex has no concept of rereading, so we
 * infer it from the AniList side:
 *
 * - Codex reading + AniList COMPLETED + recent activity -> REPEATING (reread started)
 * - Codex reading + AniList REPEATING                   -> REPEATING (reread continues)
 * - Codex completed + AniList REPEATING                 -> COMPLETED + repeat+1 (reread done)
 */
export function decideStatus(
  codexStatus: string,
  anilistStatus: string | undefined,
  recent: boolean,
  enabled: boolean,
  currentRepeat: number,
  mediaStatus?: string,
): RereadDecision {
  const base = syncStatusToAnilist(codexStatus);
  // Force completed when the AniList media is finished (highest priority)
  if (codexStatus === "completed" && mediaStatus === "FINISHED") {
    return { status: "COMPLETED" };
  }
  // If reread handling is disabled or there's no AniList entry, return base mapping
  if (!enabled || !anilistStatus) return { status: base };

  // REPEATING on AniList: reading -> REPEATING, completed -> finish reread
  if (anilistStatus === "REPEATING") {
    return codexStatus === "completed"
      ? { status: "COMPLETED", repeat: currentRepeat + 1 }
      : { status: "REPEATING" };
  }

  // reading + AniList COMPLETED + recent -> REPEATING
  if (codexStatus === "reading" && anilistStatus === "COMPLETED" && recent) {
    return { status: "REPEATING" };
  }

  return { status: base };
}

// =============================================================================
// Sync Provider Implementation
// =============================================================================

/** Exported for testing */
export const provider: SyncProvider = {
  async getUserInfo(): Promise<ExternalUserInfo> {
    if (!client) {
      throw new Error("Plugin not initialized - no AniList client");
    }

    const viewer = await client.getViewer();
    viewerId = viewer.id;
    scoreFormat = viewer.mediaListOptions.scoreFormat;

    logger.info(`Authenticated as ${viewer.name} (id: ${viewer.id}, scoreFormat: ${scoreFormat})`);

    return {
      externalId: String(viewer.id),
      username: viewer.name,
      avatarUrl: viewer.avatar.large || viewer.avatar.medium,
      profileUrl: viewer.siteUrl,
    };
  },

  async pushProgress(params: SyncPushRequest): Promise<SyncPushResponse> {
    if (!client || viewerId === null) {
      throw new Error("Plugin not initialized - call getUserInfo first");
    }

    // Pre-fetch existing entries: distinguish created/updated AND read the
    // current AniList status/progress/repeat (needed for reread detection).
    const existing = new Map<
      number,
      { status: string; progress: number; progressVolumes: number; repeat: number; mediaStatus?: string }
    >();
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const result = await client.getMangaList(viewerId, page, 50);
      for (const e of result.entries) {
        existing.set(e.mediaId, {
          status: e.status,
          progress: e.progress,
          progressVolumes: e.progressVolumes,
          repeat: e.repeat ?? 0,
          mediaStatus: e.media?.status,
        });
      }
      hasMore = result.pageInfo.hasNextPage;
      page++;
    }

    const nowMs = Date.now();
    const success: SyncEntryResult[] = [];
    const failed: SyncEntryResult[] = [];

    for (const entry of params.entries) {
      try {
        let mediaId = Number.parseInt(entry.externalId, 10);
        if (Number.isNaN(mediaId)) {
          // Try search fallback if enabled and entry has a title
          if (searchFallback && entry.title) {
            const result = await client.searchManga(entry.title);
            if (result) {
              mediaId = result.id;
              logger.info(`Search fallback resolved "${entry.title}" → AniList ID ${mediaId}`);
            }
          }

          if (Number.isNaN(mediaId)) {
            failed.push({
              externalId: entry.externalId,
              status: "failed",
              error: searchFallback
                ? `No AniList match found for "${entry.title || entry.externalId}"`
                : `Invalid media ID: ${entry.externalId}`,
            });
            continue;
          }
        }

        // Apply staleness logic: auto-pause or auto-drop stale in-progress entries
        const effectiveStatus = applyStaleness(
          entry.status,
          entry.latestUpdatedAt,
          pauseAfterDays,
          dropAfterDays,
        );
        if (effectiveStatus !== entry.status) {
          logger.debug(
            `Entry ${entry.externalId}: auto-${effectiveStatus === "dropped" ? "dropped" : "paused"} (was ${entry.status})`,
          );
        }

        // Per-series unit override via a [unit:*] notes marker — only when
        // notesUnit is enabled. Otherwise this is the upstream global unit.
        const unit = notesUnit ? detectUnit(entry.notes, progressUnit) : progressUnit;

        // Reread detection layered on top of the base status mapping.
        const ani = existing.get(mediaId);
        const recent = isRecentActivity(entry.latestUpdatedAt, rereadRecentDays, nowMs);
        const decision = decideStatus(
          effectiveStatus,
          ani?.status,
          recent,
          enableReread,
          ani?.repeat ?? 0,
          ani?.mediaStatus,
        );

        const saveParams: {
          mediaId: number;
          status?: string;
          score?: number;
          progress?: number;
          progressVolumes?: number;
          repeat?: number;
          startedAt?: AniListFuzzyDate;
          completedAt?: AniListFuzzyDate;
          notes?: string;
          private?: boolean;
          hiddenFromStatusLists?: boolean;
        } = {
          mediaId,
          status: decision.status,
          private: privateMode,
          hiddenFromStatusLists,
        };
        if (decision.repeat !== undefined) {
          saveParams.repeat = decision.repeat;
        }

        // Map the single Codex book count into the resolved unit's field.
        const count = entry.progress?.volumes ?? entry.progress?.chapters;
        if (count !== undefined) {
          if (unit === "chapters") {
            saveParams.progress = count;
          } else {
            saveParams.progressVolumes = count;
          }
        }

        // Map score (convert from 1-100 scale to AniList format)
        if (entry.score !== undefined) {
          saveParams.score = convertScoreToAnilist(entry.score, scoreFormat);
        }

        // Map dates
        if (entry.startedAt) {
          saveParams.startedAt = isoToFuzzyDate(entry.startedAt);
        }
        if (entry.completedAt) {
          saveParams.completedAt = isoToFuzzyDate(entry.completedAt);
        }

        // Map notes (upstream behavior). When notesUnit is enabled we skip
        // this, since the notes may carry a [unit:*] marker we must not leak.
        if (!notesUnit && entry.notes !== undefined) {
          saveParams.notes = entry.notes;
        }

        const resolvedExternalId = String(mediaId);
        const existed = existing.has(mediaId);
        const result = await client.saveEntry(saveParams);
        logger.debug(`Pushed entry ${resolvedExternalId}: unit=${unit} status=${result.status}`);

        // Reflect the new state so later entries in the batch see it.
        existing.set(mediaId, {
          status: decision.status,
          progress: saveParams.progress ?? ani?.progress ?? 0,
          progressVolumes: saveParams.progressVolumes ?? ani?.progressVolumes ?? 0,
          repeat: decision.repeat ?? ani?.repeat ?? 0,
          mediaStatus: ani?.mediaStatus,
        });

        success.push({
          externalId: resolvedExternalId,
          status: existed ? "updated" : "created",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to push entry ${entry.externalId}: ${message}`);
        failed.push({
          externalId: entry.externalId,
          status: "failed",
          error: message,
        });
      }
    }

    return { success, failed };
  },

  async pullProgress(params: SyncPullRequest): Promise<SyncPullResponse> {
    if (!client || viewerId === null) {
      throw new Error("Plugin not initialized - call getUserInfo first");
    }

    // Parse pagination cursor (page number)
    const page = params.cursor ? Number.parseInt(params.cursor, 10) : 1;
    const perPage = params.limit ? Math.min(params.limit, 50) : 50;

    const result = await client.getMangaList(viewerId, page, perPage);

    const entries: SyncEntry[] = result.entries.map((entry) => ({
      externalId: String(entry.mediaId),
      status: anilistStatusToSync(entry.status),
      progress: {
        chapters: entry.progress || undefined,
        volumes: entry.progressVolumes || undefined,
      },
      score: entry.score > 0 ? convertScoreFromAnilist(entry.score, scoreFormat) : undefined,
      startedAt: fuzzyDateToIso(entry.startedAt),
      completedAt: fuzzyDateToIso(entry.completedAt),
      // Skip note import only when notesUnit is on (so a pulled note can't
      // clobber a [unit:*] marker). Otherwise upstream behavior.
      notes: notesUnit ? undefined : entry.notes || undefined,
    }));

    logger.info(
      `Pulled ${entries.length} entries (page ${result.pageInfo.currentPage}/${result.pageInfo.lastPage})`,
    );

    return {
      entries,
      nextCursor: result.pageInfo.hasNextPage ? String(result.pageInfo.currentPage + 1) : undefined,
      hasMore: result.pageInfo.hasNextPage,
    };
  },

  async status(): Promise<SyncStatusResponse> {
    if (!client || viewerId === null) {
      return {
        pendingPush: 0,
        pendingPull: 0,
        conflicts: 0,
      };
    }

    // Get total count from AniList
    const result = await client.getMangaList(viewerId, 1, 1);

    return {
      externalCount: result.pageInfo.total,
      pendingPush: 0,
      pendingPull: 0,
      conflicts: 0,
    };
  },
};

// =============================================================================
// Plugin Initialization
// =============================================================================

createSyncPlugin({
  manifest,
  provider,
  logLevel: "debug",
  onInitialize(params: InitializeParams) {
    // Get access token from credentials
    const accessToken = params.credentials?.access_token;
    if (accessToken) {
      client = new AniListClient(accessToken);
      logger.info("AniList client initialized with access token");
    } else {
      logger.warn("No access token provided - sync operations will fail");
    }

    // Read plugin-specific config from userConfig
    const uc = params.userConfig;
    if (uc) {
      const unit = uc.progressUnit;
      if (unit === "chapters" || unit === "volumes") {
        progressUnit = unit;
      }
      if (typeof uc.pauseAfterDays === "number" && uc.pauseAfterDays >= 0) {
        pauseAfterDays = uc.pauseAfterDays;
      }
      if (typeof uc.dropAfterDays === "number" && uc.dropAfterDays >= 0) {
        dropAfterDays = uc.dropAfterDays;
      }
      if (typeof uc.notesUnit === "boolean") {
        notesUnit = uc.notesUnit;
      }
      if (typeof uc.enableReread === "boolean") {
        enableReread = uc.enableReread;
      }
      if (typeof uc.rereadRecentDays === "number" && uc.rereadRecentDays >= 0) {
        rereadRecentDays = uc.rereadRecentDays;
      }
      if (typeof uc.searchFallback === "boolean") {
        searchFallback = uc.searchFallback;
      }
      if (typeof uc.private === "boolean") {
        privateMode = uc.private;
      }
      if (typeof uc.hiddenFromStatusLists === "boolean") {
        hiddenFromStatusLists = uc.hiddenFromStatusLists;
      }
      logger.info(
        `Plugin config: progressUnit=${progressUnit}, pauseAfterDays=${pauseAfterDays}, dropAfterDays=${dropAfterDays}, notesUnit=${notesUnit}, enableReread=${enableReread}, rereadRecentDays=${rereadRecentDays}, searchFallback=${searchFallback}, private=${privateMode}, hiddenFromStatusLists=${hiddenFromStatusLists}`,
      );
    }
  },
});

logger.info("AniList sync plugin started");
