# CDDA Guide Fork + Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this fork of the Hitchhiker's Guide to the Cataclysm into a guide for our modified game (`Toribash67/Cataclysm-DDA`) and host it via dockge, auto-rebuilding when the game changes.

**Architecture:** A Node data-generator walks the modified game's `data/json/**` and emits a same-origin `all.json` + `builds.json` into `public/`. The app is repointed from `nornagon/cdda-data` to those same-origin files. CI regenerates the data from the game repo (triggered by a `repository_dispatch` the game repo sends on push), builds a static nginx image, and pushes it to GHCR, where watchtower + dockge redeploy it.

**Tech Stack:** Node 22 (ESM, `node:test`), Yarn 1.22, TypeScript + Svelte 5 (Vite 8, vite-plugin-pwa), Docker (nginx), GitHub Actions, dockge.

## Global Constraints

- Node **22.x**; package manager **yarn@1.22.22**, always `yarn install --frozen-lockfile`.
- The guide does **all** copy-from / migration / abstract resolution client-side in `CddaData` (`src/data.ts`); `all.json` is raw concatenated game JSON objects, each carrying a `__filename`.
- Our modified CDDA is a **complete alternate binary** — an alternate version of the base game, NOT a classic-CDDA mod. Its changes live in the fork's `data/json/**`, so that directory *is* the base game we generate from.
- `CddaData` only consumes the top-level `data` array. The guide does **not** read a `mods` field. **Generate `data` from base-game `data/json/**` only** (`data/mods/**` — the classic optional-mod tree — is excluded: it's unrelated to our fork's changes, and dumping it in would cause ID collisions).
- `build_number` is used as a **git ref** for tileset and "view source" links, so it MUST be the game's full commit SHA. Those links are repointed to `Toribash67/Cataclysm-DDA`.
- Data folder is named `latest` so the app's default `version = "latest"` resolves to `data/latest/all.json` with no version-selector changes.
- English-only: no `lang/<locale>.json` generation.
- Image: `ghcr.io/toribash67/cdda-guide-web`. Host port: **18082** (verified free).
- New `.mjs` follow Prettier defaults (double quotes, semicolons, 2-space, trailing commas). Run `yarn lint:fix` before committing touched files; the husky pre-commit runs `prettier -w` + `svelte-check` + `tsc --noEmit`.
- Generated files (`public/data/`, `public/builds.json`) are git-ignored — never committed; produced fresh in CI.

---

### Task 1: Top-level JSON element splitter

Pure function that, given the raw text of a CDDA JSON file, returns the 1-indexed inclusive line range of each top-level element. Used to build `__filename = <relpath>#L<start>-L<end>`.

**Files:**
- Create: `scripts/lib/split-json.mjs`
- Test: `scripts/lib/split-json.test.mjs`

**Interfaces:**
- Produces: `export function topLevelElementRanges(text: string): { startLine: number; endLine: number }[]` — one entry per top-level array element (or one entry if the file is a single top-level object), in source order.

- [ ] **Step 1: Write the failing test**

`scripts/lib/split-json.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { topLevelElementRanges } from "./split-json.mjs";

test("array of objects on separate lines", () => {
  const text = '[\n  {"a":1},\n  {"b":2}\n]';
  assert.deepEqual(topLevelElementRanges(text), [
    { startLine: 2, endLine: 2 },
    { startLine: 3, endLine: 3 },
  ]);
});

test("multi-line object element", () => {
  const text = '[\n{\n"a":1\n},\n{"b":2}\n]';
  assert.deepEqual(topLevelElementRanges(text), [
    { startLine: 2, endLine: 4 },
    { startLine: 5, endLine: 5 },
  ]);
});

test("single top-level object", () => {
  const text = '{\n"x":1\n}';
  assert.deepEqual(topLevelElementRanges(text), [{ startLine: 1, endLine: 3 }]);
});

test("nested brackets and braces do not create elements", () => {
  const text = '[{"a":[1,2],"b":{"c":3}}]';
  assert.deepEqual(topLevelElementRanges(text), [{ startLine: 1, endLine: 1 }]);
});

test("braces inside strings are ignored", () => {
  const text = '[\n{"a":"}{"},\n{"b":"]["}\n]';
  assert.deepEqual(topLevelElementRanges(text), [
    { startLine: 2, endLine: 2 },
    { startLine: 3, endLine: 3 },
  ]);
});

test("leading BOM is tolerated", () => {
  const text = '\uFEFF[\n{"a":1}\n]';
  assert.deepEqual(topLevelElementRanges(text), [{ startLine: 2, endLine: 2 }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/lib/split-json.test.mjs`
