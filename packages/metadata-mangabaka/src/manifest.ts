import type { MetadataContentType, PluginManifest } from "@ashdev/codex-plugin-sdk";
import packageJson from "../package.json" with { type: "json" };

export const manifest = {
  name: "metadata-mangabaka",
  displayName: "MangaBaka Metadata (Collections)",
  version: packageJson.version,
  description:
    "Fetch manga metadata from MangaBaka, with per-edition Collection support so the volume count matches the edition you actually own.",
  author: "h-wb",
  homepage: "https://mangabaka.org",
  protocolVersion: "1.1",
  capabilities: {
    metadataProvider: ["series"] as MetadataContentType[],
  },
  requiredCredentials: [
    {
      key: "api_key",
      label: "API Key",
      description: "Get your API key at https://mangabaka.org/settings/api (requires account)",
      required: true,
      sensitive: true,
      type: "password",
      placeholder: "mb-...",
    },
  ],
  searchURITemplate: "https://mangabaka.org/search?sort_by=popularity_asc&q=<title>",
  configSchema: {
    description: "Optional configuration for the MangaBaka plugin",
    fields: [
      {
        key: "timeout",
        label: "Request Timeout",
        description: "HTTP request timeout in seconds for API calls to MangaBaka",
        type: "number",
        required: false,
        default: 60,
        example: 30,
      },
      {
        key: "sort_by",
        label: "Search Sort Order",
        description:
          "How the MangaBaka API sorts search results. Valid values: relevance_desc (default), popularity_asc (recommended - surfaces well-known series), popularity_desc, title_asc, title_desc, created_at_desc, created_at_asc",
        type: "string",
        required: false,
        default: "relevance_desc",
        example: "popularity_asc",
      },
      {
        key: "base_url",
        label: "API Base URL",
        description: "Override the MangaBaka API base URL (advanced).",
        type: "string",
        required: false,
        default: "https://api.mangabaka.org",
        example: "https://api.mangabaka.dev",
      },
      {
        key: "expand_editions",
        label: "Show Editions in Search",
        description:
          "List each published edition ('Collection') as its own selectable search result, so you can match the exact edition you own (e.g. the 7-volume omnibus instead of the 13-volume original). Editions rank just below their series.",
        type: "boolean",
        required: false,
        default: true,
      },
      {
        key: "expand_editions_limit",
        label: "Editions Expansion Limit",
        description:
          "How many of the top search results to expand into their editions. Higher values surface editions for more results but cost one extra API call per expanded result.",
        type: "number",
        required: false,
        default: 3,
        example: 3,
      },
      {
        key: "prefer_edition_language",
        label: "Preferred Edition Language",
        description:
          "Optional. When set (e.g. 'en'), auto-match prefers the edition in this language so its volume count is applied automatically. Leave blank to auto-match the base series and pick editions manually.",
        type: "string",
        required: false,
        example: "en",
      },
      {
        key: "prefer_edition_medium",
        label: "Preferred Edition Medium",
        description:
          "Optional. When set (e.g. 'digital' or 'paperback'), auto-match prefers the edition in this medium. Combine with Preferred Edition Language to disambiguate. Leave blank to pick editions manually.",
        type: "string",
        required: false,
        example: "digital",
      },
    ],
  },
} as const satisfies PluginManifest & {
  capabilities: { metadataProvider: MetadataContentType[] };
};
