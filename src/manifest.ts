import type { PluginManifest } from "@ashdev/codex-plugin-sdk";
import packageJson from "../package.json" with { type: "json" };

/** Canonical external ID source for AniList (`api:<service>` convention) */
const EXTERNAL_ID_SOURCE_ANILIST = "api:anilist" as const;

export const manifest = {
  name: "sync-anilist",
  displayName: "AniList Sync",
  version: packageJson.version,
  description: "Sync manga reading progress to AniList, with reread (REPEATING) detection.",
  author: "h-wb",
  homepage: "https://github.com/h-wb/sync-anilist",
  protocolVersion: "1.0",
  capabilities: {
    userReadSync: true,
    externalIdSource: EXTERNAL_ID_SOURCE_ANILIST,
  },
  requiredCredentials: [
    {
      key: "access_token",
      label: "AniList Access Token",
      description: "OAuth access token for AniList API",
      type: "password" as const,
      required: true,
      sensitive: true,
    },
  ],
  userConfigSchema: {
    description: "AniList-specific sync settings",
    fields: [
      {
        key: "progressUnit",
        label: "Progress Unit",
        description:
          "Mapping for each Codex book on AniList: 'volumes' or 'chapters'. To track different libraries with different units, install this plugin once per library (scope each instance to one library) and set the unit per instance.",
        type: "string" as const,
        required: false,
        default: "volumes",
      },
      {
        key: "scaleProgress",
        label: "Scale Progress to AniList Total",
        description:
          "Opt-in. Map local progress proportionally onto AniList's total — useful for omnibus/perfect editions that bundle several canonical volumes per book (e.g. reading 1 of 2 local books of a 7-volume series pushes ~4/7). Needs the series' Codex volume/chapter total to match your local edition. No-op when your total already matches AniList's. Off = push the raw local count.",
        type: "boolean" as const,
        required: false,
        default: false,
      },
      {
        key: "stepProgress",
        label: "Post Each Volume Separately",
        description:
          "Opt-in. Instead of jumping straight to the target progress, push one update per volume/chapter (read 1, read 2, …) from your current AniList progress, so AniList logs the climb. Pairs with Scale Progress. Costs one API call per unit (capped for large gaps); AniList may merge rapid updates into a single 'read 1 – N' activity. Off = a single update.",
        type: "boolean" as const,
        required: false,
        default: false,
      },
      {
        key: "enableReread",
        label: "Detect Rereads (AniList REPEATING)",
        description:
          "Opt-in. When a series is COMPLETED on AniList but Codex shows it being read again (recently), push it as Rereading (REPEATING) on AniList. When the reread finishes, set it back to Completed and bump the repeat count. Off = upstream behavior.",
        type: "boolean" as const,
        required: false,
        default: false,
      },
      {
        key: "rereadRecentDays",
        label: "Reread Activity Window (days)",
        description:
          "Only treat a COMPLETED-on-AniList series as a reread if it has reading activity within this many days. Guards against incomplete local libraries of series you finished elsewhere. Default 90.",
        type: "number" as const,
        required: false,
        default: 90,
      },
      {
        key: "pauseAfterDays",
        label: "Auto-Pause After Days",
        description:
          "Automatically set in-progress series to Paused on AniList if no reading activity in this many days. Set to 0 to disable.",
        type: "number" as const,
        required: false,
        default: 0,
      },
      {
        key: "dropAfterDays",
        label: "Auto-Drop After Days",
        description:
          "Automatically set in-progress series to Dropped on AniList if no reading activity in this many days. Set to 0 to disable. When both pause and drop are set, the shorter threshold fires first.",
        type: "number" as const,
        required: false,
        default: 0,
      },
      {
        key: "searchFallback",
        label: "Search Fallback",
        description:
          "When a series has no AniList ID, search by title to find a match and sync progress. Disable for strict matching only.",
        type: "boolean" as const,
        required: false,
        default: false,
      },
      {
        key: "private",
        label: "Private Mode",
        description:
          "When enabled, all manga list entries synced from Codex will be marked as private on AniList, visible only to you. When disabled, entries follow AniList's default visibility (public).",
        type: "boolean" as const,
        required: false,
        default: true,
      },
      {
        key: "hiddenFromStatusLists",
        label: "Hide from Status Lists",
        description:
          "When enabled, synced entries will be hidden from your standard AniList status lists (Currently Reading, Completed, etc.) but will still appear in custom lists. Has no effect when Private Mode is enabled.",
        type: "boolean" as const,
        required: false,
        default: false,
      },
    ],
  },
  oauth: {
    authorizationUrl: "https://anilist.co/api/v2/oauth/authorize",
    tokenUrl: "https://anilist.co/api/v2/oauth/token",
    scopes: [],
    pkce: false,
  },
  userDescription: "Sync manga reading progress between Codex and AniList",
  adminSetupInstructions:
    "To enable OAuth login, create an AniList API client at https://anilist.co/settings/developer. Set the redirect URL to {your-codex-url}/api/v1/user/plugins/oauth/callback. Enter the Client ID below. Without OAuth configured, users can still connect by pasting a personal access token.",
  userSetupInstructions:
    "Connect your AniList account via OAuth, or paste a personal access token. To generate a token, visit https://anilist.co/settings/developer, create a client with redirect URL https://anilist.co/api/v2/oauth/pin, then authorize it to receive your token.",
} as const satisfies PluginManifest & {
  capabilities: { userReadSync: true };
};
