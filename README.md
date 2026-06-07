# codex-plugins

A collection of custom [Codex](https://github.com/AshDevFr/codex) plugins.

| Package | npm name | What it does |
| --- | --- | --- |
| [`packages/sync-anilist`](packages/sync-anilist) | `@h-wb/sync-anilist` | Sync manga reading progress to AniList, with reread (REPEATING) detection and proportional progress scaling. |
| [`packages/metadata-mangabaka`](packages/metadata-mangabaka) | `@h-wb/metadata-mangabaka` | MangaBaka metadata provider with per-edition **Collection** support, so the tracked volume count matches the edition you actually own. |

## Repo layout

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo. Each
package is an independent Codex plugin, published as its own installable tarball, but they
share tooling (Biome, TypeScript, Vitest) and a single lockfile.

```
.
├── package.json          # workspace root (shared devDeps + scripts)
├── tsconfig.base.json    # shared compiler options
├── biome.json            # shared lint/format config
├── vitest.config.ts      # runs every package's tests
└── packages/
    ├── sync-anilist/
    └── metadata-mangabaka/
```

## Development

```bash
npm install            # install all workspaces
npm run check          # biome + tsc across every package
npm test               # vitest across every package
npm run build          # esbuild bundle every package to dist/index.js
```

Per-package scripts work too, e.g. `npm run build -w packages/metadata-mangabaka`.

## Releasing

Releases are per-package and driven by tags of the form `<package>-v<version>`:

```bash
git tag metadata-mangabaka-v1.0.0
git push origin metadata-mangabaka-v1.0.0
```

The [release workflow](.github/workflows/release.yml) lints/typechecks/tests the workspace,
runs `npm pack` for that package, and attaches the installable `.tgz` to a GitHub Release.

## License

MIT
