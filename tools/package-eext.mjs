import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";

const root = process.cwd();
const extensionArg = process.argv[2] || "./extension";
const outputArg = process.argv[3];
const extensionDir = path.resolve(root, extensionArg);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeZipPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function validateManifest(manifest, manifestPath) {
  const required = ["name", "uuid", "version", "entry", "headerMenus"];
  for (const key of required) {
    if (!manifest[key]) fail(`Missing required extension manifest field ${key} in ${manifestPath}`);
  }
  if (!/^[a-z0-9]{32}$/.test(String(manifest.uuid))) {
    fail(`Invalid JLCEDA extension uuid ${manifest.uuid}; expected 32 lowercase alphanumeric characters.`);
  }
  if (manifest.entry !== "./dist/index") {
    console.warn(`Warning: manifest entry is ${manifest.entry}, expected ./dist/index for current scripts.`);
  }
}

if (!fs.existsSync(extensionDir) || !fs.statSync(extensionDir).isDirectory()) {
  fail(`Extension directory not found: ${extensionDir}`);
}

const manifestPath = path.join(extensionDir, "extension.json");
const indexPath = path.join(extensionDir, "dist", "index.js");
if (!fs.existsSync(manifestPath)) fail(`Missing extension.json: ${manifestPath}`);
if (!fs.existsSync(indexPath)) fail(`Missing dist/index.js: ${indexPath}`);

const manifest = readJson(manifestPath);
validateManifest(manifest, manifestPath);

const outputPath = path.resolve(
  root,
  outputArg || path.join("..", `${manifest.name}_v${manifest.version}.eext`)
);
const outputDir = path.dirname(outputPath);
fs.mkdirSync(outputDir, { recursive: true });

const zip = new JSZip();
const files = listFiles(extensionDir);
for (const fullPath of files) {
  const relative = normalizeZipPath(path.relative(extensionDir, fullPath));
  zip.file(relative, fs.createReadStream(fullPath));
}

const buffer = await zip.generateAsync({
  type: "nodebuffer",
  streamFiles: true,
  compression: "DEFLATE",
  compressionOptions: { level: 9 }
});

fs.writeFileSync(outputPath, buffer);
const sha256 = crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase();
console.log(JSON.stringify({
  package: outputPath,
  version: manifest.version,
  uuid: manifest.uuid,
  files: files.map((file) => normalizeZipPath(path.relative(extensionDir, file))).sort(),
  bytes: buffer.length,
  sha256
}, null, 2));
