import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAllJson } from "./generate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = join(here, "__fixtures__", "game");
const gameDirMalformed = join(here, "__fixtures__", "game-malformed");

test("builds all.json payload from data/json", async () => {
  const all = await buildAllJson(gameDir, {
    buildNumber: "deadbeef",
    createdAt: "2026-08-10T00:00:00Z",
    commitSubject: "test build",
  });

  assert.equal(all.build_number, "deadbeef");
  assert.equal(all.data.length, 5);

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

test("skips non-object top-level elements (primitives, arrays)", async () => {
  const all = await buildAllJson(gameDir, {
    buildNumber: "test",
  });

  const mixed = all.data.filter((o) => o.__filename.includes("mixed.json"));
  assert.equal(
    mixed.length,
    2,
    "should have exactly 2 objects from mixed.json",
  );

  const obj1 = mixed.find((o) => o.id === "obj1");
  assert.ok(obj1, "first object should be present");
  assert.equal(
    obj1.__filename,
    "data/json/mixed.json#L3-L3",
    "obj1 should be at line 3",
  );

  const obj2 = mixed.find((o) => o.id === "obj2");
  assert.ok(obj2, "second object should be present");
  assert.equal(
    obj2.__filename,
    "data/json/mixed.json#L5-L5",
    "obj2 should be at line 5",
  );
});

test("throws on malformed JSON with file path in error", async () => {
  await assert.rejects(
    async () => {
      await buildAllJson(gameDirMalformed, { buildNumber: "test" });
    },
    (err) => {
      assert.match(
        err.message,
        /Failed to parse.*malformed\.json/,
        "error should name the malformed file",
      );
      return true;
    },
  );
});
