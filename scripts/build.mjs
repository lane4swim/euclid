// Builds the static site into site/: compiles src/ with tsconfig.web.json
// into site/js and copies the files in web/ next to it.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
execFileSync(process.execPath, [tsc, "-p", join(root, "tsconfig.web.json")], { stdio: "inherit" });
cpSync(join(root, "web"), out, { recursive: true });
console.log("Built site/ — open site/index.html through any static server.");
