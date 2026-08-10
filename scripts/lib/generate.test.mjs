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
  assert.match(
    all.release.html_url,
    /Toribash67\/Cataclysm-DDA\/commit\/deadbeef/,
  );
});
