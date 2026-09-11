import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

function littleEndianLength(length) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(length));
  return bytes;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

async function readPackageFile(packageRoot, relativePath) {
  const segments = relativePath.split("/");
  if (isAbsolute(relativePath) || relativePath.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`invalid package path '${relativePath}'`);
  }
  let filePath = packageRoot;
  for (const [index, segment] of segments.entries()) {
    filePath = join(filePath, segment);
    const metadata = await lstat(filePath);
    const leaf = index === segments.length - 1;
    // lstat the ancestors too: checking just the leaf follows symlinked
    // directories and can read bytes outside the selected package.
    if (leaf ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new Error(`package entry '${relativePath}' contains a non-regular file or directory`);
    }
  }
  return readFile(filePath);
}

async function packageFiles(packageRoot) {
  const manifest = JSON.parse(await readPackageFile(packageRoot, "app.json"));
  const assets = manifest.integrity?.assets;
  if (!assets || typeof assets !== "object" || Array.isArray(assets)) {
    throw new Error("app.json must declare integrity.assets");
  }
  const paths = ["app.json", ...Object.keys(assets)].sort(compareUtf8);
  if (new Set(paths).size !== paths.length) throw new Error("package paths must be unique");
  return paths;
}

export async function packageDigest(packageDirectory) {
  const packageRoot = resolve(fileURLToPath(packageDirectory instanceof URL ? packageDirectory : pathToFileURL(packageDirectory)));
  const hash = createHash("sha256");
  for (const relativePath of await packageFiles(packageRoot)) {
    const content = await readPackageFile(packageRoot, relativePath);
    const pathBytes = Buffer.from(relativePath, "utf8");
    hash.update(littleEndianLength(pathBytes.length));
    hash.update(pathBytes);
    hash.update(littleEndianLength(content.length));
    hash.update(content);
  }
  return `sha256-${hash.digest("hex")}`;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  const packageDirectory = process.argv[2] ?? join(dirname(scriptPath), "..", "dist");
  console.log(await packageDigest(packageDirectory));
}
