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

## Deploying via dockge

The compose stack is defined in [`deploy/dockge/compose.yml`](../../deploy/dockge/compose.yml).
It configures a service (`cdda-guide-web`) running the latest image with watchtower auto-update
enabled on port `18082`.

To deploy on the host (after the image has been published to GHCR):

**Option 1: dockge UI**
1. Open dockge and create a new stack named `cdda-guide`.
2. Paste the contents of `deploy/dockge/compose.yml` into the editor.
3. Click **Deploy**.

**Option 2: CLI**
```bash
sudo mkdir -p /mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide
sudo cp deploy/dockge/compose.yml /mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide/compose.yaml
```
Then go to dockge and click **Deploy** on the `cdda-guide` stack.

Once deployed, the guide is reachable on `http://127.0.0.1:18082` (or the host's network address on port `18082`).
Watchtower will automatically redeploy when a new image is pushed to GHCR.

## Local data regeneration (manual)

```bash
node scripts/generate-data.mjs ../Cataclysm-DDA && node scripts/validate-data.mjs
```

## Rollback

Images are tagged with the **game** commit SHA (`build_number` from
`public/builds.json`, the same version shown in the guide's UI), not the
guide repo's SHA — this stays unique across game-only rebuilds. Deploy a
previous image by tag: `ghcr.io/toribash67/cdda-guide-web:<game-commit-sha>`.