Expected: FAIL — cannot find module `./split-json.mjs` (or export missing).

- [ ] **Step 3: Write the implementation**

`scripts/lib/split-json.mjs`:

```js
// Returns the 1-indexed inclusive line range of each top-level element in a
// CDDA JSON file (an array of objects, or a single object). CDDA data files are
// standard JSON — "//" comment keys are ordinary strings, so no comment
// stripping is needed. Brace/bracket counting drives element boundaries;
// characters inside strings are skipped.
export function topLevelElementRanges(text) {
  const offsets = []; // [startOffset, endOffset] per top-level element
  let depth = 0;
  let started = false;
  let outerIsObject = false;
  let inStr = false;
  let esc = false;
  let elemStart = -1;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }

    if (!started) {
      if (c === "[") {
        started = true;
        depth = 1;
      } else if (c === "{") {
        started = true;
        outerIsObject = true;
        depth = 1;
        elemStart = i;
      }
      continue;
    }

    if (outerIsObject) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          offsets.push([elemStart, i]);
          break;
        }
      }
      continue;
    }

    // Array mode.
    if (c === "{" || c === "[") {
      if (depth === 1) elemStart = i;
      depth++;
    } else if (c === "}" || c === "]") {
      depth--;
      if (depth === 1) offsets.push([elemStart, i]);
      else if (depth === 0) break; // closing outer ]
    }
  }

  const newlines = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") newlines.push(i);
  const lineOf = (off) => {
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < off) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };

  return offsets.map(([s, e]) => ({ startLine: lineOf(s), endLine: lineOf(e) }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/lib/split-json.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
yarn lint:fix
git add scripts/lib/split-json.mjs scripts/lib/split-json.test.mjs
git commit -m "Add top-level JSON element splitter for data generation"
```

---

### Task 2: Data generator core (`buildAllJson`)

Walks `data/json/**` in a game checkout, tags each object with `__filename`, and returns the `all.json` payload. Pure function (no git, no file writes) so it is deterministic and testable against a fixture.

**Files:**
- Create: `scripts/lib/generate.mjs`
- Test: `scripts/lib/generate.test.mjs`
- Create (fixture): `scripts/lib/__fixtures__/game/data/json/items.json`, `scripts/lib/__fixtures__/game/data/json/nested/mon.json`

**Interfaces:**
- Consumes: `topLevelElementRanges` from Task 1.
- Produces: `export async function buildAllJson(gameDir: string, opts: { buildNumber: string; createdAt?: string; commitSubject?: string }): Promise<{ build_number: string; release: object; data: any[] }>` — `data` contains every object from `<gameDir>/data/json/**/*.json`, each with `__filename` set to `data/json/...#L<start>-L<end>` (path relative to `gameDir`, forward slashes). Primitive/array top-level elements are skipped.

- [ ] **Step 1: Create the fixture files**

`scripts/lib/__fixtures__/game/data/json/items.json`:

```json
[
  { "type": "GENERIC", "id": "widget", "name": "widget" },
  { "type": "GENERIC", "id": "gadget", "name": "gadget" }
]
```

`scripts/lib/__fixtures__/game/data/json/nested/mon.json`:

```json
[{ "type": "MONSTER", "id": "mon_test", "name": "test monster" }]
```

- [ ] **Step 2: Write the failing test**

`scripts/lib/generate.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAllJson } from "./generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, "__fixtures__", "game");

test("builds all.json payload from data/json", async () => {
  const all = await buildAllJson(gameDir, {
    buildNumber: "deadbeef",
    createdAt: "2026-08-10T00:00:00Z",
    commitSubject: "test build",
  });

  assert.equal(all.build_number, "deadbeef");
  assert.equal(all.data.length, 3);

  const widget = all.data.find((o) => o.id === "widget");
  assert.equal(widget.__filename, "data/json/items.json#L2-L2");

  const mon = all.data.find((o) => o.id === "mon_test");
  assert.equal(mon.__filename, "data/json/nested/mon.json#L1-L1");

  assert.equal(all.release.tag_name, "deadbeef");
  assert.match(all.release.html_url, /Toribash67\/Cataclysm-DDA\/commit\/deadbeef/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test scripts/lib/generate.test.mjs`
