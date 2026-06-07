/**
 * AniList Sync Plugin for Codex
 *
 * Syncs manga reading progress between Codex and AniList over JSON-RPC (stdio),
 * using the Codex plugin SDK.
 *
 * Capabilities:
 * - Push reading progress from Codex to AniList
 * - Pull reading progress from AniList to Codex
 * - Report the authenticated AniList user
 * - Report sync status
 */

import {
  createLogger,
  createSyncPlugin,
  type ExternalUserInfo,
  type InitializeParams,
  type SyncEntry,
  type SyncEntryResult,
  type SyncProgress,
  type SyncProvider,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncStatusResponse,
} from "@ashdev/codex-plugin-sdk";
import {
  AniListClient,
  type AniListSaveResult,
  anilistStatusToSync,
  convertScoreFromAnilist,
  convertScoreToAnilist,
  fuzzyDateToIso,
  isoToFuzzyDate,
  type SaveEntryInput,
  syncStatusToAnilist,
} from "./anilist.js";
import { manifest } from "./manifest.js";

const logger = createLogger({ name: "sync-anilist", level: "debug" });

const DAY_MS = 1000 * 60 * 60 * 24;
/** Max page size AniList allows for the manga-list query. */
const PAGE_SIZE = 50;
/**
 * Safety cap for `stepProgress`: when the gap between current and target
 * progress exceeds this, push a single jump instead of one call per unit
 * (avoids hammering AniList's rate limit on a large first-time backfill).
 */
const MAX_PROGRESS_STEPS = 50;

type ProgressUnit = "volumes" | "chapters";

// =============================================================================
// Connection state (set when the plugin authenticates)
// =============================================================================

let client: AniListClient | null = null;
let viewerId: number | null = null;
let scoreFormat = "POINT_10";

// =============================================================================
// Configuration (from userConfig, applied during initialization)
// =============================================================================

let progressUnit: ProgressUnit = "volumes";
/** Scale local progress onto AniList's canonical total — OFF by default. */
let scaleProgress = false;
/** Post each unit as its own update so AniList logs the climb — OFF by default. */
let stepProgress = false;
let pauseAfterDays = 0;
let dropAfterDays = 0;
/** Reread detection — OFF by default so the plugin behaves like upstream. */
let enableReread = false;
let rereadRecentDays = 90;
let searchFallback = false;
let privateMode = true;
let hiddenFromStatusLists = false;

// Test seams — let unit tests drive state without a live connection/config.
/** @internal */ export function setClient(c: AniListClient | null): void {
  client = c;
}
/** @internal */ export function setViewerId(id: number | null): void {
  viewerId = id;
}
/** @internal */ export function setProgressUnit(unit: ProgressUnit): void {
  progressUnit = unit;
}
/** @internal */ export function setScaleProgress(enabled: boolean): void {
  scaleProgress = enabled;
}
/** @internal */ export function setStepProgress(enabled: boolean): void {
  stepProgress = enabled;
}
/** @internal */ export function setSearchFallback(enabled: boolean): void {
  searchFallback = enabled;
}
/** @internal */ export function setPrivateMode(enabled: boolean): void {
  privateMode = enabled;
}
/** @internal */ export function setHiddenFromStatusLists(enabled: boolean): void {
  hiddenFromStatusLists = enabled;
}

/** Read a boolean userConfig option, falling back when it's absent/invalid. */
function boolOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Read a non-negative number userConfig option, falling back otherwise. */
function numberOption(value: unknown, fallback: number): number {
  return typeof value === "number" && value >= 0 ? value : fallback;
}

/** Apply the user's plugin settings to module configuration. */
function applyUserConfig(uc: Record<string, unknown>): void {
  if (uc.progressUnit === "chapters" || uc.progressUnit === "volumes") {
    progressUnit = uc.progressUnit;
  }
  scaleProgress = boolOption(uc.scaleProgress, scaleProgress);
  stepProgress = boolOption(uc.stepProgress, stepProgress);
  pauseAfterDays = numberOption(uc.pauseAfterDays, pauseAfterDays);
  dropAfterDays = numberOption(uc.dropAfterDays, dropAfterDays);
  enableReread = boolOption(uc.enableReread, enableReread);
  rereadRecentDays = numberOption(uc.rereadRecentDays, rereadRecentDays);
  searchFallback = boolOption(uc.searchFallback, searchFallback);
  privateMode = boolOption(uc.private, privateMode);
  hiddenFromStatusLists = boolOption(uc.hiddenFromStatusLists, hiddenFromStatusLists);
}

