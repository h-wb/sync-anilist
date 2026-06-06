# @h-wb/sync-anilist

A [Codex](https://github.com/AshDevFr/codex) plugin that syncs manga reading progress to [AniList](https://anilist.co) — a fork of Codex's built-in `sync-anilist` plugin that adds **reread detection**: when a series is `COMPLETED` on AniList but you start reading it again in Codex, it's pushed as **Rereading (`REPEATING`)**, and set back to `COMPLETED` (with the repeat count bumped) when you finish.

The Codex-facing plugin name is still `sync-anilist`, so it drops into Codex exactly like the original.

> Why a fork instead of config? The Codex plugin protocol has no `REPEATING` status, so reread is reconstructed plugin-side from AniList's own current status. See [How it works](#how-it-works). Everything else mirrors upstream.

> **Volumes vs chapters per library?** You no longer need this fork for that. Since Codex [v1.35](https://github.com/AshDevFr/codex/pull/31) a sync plugin can be **scoped to a library** and **installed multiple times** — register one instance scoped to your Manga library with `progressUnit: volumes` and another scoped to Comics with `progressUnit: chapters`. (Earlier versions of this fork used a `[unit:*]` notes marker to fake per-library routing; that hack is gone.)

## Install in Codex

1. Codex → **Settings → Plugins → Add Plugin**
2. Fill in:
   - **Name**: `sync-anilist`
   - **Display Name**: `AniList Sync`
   - **Command**: `npx`
   - **Arguments**: `-y https://github.com/h-wb/sync-anilist/releases/download/v1.3.0/h-wb-sync-anilist-1.3.0.tgz`  *(bump the version in the URL to upgrade)*
3. **Save**, then **Test Connection**.

> Installed from a prebuilt tarball attached to a GitHub Release — **no npm account, no registry, and no `git` on the host** (`npx github:…` needs git, which many container images lack). The tarball is self-contained (the SDK is bundled in); the host just needs Node 22+. The URL is versioned — change the version to upgrade.
4. Connect your AniList account in **Settings → Integrations** (OAuth or a personal access token — see the [AniList developer settings](https://anilist.co/settings/developer)).

## Volumes vs chapters (per library)

Each Codex book is one "unit", mapped to AniList **volumes** (`progressVolumes`) or **chapters** (`progress`) via the **Progress Unit** setting (default `volumes`). To use a different unit per library, install the plugin once per library and scope each instance:

1. Install the plugin and set **Progress Unit** to your default (e.g. `volumes`), then scope it to one library (e.g. Manga).
2. Use **Add another** on the installed plugin to create a second instance with a non-colliding name, set its **Progress Unit** to `chapters`, and scope it to the other library (e.g. Comics).

Each instance only ever receives the series in its own library, so the units never collide. Keep the library scopes **disjoint** — two instances covering the same library would both push the shared series (last write wins).

### Edition mismatch on completion

Local editions (omnibus, *perfect*, *kanzenban*) often bundle the work into fewer "books" than AniList's canonical count — e.g. *Nausicaä* perfect edition is 2 volumes locally but 7 on AniList. When you finish such a series, pushing the local count would leave it showing **Completed, 2/7**.

So when a series is marked **completed** in Codex *and* its AniList media is **finished publishing**, the plugin fills the progress to AniList's **canonical total** (7/7) instead of the local count. Guards: only on completion, only for finished-publishing media, and only when AniList actually reports a total for the unit (many manga have no chapter count — then the number is left as-is, but the status is still `COMPLETED`). On the *first* push of a brand-new series it isn't on your AniList list yet so the total is unknown; it settles to the full count on the next sync. This needs no setting — it's always on.

### Proportional progress while reading (`scaleProgress`)

The completed-fill above only kicks in at 100%. To also show meaningful **in-progress** numbers for those bundled editions, turn on **Scale Progress to AniList Total** (opt-in, off by default). It maps your local progress proportionally onto AniList's total:

```
anilistProgress = round(localRead / codexTotal × canonicalTotal)
```

For the *Nausicaä* perfect edition (2 local volumes → 7 on AniList), reading **1 of 2** pushes **~4/7**, and **2 of 2** pushes **7/7** (i.e. the completed-fill is just the 100% case). This is accurate, not a guess — a perfect-edition volume really does contain several canonical volumes.

Requirements & notes:
- Set the series' Codex **volume/chapter total to match your local edition** (e.g. 2 for the perfect edition) and **lock** that metadata field — that's what `codexTotal` reads from. A metadata rescan can otherwise revert it.
- **No-op when the totals already match** (you own every volume), so it only affects bundled editions.
- Needs AniList to report a total for the unit; otherwise it falls back to the raw local count.
- It does **not** fix a partial library that starts mid-series (e.g. *One Piece* from chapter 950): the proportional model assumes you start from the beginning. That case needs Codex to send the actual chapter number, which it currently doesn't.

### Log each volume on AniList (`stepProgress`)

By default the plugin pushes the target progress in a single update — so a jump from 0 to 4 shows once as "read volume 4". Turn on **Post Each Volume Separately** (opt-in, off by default) to instead push **one update per unit** — `1`, `2`, `3`, `4` — from your current AniList progress up to the target, so AniList's progress history logs each volume.

Pairs naturally with scaling (the target is the scaled value), and it's idempotent: it only steps the *new* delta each sync (current `4` → later target `7` posts `5, 6, 7`).

Trade-offs:
- **One API call per unit.** A large gap is **capped** (above ~50 it falls back to a single jump) to protect AniList's rate limit, especially on a first-time backfill.
- **AniList may coalesce** rapid updates into a single "read 1 – N" feed activity rather than N separate items — so the discrete history isn't guaranteed. Worth trying on one series to see how your feed renders it.

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

Use **Push Only** (Settings → Integrations → Settings). Codex is the source of truth here, and Push Only avoids the additive *pull* re-marking books read (which would fight a reread reset).

## Plugin settings

| Setting | Default | Description |
|---|---|---|
| Progress Unit | `volumes` | Unit each Codex book maps to on AniList (`volumes` or `chapters`); scope per library by installing per-library instances |
| Scale Progress to AniList Total | `off` | Opt-in: map local progress proportionally onto AniList's total (for omnibus/perfect editions) |
| Post Each Volume Separately | `off` | Opt-in: push one update per unit so AniList logs each volume/chapter (instead of a single jump) |
| Detect Rereads | `off` | Opt-in: enable AniList `REPEATING` handling |
| Reread Activity Window (days) | `90` | Only treat COMPLETED-on-AniList series as rereads with activity inside this window |
| Auto-Pause After Days | `0` (off) | Set in-progress series to Paused after inactivity |
| Auto-Drop After Days | `0` (off) | Set in-progress series to Dropped after inactivity |
| Search Fallback | `off` | Match by title when a series has no AniList ID |
| Private Mode | `on` | Mark synced entries private on AniList |
| Hide from Status Lists | `off` | Hide synced entries from standard AniList status lists |

Everything else (highest-progress-wins push, scores/dates, auto-pause/drop, OAuth) behaves like the upstream plugin.

## How it works

The Codex server hands the plugin a `SyncEntry` per series: `externalId`, `status`, a single `progress` count, score, dates, `notes`, `latestUpdatedAt`, `title`. The status enum has no `REPEATING`, and there's no host callback to look one up. So **reread** is detected by comparing Codex's status against the series' **current AniList status** (which the plugin already fetches during push), gated by recent activity.

Per-library units are handled entirely by Codex's native library scoping (one plugin instance per library, each with its own `progressUnit`) — no plugin-side trickery.

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
