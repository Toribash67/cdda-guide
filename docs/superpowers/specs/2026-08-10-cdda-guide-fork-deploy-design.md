# Design: self-hosted CDDA Guide tied to the modified game

Date: 2026-08-10

## Goal

Turn this fork of the Hitchhiker's Guide to the Cataclysm into a guide for **our
modified game** (`Toribash67/Cataclysm-DDA`, checked out at `../Cataclysm-DDA`),
and host it on this machine via **dockge**, following the same pattern as the
existing `sengoku-jidai-web` service (GHCR image + watchtower + dockge stack).

The guide must **auto-update when the game changes**.

## Background: how the guide gets its data today

The guide is a pure client-side Svelte SPA. At runtime it fetches, from hardcoded
URLs on `nornagon/cdda-data`:

- `builds.json` — the list of available versions (used by the version selector).
- `data/<version>/all.json` — every JSON object from the game, each tagged with a
  `__filename` (`<relpath>#L<start>-L<end>`), wrapped as
  `{ build_number, release, data: [...], mods: {...} }`.
- `data/<version>/lang/<locale>.json` — optional translations.

All copy-from / inheritance / migration / abstract resolution happens
**client-side** in `CddaData` (`src/data.ts`). So `all.json` is essentially a raw
concatenation of the game's JSON objects plus build metadata — no compiled game
binary is needed to produce it.

Upstream `cdda-data` regenerates these every 12h by walking a GitHub *release*
zipball's `data/json/**` and `data/mods/**` (`pull-data.mjs` on its `action`
branch).

The three fetch sites in this repo:

- `src/App.svelte` — `builds.json`.
- `src/data.ts` `fetchJson` — `data/<version>/all.json`.
- `src/data.ts` `fetchLocaleJson` — `data/<version>/lang/<locale>.json`.

Tileset previews and (where present) "view source" links point at
`CleverRaven/Cataclysm-DDA/<version>/...`.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Where data generation runs | **In CI, baked into the image** |
| Version selector | **Only the modified game** (single dataset) |
| Auto-update trigger | **On push to the game repo** (`repository_dispatch`) |
| Translations | **English-only** (no lang JSONs) |
| Image / stack name | `ghcr.io/toribash67/cdda-guide-web` |
| Host port | `18082` |
| Cross-repo dispatch token | PAT-based; **user creates the PAT**, spec documents the scope |

## Architecture

```
push to Toribash67/Cataclysm-DDA@master
        │  (workflow in the game repo)
        ▼
repository_dispatch: game-updated  ──►  cdda-guide CI
                                          │ 1. checkout guide + game@master
                                          │ 2. node scripts/generate-data.mjs ../Cataclysm-DDA
                                          │    → public/data/latest/all.json, public/builds.json
                                          │ 3. yarn install && yarn build  (Docker)
                                          │ 4. push ghcr.io/toribash67/cdda-guide-web:{latest,sha}
                                          ▼
                                   watchtower on host  ──►  dockge stack redeploys
                                          ▼
                          users' service worker (NetworkFirst) pulls fresh all.json
```

## Components

### 1. Data generator — `scripts/generate-data.mjs` (new)

Node ESM script, run in CI (and locally for testing). Reuses upstream
`cdda-data/pull-data.mjs` parsing logic so output semantics match exactly.

- **Input:** path to a CDDA checkout (default `../Cataclysm-DDA`).
- **Walk:** `data/json/**/*.json` (base game) and, for each mod under `data/mods/`,
  its `modinfo.json` plus `**/*.json` content.
- **Object splitting + line tracking:** each file's top-level array is broken into
  individual objects while tracking newline positions, so every object gets
  `__filename = <relpath-in-game-repo>#L<start>-L<end>`.
- **Build metadata:** synthesize `build_number` = `toribash-<git-short-sha>` and a
  minimal `release` object (name, `published_at`/date, html_url pointing at the
  game repo commit) from `git` in the checkout — we build from a checkout, not a
  GitHub release.
- **Output (into `public/`, git-ignored):**
  - `public/data/latest/all.json` = `{ build_number, release, data, mods }`.
  - `public/builds.json` = single-entry list, e.g.
    `[{ build_number, prerelease: false, created_at, langs: [] }]`.
- **English-only:** no `lang/` output.
- **Error handling:** malformed JSON fails loudly naming the file (never silently
  dropped); a missing/invalid game path is a clear fatal error.

Naming the folder `latest` means the app's default `version = "latest"` resolves
without any version-selection logic changes.

### 2. Repoint the app at same-origin data (`src/`, small change)

- Introduce a single data base — default same-origin `import.meta.env.BASE_URL` —
  and replace the three `raw.githubusercontent.com/nornagon/cdda-data/main/...`
  URLs with `${BASE_URL}builds.json` and `${BASE_URL}data/<version>/all.json`.
  (`fetchLocaleJson` stays but is never called for English-only; default locale is
  `null`.)