// =============================================================================
// Staleness (auto-pause / auto-drop)
// =============================================================================

/**
 * Downgrade a stale in-progress entry to Paused or Dropped.
 *
 * Only applies to "reading" entries. Drop takes priority over pause when both
 * thresholds are met. A threshold of 0 disables that action.
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

  const daysInactive = Math.max(0, ((now ?? Date.now()) - lastActivity) / DAY_MS);

  // Drop takes priority (stronger action).
  if (dropDays > 0 && daysInactive >= dropDays) return "dropped";
  if (pauseDays > 0 && daysInactive >= pauseDays) return "on_hold";
  return status;
}

// =============================================================================
// Reread detection (AniList REPEATING)
// =============================================================================

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
  return ((now ?? Date.now()) - t) / DAY_MS <= withinDays;
}

export interface StatusDecision {
  /** AniList MediaListStatus to push. */
  status: string;
  /** New repeat count — set only when a reread is being finished. */
  repeat?: number;
}

/**
 * Decide the AniList status to push, layering reread (REPEATING) handling on
 * top of the plain status mapping. Codex has no concept of rereading, so we
 * infer it from the series' current AniList status:
 *
 * - Codex reading  + AniList COMPLETED + recent activity -> REPEATING (reread started)
 * - Codex reading  + AniList REPEATING                   -> REPEATING (reread continues)
 * - Codex completed + AniList REPEATING                  -> COMPLETED + repeat+1 (reread done)
 *
 * With reread disabled, or no existing AniList entry, this is the plain mapping.
 */
export function decideStatus(
  codexStatus: string,
  anilistStatus: string | undefined,
  recent: boolean,
  enabled: boolean,
  currentRepeat: number,
): StatusDecision {
  const base = syncStatusToAnilist(codexStatus);
  if (!enabled || !anilistStatus) return { status: base };

  if (anilistStatus === "REPEATING") {
    return codexStatus === "completed"
      ? { status: "COMPLETED", repeat: currentRepeat + 1 }
      : { status: "REPEATING" };
  }

  if (codexStatus === "reading" && anilistStatus === "COMPLETED" && recent) {
    return { status: "REPEATING" };
  }

  return { status: base };
}

// =============================================================================
// Push helpers
// =============================================================================

/** The slice of a remote AniList entry we need while pushing. */
interface RemoteEntry {
  status: string;
  progress: number;
  progressVolumes: number;
  repeat: number;
  /** Media publishing status, e.g. "FINISHED". */
  mediaStatus?: string;
  /** Canonical total volumes/chapters (undefined when AniList doesn't track it). */
  mediaVolumes?: number;
  mediaChapters?: number;
}

/** Fetch the viewer's entire AniList manga list, keyed by media id. */
async function fetchRemoteEntries(
  c: AniListClient,
  userId: number,
): Promise<Map<number, RemoteEntry>> {
  const entries = new Map<number, RemoteEntry>();
  for (let page = 1; ; page++) {
    const { entries: list, pageInfo } = await c.getMangaList(userId, page, PAGE_SIZE);
    for (const e of list) {
      entries.set(e.mediaId, {
        status: e.status,
        progress: e.progress,
        progressVolumes: e.progressVolumes,
        repeat: e.repeat ?? 0,
        mediaStatus: e.media?.status,
        mediaVolumes: e.media?.volumes ?? undefined,
        mediaChapters: e.media?.chapters ?? undefined,
      });
    }
    if (!pageInfo.hasNextPage) break;
  }
  return entries;
}

/**
 * Resolve an entry's AniList media id. Uses the numeric external id when
 * present, otherwise falls back to a title search when that's enabled.
 * Returns null when no id can be determined.
 */
async function resolveMediaId(c: AniListClient, entry: SyncEntry): Promise<number | null> {
  const parsed = Number.parseInt(entry.externalId, 10);
  if (!Number.isNaN(parsed)) return parsed;

  if (searchFallback && entry.title) {
    const match = await c.searchManga(entry.title);
    if (match) {
      logger.info(`Search fallback resolved "${entry.title}" → AniList ID ${match.id}`);
      return match.id;
    }
  }
  return null;
}

/**
 * Resolve the progress count to push, in the configured unit. Two behaviours
 * layer on top of the raw local book count:
 *
 * - **Scale progress** (opt-in): map local progress proportionally onto
 *   AniList's canonical total. An omnibus/perfect volume bundles several
 *   canonical volumes, so reading 1 of 2 local books of a 7-volume series is
 *   ~4/7. Needs both the Codex series total (from the payload) and AniList's
 *   total; a no-op when they're equal. At 100% it yields the canonical total,
 *   so it subsumes the fill below.
 * - **Completed fill** (always-on): when completing a series that's finished
 *   publishing on AniList, push its canonical total instead of the local count,
 *   so a finished local edition isn't left looking half-read (e.g. 2/7).
 */
