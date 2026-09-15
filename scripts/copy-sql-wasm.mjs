import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serves SQLite's WebAssembly from the app, for the Anki deck importer.
 *
 * Both builds are copied because which one loads depends on the bundler:
 * sql.js's package exports `sql-wasm-browser.js` to browsers, and that loader
 * asks for `sql-wasm-browser.wasm`, while Node and some bundlers take
 * `sql-wasm.js`, which asks for `sql-wasm.wasm`. Copying only the second left
 * the browser fetching a 404 page as WebAssembly, and no deck could be read.
 */
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["sql-wasm-browser.wasm", "sql-wasm.wasm"];

try {
  for (const file of files) {
    const source = path.join(rootDir, "node_modules", "sql.js", "dist", file);
    if (!fs.existsSync(source)) {
      console.warn(`Warning: ${file} not found in node_modules/sql.js/dist/`);
      continue;
    }
    fs.copyFileSync(source, path.join(rootDir, "public", file));
    console.log(`Copied ${file} to public/.`);
  }
} catch (error) {
  console.error("Error copying sql.js WebAssembly:", error);
  process.exit(1);
}