- **PWA:** add one `runtimeCaching` rule (NetworkFirst) matching the same-origin
  `.../data/latest/all.json`, so offline mode keeps working. The existing
  `globPatterns` (`js,css,html,png`) already exclude JSON, so `all.json` is **not**
  precached — this sidesteps the workbox precache size limit. `all.json` /
  `builds.json` / `index.html` are served `no-cache`; hashed assets `immutable`.
- **Optional (fold in, low-stakes):** repoint tileset-preview and any "view source"
  base URLs from `CleverRaven/Cataclysm-DDA` to `Toribash67/Cataclysm-DDA` so tile
  previews and source links reference the fork. Tilesets are opt-in (off by
  default), so this is a nice-to-have, not a blocker.

### 3. Container image — `Dockerfile` (new)

- **Build stage** (`node:22-alpine`): `yarn install --frozen-lockfile` then
  `yarn build`. The generator has already populated `public/data` + `public/builds.json`
  in the CI step, so they are part of the Docker build context and copied by Vite
  into `dist/`.
- **Runtime stage** (`nginx:alpine`): serve `dist/` with SPA fallback
  (`try_files $uri /index.html;`) and cache headers as above. `EXPOSE 80`.

Rationale for generating in CI rather than inside the Dockerfile: keeps the huge
game checkout out of the Docker build, and mirrors the sengoku "CI builds, Docker
packages" split.

### 4. CI/CD

**cdda-guide** — `.github/workflows/deploy.yml` (new), triggered by:
`push` to `main`, `workflow_dispatch`, and `repository_dispatch`
(`types: [game-updated]`).

Steps: checkout guide → checkout `Toribash67/Cataclysm-DDA@master` into a sibling
path → `node scripts/generate-data.mjs <gamepath>` → validate output (see Testing)
→ `docker/build-push-action` building + pushing
`ghcr.io/toribash67/cdda-guide-web:{latest,<sha>}` (push only on `main` /
dispatch, like sengoku). Keep lint/format/test jobs analogous to the existing
sengoku workflow where cheap.

**Toribash67/Cataclysm-DDA** — small workflow (documented here, applied to the game
repo) on `push` to `master` that sends a `repository_dispatch` (`game-updated`) to
`Toribash67/cdda-guide` using a PAT stored as a secret.

**PAT the user creates:** a token authorized to send a repository_dispatch to
`Toribash67/cdda-guide`. The "Create a repository dispatch event" REST endpoint
requires **Contents: write**. Fine-grained: repository `Toribash67/cdda-guide`,
**Contents: write** + **Metadata: read** (Metadata is mandatory on all
fine-grained PATs). Classic equivalent: `repo` scope. Stored in the **game** repo
as secret `GUIDE_DISPATCH_TOKEN`. The spec documents this; the user provisions it.

### 5. Deployment (dockge)

- `deploy/dockge/compose.yml` committed in the repo (like sengoku), and the live
  copy placed at `/mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide/compose.yaml`.
- Service `cdda-guide-web`: image `ghcr.io/toribash67/cdda-guide-web:latest`,
  `restart: unless-stopped`, watchtower label
  `com.centurylinklabs.watchtower.enable: "true"`, `ports: ["18082:80"]`,
  healthcheck `wget -qO- http://127.0.0.1/` . **No volume** (data baked into image).
- Optional: add an nginx-proxy-manager host to give it a hostname (user-driven).

## Data flow / freshness

Because `all.json` is regenerated per game commit and the folder is always
`latest`, the client always requests the same URL; freshness comes from the new
image + the NetworkFirst service-worker rule. The `build_number` changes each
build, which the guide surfaces as the version label.

## Testing

- **Keep** the guide's existing `yarn test` (it fetches upstream fixtures via
  `fetch-fixtures.js` to render-test components; still valid for the UI code).
- **Add** a generator validation (run in CI before building): execute
  `generate-data.mjs` against `../Cataclysm-DDA` and assert:
  - `build_number` is a non-empty string;
  - `data` is a non-empty array and **every** element has a `__filename`;
  - `mods` is a populated object;
  - `new CddaData(all.data, all.build_number, all.release)` constructs without
    throwing, and a couple of known ids (e.g. an item and a monster) resolve.

## Edge cases

- Malformed game JSON → fail the build, naming the file.
- Large `all.json` → excluded from precache; NetworkFirst at runtime; `no-cache`
  from nginx.
- First hard-load of a deep route → nginx `try_files` fallback to `index.html`
  (SW `navigateFallback` covers subsequent client navigation).
- Game repo has many bundled mods → all included in `all.json`; the guide's
  existing mod handling covers filtering.

## Out of scope

- Translations of custom content.
- Keeping upstream nornagon versions selectable.
- Any change to the game itself.

## Open items (defaults chosen; changeable at deploy time)

- Exact `build_number` format (`toribash-<sha>` assumed).
- Whether to also proxy the service through nginx-proxy-manager for a hostname.