function resolveProgressCount(
  unit: ProgressUnit,
  progress: SyncProgress | undefined,
  decidedStatus: string,
  remote: RemoteEntry | undefined,
  scale: boolean,
): number | undefined {
  const reportedCount = progress?.volumes ?? progress?.chapters;
  const canonicalTotal = unit === "chapters" ? remote?.mediaChapters : remote?.mediaVolumes;
  const codexTotal = unit === "chapters" ? progress?.totalChapters : progress?.totalVolumes;

  if (
    scale &&
    reportedCount !== undefined &&
    canonicalTotal !== undefined &&
    canonicalTotal > 0 &&
    codexTotal !== undefined &&
    codexTotal > 0
  ) {
    const scaled = Math.round((reportedCount / codexTotal) * canonicalTotal);
    return Math.min(Math.max(scaled, 0), canonicalTotal);
  }

  const completingFinishedSeries =
    decidedStatus === "COMPLETED" &&
    remote?.mediaStatus === "FINISHED" &&
    canonicalTotal !== undefined &&
    canonicalTotal > 0;
  return completingFinishedSeries ? canonicalTotal : reportedCount;
}

/** Build the AniList `SaveMediaListEntry` input for one resolved entry. */
function buildSaveInput(
  entry: SyncEntry,
  mediaId: number,
  decision: StatusDecision,
  remote: RemoteEntry | undefined,
): SaveEntryInput {
  const input: SaveEntryInput = {
    mediaId,
    status: decision.status,
    private: privateMode,
    hiddenFromStatusLists,
  };
  if (decision.repeat !== undefined) input.repeat = decision.repeat;

  const count = resolveProgressCount(
    progressUnit,
    entry.progress,
    decision.status,
    remote,
    scaleProgress,
  );
  if (count !== undefined) {
    if (progressUnit === "chapters") input.progress = count;
    else input.progressVolumes = count;
  }

  if (entry.score !== undefined) input.score = convertScoreToAnilist(entry.score, scoreFormat);
  if (entry.startedAt) input.startedAt = isoToFuzzyDate(entry.startedAt);
  if (entry.completedAt) input.completedAt = isoToFuzzyDate(entry.completedAt);
  if (entry.notes !== undefined) input.notes = entry.notes;

  return input;
}

/**
 * Save an entry, optionally stepping the progress one unit at a time so AniList
 * logs each volume/chapter (read 1, read 2, …) instead of a single jump.
 *
 * Intermediate calls send only the progress (and visibility flags); the final
 * call carries the full `input` (status, score, dates, notes). Stepping only
 * runs when `stepProgress` is on, the target is higher than the current AniList
 * progress, and the gap is within {@link MAX_PROGRESS_STEPS} (else: one jump).
 */
async function saveProgress(
  c: AniListClient,
  input: SaveEntryInput,
  remote: RemoteEntry | undefined,
): Promise<AniListSaveResult> {
  const isChapters = progressUnit === "chapters";
  const target = isChapters ? input.progress : input.progressVolumes;
  const current = (isChapters ? remote?.progress : remote?.progressVolumes) ?? 0;

  if (
    stepProgress &&
    target !== undefined &&
    target > current &&
    target - current <= MAX_PROGRESS_STEPS
  ) {
    for (let p = current + 1; p < target; p++) {
      const step: SaveEntryInput = {
        mediaId: input.mediaId,
        private: input.private,
        hiddenFromStatusLists: input.hiddenFromStatusLists,
      };
      if (isChapters) step.progress = p;
      else step.progressVolumes = p;
      await c.saveEntry(step);
    }
  }

  return c.saveEntry(input);
}

// =============================================================================
// Sync provider
// =============================================================================

