import fs from "node:fs";
import path from "node:path";

if (process.env.CI === "1") {
  process.exit(0);
}

const repoRoot = process.cwd();
const gitDir = path.join(repoRoot, ".git");
const hooksDir = path.join(gitDir, "hooks");
const sourceDir = path.join(repoRoot, "tools", "githooks");

if (!fs.existsSync(gitDir)) {
  console.log("[hooks] .git not found; skipping hook install");
  process.exit(0);
}

if (!fs.existsSync(sourceDir)) {
  console.log("[hooks] tools/githooks not found; skipping hook install");
  process.exit(0);
}

fs.mkdirSync(hooksDir, { recursive: true });

const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
const installed = [];

for (const entry of entries) {
  if (!entry.isFile()) continue;
  const src = path.join(sourceDir, entry.name);
  const dest = path.join(hooksDir, entry.name);
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  installed.push(entry.name);
}

if (installed.length === 0) {
  console.log("[hooks] no hooks to install");
} else {
  console.log(`[hooks] installed: ${installed.join(", ")}`);
}
