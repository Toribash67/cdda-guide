import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const all = JSON.parse(
  await readFile(
    join(repoRoot, "public", "data", "latest", "all.json"),
    "utf8",
  ),
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
  if (
    !obj ||
    typeof obj !== "object" ||
    !/#L\d+-L\d+$/.test(obj.__filename ?? "")
  )
    fail(
      `object missing valid __filename: ${JSON.stringify(obj).slice(0, 120)}`,
    );
}
if (!Array.isArray(builds) || builds.length !== 1)
  fail("builds.json malformed");
if (builds[0].build_number !== all.build_number)
  fail("builds.json build_number mismatch");

console.log(
  `validate-data: OK (${all.data.length} objects, build ${all.build_number})`,
);