Expected: FAIL — cannot find `./generate.mjs`.

- [ ] **Step 4: Write the implementation**

`scripts/lib/generate.mjs`:

```js
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { topLevelElementRanges } from "./split-json.mjs";

export async function buildAllJson(gameDir, opts) {
  const { buildNumber, createdAt, commitSubject } = opts;
  const jsonRoot = join(gameDir, "data", "json");

  const dirents = await readdir(jsonRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const files = dirents
    .filter((d) => d.isFile() && d.name.endsWith(".json"))
    .map((d) => join(d.parentPath ?? d.path, d.name))
    .sort();

  const data = [];
  for (const file of files) {
    let text = (await readFile(file, "utf8")).replace(/^\uFEFF/, "");
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Failed to parse ${file}: ${e.message}`);
    }
    const elements = Array.isArray(parsed) ? parsed : [parsed];
    const ranges = topLevelElementRanges(text);
    if (ranges.length !== elements.length) {
      throw new Error(
        `Line-range count ${ranges.length} != element count ${elements.length} in ${file}`,
      );
    }
    const rel = relative(gameDir, file).split(sep).join("/");
    for (let i = 0; i < elements.length; i++) {
      const obj = elements[i];
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) continue;
      obj.__filename = `${rel}#L${ranges[i].startLine}-L${ranges[i].endLine}`;
      data.push(obj);
    }
  }

  const release = {
    tag_name: buildNumber,
    name: commitSubject ?? buildNumber,
    html_url: `https://github.com/Toribash67/Cataclysm-DDA/commit/${buildNumber}`,
    published_at: createdAt ?? null,
  };

  return { build_number: buildNumber, release, data };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test scripts/lib/generate.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
yarn lint:fix
git add scripts/lib/generate.mjs scripts/lib/generate.test.mjs scripts/lib/__fixtures__
git commit -m "Add data generator core that builds all.json from data/json"
```

---

### Task 3: Generator CLI, validator, and gitignore

CLI that resolves the game dir, derives `build_number` (commit SHA) via git, writes `public/data/latest/all.json` + `public/builds.json`. Plus a dependency-free validator run in CI.

**Files:**
- Create: `scripts/generate-data.mjs`
- Create: `scripts/validate-data.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `buildAllJson` from Task 2.
- Produces (on disk): `public/data/latest/all.json` = `{ build_number, release, data }`; `public/builds.json` = `[{ build_number, prerelease: false, created_at, langs: [] }]`.
- CLI: `node scripts/generate-data.mjs [gameDir]` (default `../Cataclysm-DDA`). Honors env overrides `CDDA_BUILD_NUMBER`, `CDDA_BUILD_DATE`.

- [ ] **Step 1: Add generated paths to `.gitignore`**

Append to `.gitignore`:

```
/public/data/
/public/builds.json
```

- [ ] **Step 2: Write the CLI**

`scripts/generate-data.mjs`:

```js
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllJson } from "./lib/generate.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gameDir = resolve(process.argv[2] ?? join(repoRoot, "..", "Cataclysm-DDA"));

const git = (args) =>
  execFileSync("git", ["-C", gameDir, ...args], { encoding: "utf8" }).trim();

let buildNumber = process.env.CDDA_BUILD_NUMBER;
let createdAt = process.env.CDDA_BUILD_DATE;
let commitSubject;
try {
  buildNumber = buildNumber || git(["rev-parse", "HEAD"]);
  createdAt = createdAt || git(["show", "-s", "--format=%cI", "HEAD"]);
  commitSubject = git(["show", "-s", "--format=%s", "HEAD"]);
} catch (e) {
  if (!buildNumber)
    throw new Error(
      `Could not determine build number via git in ${gameDir}: ${e.message}`,
    );
}

const all = await buildAllJson(gameDir, { buildNumber, createdAt, commitSubject });

const outDir = join(repoRoot, "public", "data", "latest");
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "all.json"), JSON.stringify(all));

const builds = [
  { build_number: buildNumber, prerelease: false, created_at: createdAt, langs: [] },
];
await writeFile(join(repoRoot, "public", "builds.json"), JSON.stringify(builds));

console.log(`Wrote ${all.data.length} objects for build ${buildNumber}`);
```

- [ ] **Step 3: Write the validator**

`scripts/validate-data.mjs`:

