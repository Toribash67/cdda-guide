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
    let text = (await readFile(file, "utf8")).replace(/^﻿/, "");
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
      if (obj === null || typeof obj !== "object" || Array.isArray(obj))
        continue;
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
