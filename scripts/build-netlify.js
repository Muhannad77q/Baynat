import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.join(root, "dist");
const publicFiles = [
  "index.html",
  "student.html",
  "app.js",
  "student.js",
  "pow-worker.js",
  "styles.css",
  "logo.svg",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
  publicFiles.map((file) => copyFile(path.join(root, file), path.join(output, file)))
);
