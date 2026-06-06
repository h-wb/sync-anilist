# @h-wb/sync-anilist

A [Codex](https://github.com/AshDevFr/codex) plugin that syncs manga reading progress to [AniList](https://anilist.co) — a fork of Codex's built-in `sync-anilist` plugin with two additions:

1. **Per-series volume/chapter routing** — choose whether a series maps to AniList **volumes** or **chapters** individually, via a marker in the series' Codex notes. (The stock plugin only has one global unit.)
2. **Reread detection** — when a series is `COMPLETED` on AniList but you start reading it again in Codex, it's pushed as **Rereading (`REPEATING`)**, and set back to `COMPLETED` (with the repeat count bumped) when you finish.

The Codex-facing plugin name is still `sync-anilist`, so it drops into Codex exactly like the original.

> Why a fork instead of config? The Codex plugin protocol never tells a sync plugin which **library/collection** a series belongs to, and has no `REPEATING` status. Both features are reconstructed plugin-side: the unit from a per-series notes marker, the reread from AniList's own current status. See [How it works](#how-it-works).

## Install in Codex

1. Codex → **Settings → Plugins → Add Plugin**
2. Fill in:
   - **Name**: `sync-anilist`
   - **Display Name**: `AniList Sync`
   - **Command**: `npx`
   - **Arguments**: `-y https://github.com/h-wb/sync-anilist/releases/download/v1.0.0/h-wb-sync-anilist-1.0.0.tgz`  *(bump the version in the URL to upgrade)*
3. **Save**, then **Test Connection**.

> Installed from a prebuilt tarball attached to a GitHub Release — **no npm account, no registry, and no `git` on the host** (`npx github:…` needs git, which many container images lack). The tarball is self-contained (the SDK is bundled in); the host just needs Node 22+. The URL is versioned — change the version to upgrade.
4. Connect your AniList account in **Settings → Integrations** (OAuth or a personal access token — see the [AniList developer settings](https://anilist.co/settings/developer)).

## Per-series unit (volumes vs chapters)

Each Codex book is one "unit". By default everything maps to AniList **volumes** (`progressVolumes`). To track a series by **chapters** instead, add a marker to that series' **notes** in Codex:

```
[unit:chapters]
```

`[unit:volumes]` is also accepted to force volumes explicitly. The default for unmarked series is the **Default Progress Unit** plugin setting.

Requirements & guarantees:
- **Opt-in:** turn on the **Per-Series Unit From Notes** plugin setting (off by default — with it off the plugin uses the global unit, exactly like upstream).
- Turn **Sync Ratings & Notes** ON (in the shared Sync Settings) so notes reach the plugin.
- While enabled, the marker is **only** read for routing — it is **never** pushed to AniList, and the plugin never imports AniList notes back into Codex (so it can't clobber your marker).

## Reread (AniList `REPEATING`)

Codex has no concept of rereading, but AniList does. This plugin can infer it — **opt-in via the Detect Rereads setting** (off by default):

| Codex says | AniList currently | Result pushed |
|---|---|---|
| reading + recent activity | `COMPLETED` | `REPEATING` (reread started) |
| reading | `REPEATING` | `REPEATING` (reread continues) |
| completed | `REPEATING` | `COMPLETED`, `repeat += 1` (reread finished) |

- **False-positive guard:** a reread is only inferred when there's reading activity within the **Reread Activity Window** (default 90 days). This prevents an incomplete local library of a series you finished elsewhere from being mistaken for a reread.
- **Progress number during a reread:** the plugin receives a single book count from Codex. If you **reset the series to unread in Codex** before rereading, the `REPEATING` progress climbs accurately from 0. If you just reopen the first book (Codex keeps the rest completed), the status is correctly `REPEATING` but the number may sit near the full count. The status is the part that matters most.

## Recommended sync mode

Use **Push Only** (Settings → Integrations → Settings). Codex is the source of truth here, and Push Only avoids the additive *pull* re-marking books read (which would fight a reread reset) and keeps your notes marker untouched.

## Plugin settings

| Setting | Default | Description |
|---|---|---|
| Default Progress Unit | `volumes` | Unit used for all series (and the fallback when a `[unit:*]` marker is absent) |
| Per-Series Unit From Notes | `off` | Opt-in: honor `[unit:*]` markers in notes (and stop syncing notes both ways) |
| Detect Rereads | `off` | Opt-in: enable AniList `REPEATING` handling |
| Reread Activity Window (days) | `90` | Only treat COMPLETED-on-AniList series as rereads with activity inside this window |
| Auto-Pause After Days | `0` (off) | Set in-progress series to Paused after inactivity |
| Auto-Drop After Days | `0` (off) | Set in-progress series to Dropped after inactivity |
| Search Fallback | `off` | Match by title when a series has no AniList ID |
| Private Mode | `on` | Mark synced entries private on AniList |
| Hide from Status Lists | `off` | Hide synced entries from standard AniList status lists |

Everything else (highest-progress-wins push, scores/dates, auto-pause/drop, OAuth) behaves like the upstream plugin.

## How it works

The Codex server hands the plugin a `SyncEntry` per series: `externalId`, `status`, a single `progress` count, score, dates, `notes`, `latestUpdatedAt`, `title`. It does **not** include the library/collection, and the status enum has no `REPEATING`. There's also no host callback to look those up. So:

- **Unit** is carried in the one free-form per-series field that reaches the plugin — `notes` — via the `[unit:*]` marker.
- **Reread** is detected by comparing Codex's status against the series' **current AniList status** (which the plugin already fetches during push), gated by recent activity.

## Development

```bash
npm install
npm run check   # biome + tsc --noEmit
npm test        # vitest
npm run build   # esbuild bundle -> dist/index.js
```

To run a local build in Codex, point the plugin **Command** at `node` and **Arguments** at the absolute path to `dist/index.js`.

## Releasing

No npm registry is used. CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, and build on every push/PR. Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds, runs `npm pack`, and creates a **GitHub Release** with the installable `…-<version>.tgz` attached (uses the built-in `GITHUB_TOKEN` — no secrets required). Cutting a release is just:

```bash
npm version patch    # or minor/major — creates the commit + tag
git push --follow-tags
```

Then point Codex at that release's tarball URL (`…/releases/download/vX.Y.Z/h-wb-sync-anilist-X.Y.Z.tgz`).

## License

MIT. Derived from the Codex `sync-anilist` plugin (© AshDev); see [LICENSE](./LICENSE).
