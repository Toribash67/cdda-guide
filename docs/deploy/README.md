# Deploying the CDDA Guide (fork)

The guide is a static SPA served by nginx. Game data (`all.json`, `builds.json`)
is generated in CI from `Toribash67/Cataclysm-DDA@master` and baked into the
image `ghcr.io/toribash67/cdda-guide-web`. Watchtower + dockge redeploy it.

## Auto-update on game changes

`Toribash67/Cataclysm-DDA/.github/workflows/notify-guide.yml` sends a
`repository_dispatch` (`game-updated`) to this repo on every push to `master`,
which runs `.github/workflows/deploy.yml` (regenerate data → build → push image).

### Required secret (user action)

Create a **fine-grained PAT** scoped to repository `Toribash67/cdda-guide`:
- **Contents: write** (the "Create a repository dispatch event" endpoint requires it)
- **Metadata: read** (mandatory on all fine-grained PATs)

(Classic-token equivalent: `repo` scope.)

Add it to the **game** repo (`Toribash67/Cataclysm-DDA`) as a secret named
`GUIDE_DISPATCH_TOKEN` (Settings → Secrets and variables → Actions).

## Applying the game-repo trigger

This repo cannot commit directly into `Toribash67/Cataclysm-DDA`, so the
workflow that triggers the dispatch is checked in here as a ready-to-apply
artifact instead. To wire it up:

1. Copy [`docs/deploy/notify-guide.yml`](./notify-guide.yml) to
   `Toribash67/Cataclysm-DDA/.github/workflows/notify-guide.yml`.
2. Commit and push it to the game repo (on `master`, or via a PR merged to
   `master`).
3. In the game repo, add the `GUIDE_DISPATCH_TOKEN` secret described above
   (Settings → Secrets and variables → Actions).

Once both are in place, every push to `master` in the game repo will trigger
a guide rebuild.

## GHCR image visibility

After the first successful push, make the `cdda-guide-web` package **public**
(GHCR package settings) so the host can pull without auth — matching the other
services. Alternatively, `docker login ghcr.io` on the host.

## Local data regeneration (manual)

```bash
node scripts/generate-data.mjs ../Cataclysm-DDA && node scripts/validate-data.mjs
```

## Rollback

Deploy a previous image by tag: `ghcr.io/toribash67/cdda-guide-web:<git-sha>`.
