import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(projectRoot, "node_modules", "vinext", "package.json");
const cachePath = path.join(
  projectRoot,
  "node_modules",
  "vinext",
  "dist",
  "server",
  "static-file-cache.js",
);

if (!fs.existsSync(packagePath) || !fs.existsSync(cachePath)) {
  throw new Error("vinext static cache implementation was not installed");
}

const vinextPackage = JSON.parse(fs.readFileSync(packagePath, "utf8"));
if (vinextPackage.version !== "0.0.50") {
  throw new Error(
    `Unsupported vinext version ${vinextPackage.version}; review the Windows static-cache patch`,
  );
}

const original = "relativePath: path.relative(base, batch[j]),";
const replacement =
  'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';
const source = fs.readFileSync(cachePath, "utf8");

if (source.includes(replacement)) {
  console.log("vinext static cache path normalization is already installed");
} else if (source.includes(original)) {
  fs.writeFileSync(cachePath, source.replace(original, replacement), "utf8");
  console.log("patched vinext static cache path normalization");
} else {
  throw new Error("vinext static cache implementation changed; refusing an unsafe patch");
}
