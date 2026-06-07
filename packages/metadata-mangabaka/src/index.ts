/**
 * MangaBaka Plugin (Collections edition) - Fetch manga metadata from MangaBaka
 *
 * MangaBaka aggregates metadata from multiple sources (AniList, MAL, MangaDex, etc.)
 * and provides a unified API for manga/novel metadata.
 *
 * This fork adds per-edition "Collection" support: each published edition of a
 * series (e.g. the VIZ 7-volume omnibus vs. the original 13-volume run) can be
 * matched directly, so the tracked volume count matches the edition you own.
 *
 * API docs: https://mangabaka.org/api
 *
 * Credentials are provided by Codex via the initialize message.
 * Required credential: api_key (get one at https://mangabaka.org/settings/api)
 */

import {
  ConfigError,
  createLogger,
  createMetadataPlugin,
  type InitializeParams,
  type MetadataProvider,
} from "@ashdev/codex-plugin-sdk";
import { MangaBakaClient } from "./api.js";
import { DEFAULT_CONFIG, type PluginConfig, parseConfig } from "./config.js";
import { handleGet } from "./handlers/get.js";
import { handleMatch } from "./handlers/match.js";
import { handleSearch } from "./handlers/search.js";
import { manifest } from "./manifest.js";

const logger = createLogger({ name: "mangabaka", level: "info" });

// Client and config are initialized when we receive credentials from Codex
let client: MangaBakaClient | null = null;
let config: PluginConfig = DEFAULT_CONFIG;

function getClient(): MangaBakaClient {
  if (!client) {
    throw new ConfigError("Plugin not initialized - missing API key");
  }
  return client;
}

// Create the MetadataProvider implementation
const provider: MetadataProvider = {
  async search(params) {
    return handleSearch(params, getClient(), config);
  },

  async get(params) {
    return handleGet(params, getClient());
  },

  async match(params) {
    return handleMatch(params, getClient(), config);
  },
};

// Start the plugin server
createMetadataPlugin({
  manifest,
  provider,
  logLevel: "info",
  onInitialize(params: InitializeParams) {
    const apiKey = params.credentials?.api_key;
    if (!apiKey) {
      throw new ConfigError("api_key credential is required");
    }

    // Get optional config from admin settings
    const timeout = params.adminConfig?.timeout as number | undefined;
    const sortBy = params.adminConfig?.sort_by as string | undefined;
    const baseUrl = params.adminConfig?.base_url as string | undefined;
    config = parseConfig(params.adminConfig);

    client = new MangaBakaClient(apiKey, { timeout, sortBy, baseUrl });
    logger.info(
      `MangaBaka client initialized (baseUrl: ${baseUrl ?? "default"}, timeout: ${timeout ?? "default"}s, sortBy: ${sortBy ?? "default"}, expandEditions: ${config.expandEditions}, preferEdition: ${JSON.stringify(config.preferEdition ?? null)})`,
    );
  },
});

logger.info("MangaBaka plugin started");
