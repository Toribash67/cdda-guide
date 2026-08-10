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

  return offsets.map(([s, e]) => ({
    startLine: lineOf(s),
    endLine: lineOf(e),
  }));
}