```js
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const all = JSON.parse(
  await readFile(join(repoRoot, "public", "data", "latest", "all.json"), "utf8"),
);
const builds = JSON.parse(
  await readFile(join(repoRoot, "public", "builds.json"), "utf8"),
);

const fail = (msg) => {
  console.error(`validate-data: ${msg}`);
  process.exit(1);
};

if (typeof all.build_number !== "string" || all.build_number.length === 0)
  fail("build_number missing");
if (!Array.isArray(all.data) || all.data.length === 0) fail("data empty");
for (const obj of all.data) {
  if (!obj || typeof obj !== "object" || !/#L\d+-L\d+$/.test(obj.__filename ?? ""))
    fail(`object missing valid __filename: ${JSON.stringify(obj).slice(0, 120)}`);
}
if (!Array.isArray(builds) || builds.length !== 1) fail("builds.json malformed");
if (builds[0].build_number !== all.build_number)
  fail("builds.json build_number mismatch");

console.log(`validate-data: OK (${all.data.length} objects, build ${all.build_number})`);
```

- [ ] **Step 4: Verify against the real modified game**

Run:
```bash
node scripts/generate-data.mjs ../Cataclysm-DDA && node scripts/validate-data.mjs
```
Expected: prints `Wrote <N> objects for build <sha>` then `validate-data: OK (...)`. Confirm `public/data/latest/all.json` and `public/builds.json` exist and `git status` does NOT list them (gitignored).

- [ ] **Step 5: Commit**

```bash
yarn lint:fix
git add scripts/generate-data.mjs scripts/validate-data.mjs .gitignore
git commit -m "Add data-generation CLI and validator"
```

---

### Task 4: Repoint the app at our data and the fork

Replace the three `nornagon/cdda-data` fetch URLs with same-origin paths, add a PWA runtime-cache rule for the same-origin data, and repoint tileset/source links from `CleverRaven/Cataclysm-DDA` to `Toribash67/Cataclysm-DDA` (so they resolve at the `build_number` commit SHA).

**Files:**
- Modify: `src/data.ts` (`fetchJson` ~line 2009, `fetchLocaleJson` ~line 2020)
- Modify: `src/App.svelte` (builds fetch ~line 43; tileset URLs ~lines 60-92)
- Modify: `src/JsonView.svelte` (source links ~lines 15-23)
- Modify: `vite.config.ts` (PWA `runtimeCaching`)

**Interfaces:**
- Consumes: `public/data/latest/all.json`, `public/builds.json` produced by Task 3, served at the site root.

- [ ] **Step 1: Repoint `fetchJson` / `fetchLocaleJson` in `src/data.ts`**

Replace the URL in `fetchJson`:

```ts
  return fetchJsonWithProgress(
    `${import.meta.env.BASE_URL}data/${version}/all.json`,
    progress,
  );
```

Replace the URL in `fetchLocaleJson`:

```ts
  return fetchJsonWithProgress(
    `${import.meta.env.BASE_URL}data/${version}/lang/${locale}.json`,
    progress,
  );
```

- [ ] **Step 2: Repoint the builds fetch in `src/App.svelte`**

Replace the `fetch("https://raw.githubusercontent.com/nornagon/cdda-data/main/builds.json")` call's URL with:

```js
fetch(`${import.meta.env.BASE_URL}builds.json`)
```

- [ ] **Step 3: Repoint tileset base URLs in `src/App.svelte`**

In the `tilesets` array, change every `https://raw.githubusercontent.com/CleverRaven/Cataclysm-DDA/{version}/gfx/...` to `https://raw.githubusercontent.com/Toribash67/Cataclysm-DDA/{version}/gfx/...` (owner change only; keep `{version}` and the gfx sub-path). There are 9 entries (Altica, BrownLikeBears, ChibiUltica, Cuteclysm, HollowMoon, MshockXotto%2B, NeoDaysTileset, RetroDaysTileset, UltimateCataclysm).

- [ ] **Step 4: Repoint source links in `src/JsonView.svelte`**

Change both anchor hrefs from `CleverRaven/Cataclysm-DDA` to `Toribash67/Cataclysm-DDA`:

```svelte
    href={`https://github.com/Toribash67/Cataclysm-DDA/blob/${
      buildNumber ?? "master"
    }/${obj.__filename}`}
```
and
```svelte
    href={`https://github.dev/Toribash67/Cataclysm-DDA/blob/${
      buildNumber ?? "master"
    }/${obj.__filename}`}
```