/** @internal exported for testing */
export const provider: SyncProvider = {
  async getUserInfo(): Promise<ExternalUserInfo> {
    if (!client) throw new Error("Plugin not initialized - no AniList client");

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

    // Pre-fetch the remote list once: tells us created-vs-updated and supplies
    // the current status/repeat (for reread) and canonical totals (for the fill).
    const remoteEntries = await fetchRemoteEntries(client, viewerId);
    const now = Date.now();
    const success: SyncEntryResult[] = [];
    const failed: SyncEntryResult[] = [];

    for (const entry of params.entries) {
      try {
        const mediaId = await resolveMediaId(client, entry);
        if (mediaId === null) {
          failed.push({
            externalId: entry.externalId,
            status: "failed",
            error: searchFallback
              ? `No AniList match found for "${entry.title || entry.externalId}"`
              : `Invalid media ID: ${entry.externalId}`,
          });
          continue;
        }

        const status = applyStaleness(
          entry.status,
          entry.latestUpdatedAt,
          pauseAfterDays,
          dropAfterDays,
        );
        if (status !== entry.status) {
          logger.debug(`Entry ${entry.externalId}: auto-${status} (was ${entry.status})`);
        }

        const remote = remoteEntries.get(mediaId);
        const decision = decideStatus(
          status,
          remote?.status,
          isRecentActivity(entry.latestUpdatedAt, rereadRecentDays, now),
          enableReread,
          remote?.repeat ?? 0,
        );
        const input = buildSaveInput(entry, mediaId, decision, remote);

        const existed = remoteEntries.has(mediaId);
        const saved = await saveProgress(client, input, remote);
        logger.debug(`Pushed entry ${mediaId}: unit=${progressUnit} status=${saved.status}`);

        // Reflect the new state so later entries in the batch see it.
        remoteEntries.set(mediaId, {
          ...remote,
          status: decision.status,
          progress: input.progress ?? remote?.progress ?? 0,
          progressVolumes: input.progressVolumes ?? remote?.progressVolumes ?? 0,
          repeat: decision.repeat ?? remote?.repeat ?? 0,
        });

        success.push({ externalId: String(mediaId), status: existed ? "updated" : "created" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logger.error(`Failed to push entry ${entry.externalId}: ${message}`);
        failed.push({ externalId: entry.externalId, status: "failed", error: message });
      }
    }

    return { success, failed };
  },

  async pullProgress(params: SyncPullRequest): Promise<SyncPullResponse> {
    if (!client || viewerId === null) {
      throw new Error("Plugin not initialized - call getUserInfo first");
    }

    const page = params.cursor ? Number.parseInt(params.cursor, 10) : 1;
    const perPage = params.limit ? Math.min(params.limit, PAGE_SIZE) : PAGE_SIZE;
    const { entries: list, pageInfo } = await client.getMangaList(viewerId, page, perPage);

    const entries: SyncEntry[] = list.map((entry) => ({
      externalId: String(entry.mediaId),
      status: anilistStatusToSync(entry.status),
      progress: {
        chapters: entry.progress || undefined,
        volumes: entry.progressVolumes || undefined,
      },
      score: entry.score > 0 ? convertScoreFromAnilist(entry.score, scoreFormat) : undefined,
      startedAt: fuzzyDateToIso(entry.startedAt),
      completedAt: fuzzyDateToIso(entry.completedAt),
      notes: entry.notes || undefined,
    }));

    logger.info(
      `Pulled ${entries.length} entries (page ${pageInfo.currentPage}/${pageInfo.lastPage})`,
    );

    return {
      entries,
      nextCursor: pageInfo.hasNextPage ? String(pageInfo.currentPage + 1) : undefined,
      hasMore: pageInfo.hasNextPage,
    };
  },

  async status(): Promise<SyncStatusResponse> {
    if (!client || viewerId === null) {
      return { pendingPush: 0, pendingPull: 0, conflicts: 0 };
    }

    const { pageInfo } = await client.getMangaList(viewerId, 1, 1);
    return { externalCount: pageInfo.total, pendingPush: 0, pendingPull: 0, conflicts: 0 };
  },
};

// =============================================================================
// Plugin bootstrap
// =============================================================================

createSyncPlugin({
  manifest,
  provider,
  logLevel: "debug",
  onInitialize(params: InitializeParams) {
    const accessToken = params.credentials?.access_token;
    if (accessToken) {
      client = new AniListClient(accessToken);
      logger.info("AniList client initialized with access token");
    } else {
      logger.warn("No access token provided - sync operations will fail");
    }

    if (params.userConfig) {
      applyUserConfig(params.userConfig);
      logger.info(
        `Plugin config: progressUnit=${progressUnit}, scaleProgress=${scaleProgress}, ` +
          `stepProgress=${stepProgress}, pauseAfterDays=${pauseAfterDays}, dropAfterDays=${dropAfterDays}, ` +
          `enableReread=${enableReread}, ` +
          `rereadRecentDays=${rereadRecentDays}, searchFallback=${searchFallback}, ` +
          `private=${privateMode}, hiddenFromStatusLists=${hiddenFromStatusLists}`,
      );
    }
  },
});

logger.info("AniList sync plugin started");
