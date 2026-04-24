import path from "node:path"

const DEFAULT_SERVER_REPO_ROOT = "/home/moltook/apps/stockdesk-lab-lite"
const DEFAULT_SERVER_HOST = "spicy-moltbook"

const FORBIDDEN_PATH_PREFIXES = [
  "/mnt/",
  "/media/",
  "/run/desktop/mnt/host/",
]

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/u

const normalizePath = (value) => path.resolve(String(value ?? "").trim())

const hasTrailingSeparator = (value) => value.endsWith(path.sep)

const isWithinRoot = (candidatePath, rootPath) => {
  const normalizedCandidate = normalizePath(candidatePath)
  const normalizedRoot = normalizePath(rootPath)
  if (normalizedCandidate === normalizedRoot) return true
  return normalizedCandidate.startsWith(
    hasTrailingSeparator(normalizedRoot) ? normalizedRoot : `${normalizedRoot}${path.sep}`,
  )
}

const isForbiddenLocalPath = (value) => {
  const raw = String(value ?? "").trim()
  if (!raw) return false
  if (WINDOWS_DRIVE_PATH.test(raw)) return true
  const normalized = normalizePath(raw)
  if (FORBIDDEN_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true
  if (normalized.split(path.sep).some((segment) => segment.toLowerCase() === "onedrive")) return true
  return false
}

export const resolvePerfectPrototypeServerPolicy = () => {
  const repoRoot = normalizePath(process.env.STOCKDESK_SERVER_REPO_ROOT || DEFAULT_SERVER_REPO_ROOT)
  return {
    repoRoot,
    dataRoot: path.join(repoRoot, "data"),
    host: String(process.env.STOCKDESK_SERVER_HOST || DEFAULT_SERVER_HOST).trim(),
  }
}

export const assertPerfectPrototypeServerWorkspace = ({ cwd, toolName }) => {
  const normalizedCwd = normalizePath(cwd)
  const policy = resolvePerfectPrototypeServerPolicy()
  if (isForbiddenLocalPath(normalizedCwd) || !isWithinRoot(normalizedCwd, policy.repoRoot)) {
    throw new Error(
      [
        `${toolName} is server-only and cannot run from this workspace.`,
        `cwd=${normalizedCwd}`,
        `allowedRoot=${policy.repoRoot}`,
        `Run on the server with: tools/run_server_command.sh node tools/${toolName}.mjs ...`,
      ].join(" "),
    )
  }
  return policy
}

export const assertPerfectPrototypeServerPaths = ({ entries, policy, toolName }) => {
  const activePolicy = policy ?? resolvePerfectPrototypeServerPolicy()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const label = String(entry?.label ?? "path").trim() || "path"
    const candidatePath = String(entry?.filePath ?? "").trim()
    if (!candidatePath) continue
    const normalizedCandidate = normalizePath(candidatePath)
    const expectedRoot = entry?.allowedRoot ? normalizePath(entry.allowedRoot) : activePolicy.repoRoot
    if (isForbiddenLocalPath(normalizedCandidate) || !isWithinRoot(normalizedCandidate, expectedRoot)) {
      throw new Error(
        [
          `${toolName} rejected non-server path for ${label}.`,
          `path=${normalizedCandidate}`,
          `allowedRoot=${expectedRoot}`,
          `Use ${activePolicy.host}:${activePolicy.repoRoot} only.`,
        ].join(" "),
      )
    }
  }
  return activePolicy
}

export const assertPerfectPrototypeServerDataPaths = ({ dataPaths, cwd, toolName = "build_perfect_prototype_daily_pack" }) => {
  const policy = assertPerfectPrototypeServerWorkspace({
    cwd,
    toolName,
  })
  assertPerfectPrototypeServerPaths({
    entries: [
      { label: "candleDailyJsonl", filePath: dataPaths?.candleDailyJsonl, allowedRoot: policy.dataRoot },
      { label: "universeJsonl", filePath: dataPaths?.universeJsonl, allowedRoot: policy.dataRoot },
      { label: "symbolMasterJsonl", filePath: dataPaths?.symbolMasterJsonl, allowedRoot: policy.dataRoot },
      { label: "hourly60mJsonl", filePath: dataPaths?.hourly60mJsonl, allowedRoot: policy.dataRoot },
      { label: "newsJsonl", filePath: dataPaths?.newsJsonl, allowedRoot: policy.dataRoot },
    ],
    policy,
    toolName,
  })
  return policy
}