- [ ] **Step 5: Add same-origin PWA runtime caching in `vite.config.ts`**

In `workbox.runtimeCaching`, prepend two entries (before the existing github-raw rules) so same-origin data is cached NetworkFirst:

```ts
          {
            // Our same-origin data. latest/all.json changes per build, so
            // prefer the network but fall back to cache offline.
            urlPattern: ({ url }) => url.pathname.endsWith("/data/latest/all.json"),
            handler: "NetworkFirst",
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/builds.json"),
            handler: "NetworkFirst",
          },
```

(The existing `globPatterns: ["**/*.{js,css,html,png}"]` intentionally excludes `.json`, so `all.json` is not precached and the workbox size limit is not hit.)

- [ ] **Step 6: Verify no upstream data URLs remain and the app builds**

Run:
```bash
grep -rn "nornagon/cdda-data" src/ ; echo "exit=$?"
grep -rn "CleverRaven/Cataclysm-DDA" src/App.svelte src/JsonView.svelte ; echo "exit=$?"
node scripts/generate-data.mjs ../Cataclysm-DDA && yarn build
```
Expected: first grep prints nothing (`exit=1`); second grep prints nothing (`exit=1`); `yarn build` succeeds and `dist/data/latest/all.json` + `dist/builds.json` exist.

- [ ] **Step 7: Commit**

```bash
yarn lint:fix
git add src/data.ts src/App.svelte src/JsonView.svelte vite.config.ts
git commit -m "Serve game data from our own origin and fork"
```

---

### Task 5: Container image (Dockerfile + nginx + dockerignore)

Multi-stage image: build the static site (data already generated into `public/`), serve `dist/` with nginx (SPA fallback + cache headers).

**Files:**
- Create: `Dockerfile`
- Create: `nginx.conf`
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

```
node_modules
.git
game
_test
_rendered
dist
dev-dist
docs
```

(Note: `public/data/` is git-ignored but must NOT be dockerignored — it is needed in the build context. Do not add it here.)

- [ ] **Step 2: Write `nginx.conf`**

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location = /index.html {
    add_header Cache-Control "no-cache";
  }
  location = /builds.json {
    add_header Cache-Control "no-cache";
  }
  location = /data/latest/all.json {
    add_header Cache-Control "no-cache";
  }

  location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

- [ ] **Step 3: Write `Dockerfile`**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
# .git is not in the build context, so skip the husky prepare script
# (yarn runs `husky install` on install, which errors outside a git repo).
ENV HUSKY=0
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 4: Build and smoke-test the image locally**

Run:
```bash
node scripts/generate-data.mjs ../Cataclysm-DDA
docker build -t cdda-guide-web:test .
docker run --rm -d -p 18082:80 --name cdda-guide-test cdda-guide-web:test
sleep 2
curl -sf http://127.0.0.1:18082/ | grep -qi "hitchhiker" && echo "INDEX OK"
curl -sf http://127.0.0.1:18082/data/latest/all.json | head -c 40 && echo && echo "DATA OK"
curl -sf http://127.0.0.1:18082/builds.json && echo "BUILDS OK"
docker rm -f cdda-guide-test
```
Expected: `INDEX OK`, `DATA OK`, `BUILDS OK`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile nginx.conf .dockerignore
git commit -m "Add nginx container image for the guide"
```

---

### Task 6: Guide CI/CD workflow + neutralize upstream deploy

Add a workflow that regenerates data from the game repo and pushes the image; strip the inherited Cloudflare Pages + Transifex steps (they target nornagon's infra and lack our secrets).

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  repository_dispatch:
    types: [game-updated]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout guide
        uses: actions/checkout@v4

      - name: Checkout game
        uses: actions/checkout@v4
        with:
          repository: Toribash67/Cataclysm-DDA
          ref: master
          path: game

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Generate data
        run: node scripts/generate-data.mjs game

      - name: Validate data
        run: node scripts/validate-data.mjs

      - name: Set image name
        run: echo "IMAGE_NAME=ghcr.io/${GITHUB_REPOSITORY_OWNER,,}/cdda-guide-web" >> "$GITHUB_ENV"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: |
            ${{ env.IMAGE_NAME }}:latest
            ${{ env.IMAGE_NAME }}:${{ github.sha }}
```

- [ ] **Step 2: Neutralize the inherited deploy steps in `ci.yml`**

