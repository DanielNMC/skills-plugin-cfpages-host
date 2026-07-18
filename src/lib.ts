export const SKILLS_BASE =
  process.env.MY_SKILLS_BASE_URL || "https://my-skills-atd.pages.dev"

export interface SkillEntry {
  name: string
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
