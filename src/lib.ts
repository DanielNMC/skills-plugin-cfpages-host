export const SKILLS_BASE =
  process.env.MY_SKILLS_BASE_URL || "https://my-skills-atd.pages.dev"

export type Source =
  | {
      kind: "github"
      owner: string
      repo: string
      ref: string
      path: string
    }
  | { kind: "cf"; base: string }

export function parseSource(url: string): Source {
  const parsed = new URL(url)
  const hostname = parsed.hostname
  const segments = parsed.pathname.split("/").filter(Boolean)

  if (hostname === "github.com") {
    if (segments.length < 3) {
      throw new Error(`invalid GitHub URL: ${url}`)
    }
    const [owner, repo, mode, ...rest] = segments
    let ref: string
    let path: string
    if (mode === "tree" || mode === "blob") {
      if (rest.length < 1) {
        throw new Error(`invalid GitHub URL: ${url}`)
      }
      ref = rest[0]
      path = rest.slice(1).join("/")
    } else {
      ref = mode
      path = rest.join("/")
    }
    return { kind: "github", owner, repo, ref, path }
  }

  if (hostname === "raw.githubusercontent.com") {
    if (segments.length < 3) {
      throw new Error(`invalid GitHub URL: ${url}`)
    }
    const [owner, repo, ref, ...rest] = segments
    return { kind: "github", owner, repo, ref, path: rest.join("/") }
  }

  let base = url
  if (base.endsWith("/")) base = base.slice(0, -1)
  return { kind: "cf", base }
}

export function buildFileURL(source: Source, name: string, file: string): string {
  if (source.kind === "github") {
    const segments = source.path.split("/").filter(Boolean)
    const last = segments[segments.length - 1]
    const dir = last === file ? segments.slice(0, -1) : segments
    const pathPart = dir.length ? dir.join("/") + "/" : ""
    return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${pathPart}${file}`
  }
  return `${source.base}/skills/${name}/${file}`
}

export interface SkillEntry {
  name: string
  url: string
  files: string[]
  include_glob?: string
  exclude?: string[]
}

export interface ResolvedFile {
  path: string
  raw_url: string
  size?: number
}

export async function readManifest(): Promise<{
  skills: SkillEntry[]
} | null> {
  try {
    const response = await fetch(`${SKILLS_BASE}/skills.json`, {
      cache: "no-store",
    })
    if (!response.ok) {
      console.warn(`[my-skills] failed to fetch manifest: ${response.status}`)
      return null
    }
    const manifest = (await response.json()) as { skills?: unknown }
    if (!manifest || !Array.isArray(manifest.skills)) {
      console.warn("[my-skills] failed to fetch manifest: invalid response")
      return null
    }
    return { skills: manifest.skills as SkillEntry[] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[my-skills] failed to fetch manifest: ${message}`)
    return null
  }
}

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

export function filterFiles(
  files: ResolvedFile[],
  entry: SkillEntry,
): ResolvedFile[] {
  let out = files
  if (entry.exclude?.length) {
    out = out.filter(
      (file) => !entry.exclude!.some((pattern) => matchGlob(file.path, pattern)),
    )
  }
  if (entry.include_glob) {
    out = out.filter((file) => matchGlob(file.path, entry.include_glob!))
  }
  return out
}

export function isSafePath(p: string): boolean {
  return (
    !!p &&
    /^[A-Za-z]/.test(p) &&
    !p.includes("..") &&
    !p.includes("/") &&
    !p.includes("\\") &&
    !p.includes("\0")
  )
}

export async function contentHash(
  files: Map<string, Uint8Array>,
): Promise<string> {
  const sorted = Array.from(files.keys()).sort()
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  for (const key of sorted) {
    parts.push(enc.encode(key))
    parts.push(files.get(key)!)
  }
  const buf = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    buf.set(part, offset)
    offset += part.length
  }
  const digest = await crypto.subtle.digest("SHA-256", buf)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