In `.github/workflows/ci.yml`, delete the `Upload Translation Strings` step and the `Deploy 🚀` step (the last two steps). Keep `checkout`, `setup-node`, `Fetch Dependencies`, `Test`, and `Build`.

- [ ] **Step 3: Validate workflow YAML**

Run:
```bash
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in ['.github/workflows/deploy.yml','.github/workflows/ci.yml']]; print('YAML OK')"
```
Expected: `YAML OK`. (Full validation happens on first push; the `build-and-push` job runs and, on `main`, publishes `ghcr.io/toribash67/cdda-guide-web:latest`.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/ci.yml
git commit -m "Add GHCR deploy workflow; drop upstream Cloudflare/Transifex steps"
```

---

### Task 7: Game-repo dispatch trigger + PAT docs

Add a workflow to the **game** repo (checked out at `../Cataclysm-DDA`) that pokes the guide on every push to `master`, and document the PAT the user must create.

**Files:**
- Create (in game repo working tree): `../Cataclysm-DDA/.github/workflows/notify-guide.yml`
- Create (in guide repo): `docs/deploy/README.md`

- [ ] **Step 1: Write the game-repo workflow**

`../Cataclysm-DDA/.github/workflows/notify-guide.yml`:

```yaml
name: Notify Guide

on:
  push:
    branches: [master]

permissions: {}

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger guide rebuild
        run: |
          curl -sSf -X POST \
            -H "Authorization: Bearer ${{ secrets.GUIDE_DISPATCH_TOKEN }}" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/Toribash67/cdda-guide/dispatches \
            -d '{"event_type":"game-updated"}'
```

- [ ] **Step 2: Write the deploy/ops docs**

`docs/deploy/README.md`:

```markdown
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
```

- [ ] **Step 3: Validate the game-repo workflow YAML and commit it in the game repo**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('../Cataclysm-DDA/.github/workflows/notify-guide.yml')); print('YAML OK')"
cd ../Cataclysm-DDA && git add .github/workflows/notify-guide.yml && \
  git commit -m "Notify cdda-guide on push to master" && cd -
```
Expected: `YAML OK`; commit succeeds in the game repo. (The guide-repo docs are committed in the next step.)

- [ ] **Step 4: Commit the docs in the guide repo**

```bash
git add docs/deploy/README.md
git commit -m "Document deploy pipeline and dispatch PAT setup"
```

---

### Task 8: dockge stack

Add the compose file to the repo and install the live copy under the dockge stacks directory.

**Files:**
- Create: `deploy/dockge/compose.yml`
- Create (host, root-owned dir): `/mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide/compose.yaml`

- [ ] **Step 1: Write `deploy/dockge/compose.yml`**

```yaml
services:
  cdda-guide-web:
    image: ghcr.io/toribash67/cdda-guide-web:latest
    container_name: cdda-guide-web
    restart: unless-stopped
    labels:
      com.centurylinklabs.watchtower.enable: "true"
    ports:
      - "18082:80"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1/"]
      interval: 30s
      timeout: 5s
      retries: 3
```

- [ ] **Step 2: Validate compose syntax**

Run:
```bash
docker compose -f deploy/dockge/compose.yml config >/dev/null && echo "COMPOSE OK"
```
Expected: `COMPOSE OK`.

- [ ] **Step 3: Install the live stack copy**

The stacks dir is root-owned, so this needs sudo (or do it via the dockge UI: create a stack named `cdda-guide` and paste the compose). CLI route:
```bash
sudo mkdir -p /mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide
sudo cp deploy/dockge/compose.yml /mnt/.ix-apps/app_mounts/dockge/stacks/cdda-guide/compose.yaml
```
Then in dockge, the `cdda-guide` stack appears — **Deploy** it (only after the image exists in GHCR from Task 6). Verify:
```bash
curl -sf http://127.0.0.1:18082/ | grep -qi "hitchhiker" && echo "LIVE OK"
```
Expected: `LIVE OK`.

- [ ] **Step 4: Commit**

```bash
git add deploy/dockge/compose.yml
git commit -m "Add dockge stack for the guide"
```

---

## Sequencing note

Tasks 1–5 are self-contained and locally testable. Task 6 must land on `main` (and the image must publish) before Task 8's live deploy will succeed. Task 7's PAT is required for the auto-update trigger but not for a first manual/`workflow_dispatch` deploy — the pipeline works without it, just without game-push automation.
