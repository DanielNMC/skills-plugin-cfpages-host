// src/lib.ts
// Shared helpers — URL parsing, GitHub API calls, file filtering, hashing.

const GITHUB_API = "https://api.github.com"

export interface SkillEntry {
  name?: string
  url: string
  ref?: string | null
  files?: string[]
  include_glob?: string
  exclude?: string[]
  expand?: boolean
}

export interface ResolvedFile {
  path: string
  raw_url: string
  size?: number
}

// Parse any GitHub URL into (owner, repo, ref, path)
export function parseGitHub(url: string): {
  owner: string
  repo: string
  ref: string
  path: string
} | null {
  const u = new URL(url)
  if (u.hostname === "github.com") {
    const m = u.pathname.match(
      /^\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?(\/.*)?$/,
    )
    if (!m) return null
    const [, owner, repo, ref = "main", path = ""] = m
    return { owner, repo, ref, path: path.replace(/^\//, "") }
  }
  if (u.hostname === "raw.githubusercontent.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/)
    if (!m) return null
    const [, owner, repo, ref, path] = m
    return { owner, repo, ref, path: path.replace(/\/SKILL\.md$/, "") }
  }
  return null
}

export function deriveName(url: string): string {
  const parsed = parseGitHub(url)
  if (!parsed) return "unnamed-skill"
  const segs = parsed.path.split("/").filter(Boolean)
  return segs[segs.length - 1] || parsed.repo
}

// Tiny glob matcher: supports * and **
export function matchGlob(p: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "::")
        .replace(/\*/g, "[^/]*")
        .replace(/::/g, ".*") +
      "$",
  )
  return re.test(p)
}

// List a GitHub directory recursively via the Contents API
export async function listGitHubDir(
  entry: SkillEntry,
  token?: string,
): Promise<ResolvedFile[]> {
  const parsed = parseGitHub(entry.url)
  if (!parsed) throw new Error(`Unparseable URL: ${entry.url}`)

  const files: ResolvedFile[] = []
  const basePath = parsed.path.trim().replace(/\/+$/, "")
  const basePrefix = basePath ? `${basePath}/` : ""
  const stack = [basePath]
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "my-skills-plugin",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  while (stack.length) {
    const p = stack.pop()!
    const apiUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURI(p) || ""}?ref=${parsed.ref}`
    const res = await fetch(apiUrl, { headers })
    if (!res.ok) {
      // Fallback: explicit files list (skips API)
      if (entry.files) {
        return entry.files.map((f) => ({
          path: f,
          raw_url: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${p ? p + "/" : ""}${f}`,
        }))
      }
      throw new Error(`GitHub ${res.status} for ${apiUrl}`)
    }
    const items: any[] = await res.json()
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item.type === "file") {
        const relativePath =
          basePrefix && item.path.startsWith(basePrefix)
            ? item.path.slice(basePrefix.length)
            : item.path
        files.push({
          path: relativePath,
          raw_url: item.download_url,
          size: item.size,
        })
      } else if (item.type === "dir") {
        stack.push(item.path)
      }
    }
  }
  return files
}

// Apply include/exclude/glob filters
export function filterFiles(
  files: ResolvedFile[],
  entry: SkillEntry,
): ResolvedFile[] {
  let out = files
  if (entry.exclude?.length) {
    out = out.filter(
      (f) => !entry.exclude!.some((p) => matchGlob(f.path, p)),
    )
  }
  if (entry.include_glob) {
    out = out.filter((f) => matchGlob(f.path, entry.include_glob!))
  }
  return out
}

// Path-traversal guard
export function isSafePath(p: string): boolean {
  return (
    !!p &&
    !p.includes("..") &&
    !p.startsWith("/") &&
    !p.startsWith("\\") &&
    !p.includes("\0")
  )
}

// Deterministic content hash
export async function contentHash(
  files: Map<string, Uint8Array>,
): Promise<string> {
  const sorted = Array.from(files.keys()).sort()
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const k of sorted) {
    parts.push(enc.encode(k))
    parts.push(files.get(k)!)
  }
  const buf = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
  let off = 0
  for (const p of parts) {
    buf.set(p, off)
    off += p.length
  }
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
