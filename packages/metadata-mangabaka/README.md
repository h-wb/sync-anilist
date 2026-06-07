# @h-wb/metadata-mangabaka

A [Codex](https://github.com/AshDevFr/codex) **metadata provider** for
[MangaBaka](https://mangabaka.org), forked from the upstream `metadata-mangabaka`
plugin and extended with per-edition **Collection** support.

## Why this fork?

MangaBaka stores both the original series *and* its individual published editions
("Collections"). These can have very different volume counts. For example
[Goodnight Punpun](https://mangabaka.org/1357):

| | Volumes |
| --- | --- |
| Original Japanese run | 13 |
| VIZ Signature omnibus (digital / paperback) | **7** |

The upstream plugin always reports the original count (13). If you own the VIZ
omnibus, your library shows the wrong total. This fork lets you match the **edition
you actually own** so the volume count is correct — which also makes downstream
tools like [`@h-wb/sync-anilist`](../sync-anilist) (proportional progress scaling)
line up.

## How it works

MangaBaka exposes editions at `GET /v1/series/{id}/collections`, each with a
`count_main` (the edition's volume count), publisher, language and medium.

- **Search** lists each edition as its own selectable result, right under the base
  series — e.g. *“Goodnight Punpun — VIZ Signature · Digital · 7 vol”*. Pick the one
  you own.
- The selected edition is encoded into the `externalId` (`<seriesId>:c:<collectionId>`),
  so every metadata **refresh** re-applies that edition's volume count. The base
  series keeps the plain `<seriesId>` form, unchanged from upstream.
- **Auto-match** resolves to the base series by default (Codex does not tell plugins
  how many volumes you own, so it can't pick an edition for you). Use search to pin
  an edition per series — or set an edition preference (below) to auto-pick one.

## Configuration

All fields are optional admin config.

| Key | Default | Description |
| --- | --- | --- |
| `timeout` | `60` | HTTP request timeout (seconds). |
| `sort_by` | `relevance_desc` | MangaBaka search sort order. |
| `base_url` | `https://api.mangabaka.org` | Override the API base URL. |
| `expand_editions` | `true` | List editions as separate search results. |
| `expand_editions_limit` | `3` | How many top search results to expand into editions (one extra API call each). |
| `prefer_edition_language` | — | When set (e.g. `en`), auto-match prefers the edition in this language. |
| `prefer_edition_medium` | — | When set (e.g. `digital`, `paperback`), auto-match prefers the edition in this medium. |

Set `prefer_edition_language` and/or `prefer_edition_medium` to have auto-match
resolve straight to that edition (and apply its volume count) instead of the base
series. Leave them blank to keep auto-match on the base series and pick editions
manually.

## Credentials

Requires a MangaBaka API key (`api_key`). Get one at
<https://mangabaka.org/settings/api>.

## Development

```bash
npm install                                   # from the repo root
npm run check  -w packages/metadata-mangabaka # biome + tsc
npm test       -w packages/metadata-mangabaka # vitest
npm run build  -w packages/metadata-mangabaka # bundle to dist/index.js
```

## License

MIT
