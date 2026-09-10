// The schemas, the browser-side probe runtime and the domain notes ship as files rather than as
// strings in code: they are read verbatim so their bytes are a function of the file, not of the
// code path that assembled them. tsc does not copy them, so this does.
/* global process */
import fs from "node:fs";
import path from "node:path";

const SRC = "src";
const OUT = "dist";
const KEEP = /\.(json|md|js)$/;

function copy(dir) {
  for (const entry of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      copy(relative);
    } else if (KEEP.test(entry.name)) {
      fs.mkdirSync(path.join(OUT, dir), { recursive: true });
      fs.copyFileSync(path.join(SRC, relative), path.join(OUT, relative));
      process.stdout.write(`copied ${relative}\n`);
    }
  }
}

copy(".");
