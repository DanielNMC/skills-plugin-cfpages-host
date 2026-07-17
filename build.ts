#!/usr/bin/env bun
// build.ts
// Resolves skills_list.json, downloads all files, writes dist/ as a pure static site.
// Run: `bun run build`
// Optional: GITHUB_TOKEN=ghp_xxx for higher rate limits.

import { mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { join, dirname } from "node:path"
import { zip } from "fflate"

const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]
  : "./dist"

const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_API = "https://api.github.com"

interface SkillEntry {
  name?: string
  url: string
  ref?: string | null
  files?: string[]
  include_glob?: string
  exclude?: string[]
  expand?: boolean
}

interface ResolvedFile {
  path: string
  raw_url: string
  size?: number
}

function parseGitHub(url: string) {
  const u = new URL(url)
  if (u.hostname === "github.com") {
    const m = u.pathname.match(
      /^\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?(\/.*)?$/,
    )
    if (!m) return null
    const [, owner, repo, ref = "main", path = ""] = m
    return { owner, repo, ref, path: path.replace(/^\//, "") }
  }
  return null
}

function deriveName(url: string): string {
  const parsed = parseGitHub(url)
  if (!parsed) return "unnamed-skill"
  const segs = parsed.path.split("/").filter(Boolean)
  return segs[segs.length - 1] || parsed.repo
}

function matchGlob(p: string, pattern: string): boolean {
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

async function listGitHubDir(
  entry: SkillEntry,
  cache: Map<string, ResolvedFile[]>,
): Promise<ResolvedFile[]> {
  const cacheKey = JSON.stringify(entry)
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  const parsed = parseGitHub(entry.url)
  if (!parsed) throw new Error(`Unparseable URL: ${entry.url}`)

  const files: ResolvedFile[] = []
  const stack = [parsed.path]
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "my-skills-build",
  }
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`

  while (stack.length) {
    const p = stack.pop()!
    const apiUrl = `${GITHUB_API}/repos/${parsed.owner}/${parsed.repo}/contents/${encodeURI(p) || ""}?ref=${parsed.ref}`
    const res = await fetch(apiUrl, { headers })
    if (!res.ok) {
      if (entry.files) {
        const result = entry.files.map((f) => ({
          path: f,
          raw_url: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.ref}/${p ? p + "/" : ""}${f}`,
        }))
        cache.set(cacheKey, result)
        return result
      }
      throw new Error(`GitHub ${res.status} for ${apiUrl}`)
    }
    const items: any[] = await res.json()
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item.type === "file") {
        files.push({
          path: item.path,
          raw_url: item.download_url,
          size: item.size,
        })
      } else if (item.type === "dir") {
        stack.push(item.path)
      }
    }
  }

  cache.set(cacheKey, files)
  return files
}

function filterFiles(files: ResolvedFile[], entry: SkillEntry): ResolvedFile[] {
  let out = files
  if (entry.exclude?.length) {
    out = out.filter((f) => !entry.exclude!.some((p) => matchGlob(f.path, p)))
  }
  if (entry.include_glob) {
    out = out.filter((f) => matchGlob(f.path, entry.include_glob!))
  }
  return out
}

async function contentHash(
  files: Record<string, Uint8Array>,
): Promise<string> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const sorted = Object.keys(files).sort()
  for (const k of sorted) {
    parts.push(enc.encode(k))
    parts.push(files[k])
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

async function buildSkill(
  entry: SkillEntry,
  index: number,
  cache: Map<string, ResolvedFile[]>,
): Promise<{
  name: string
  hash: string
  size: number
  files: number
  url: string
  ref: string | null
}> {
  const name = entry.name ?? deriveName(entry.url)
  const all = await listGitHubDir(entry, cache)
  const files = filterFiles(all, entry)

  // Strip the source directory prefix from discovered paths so they
  // end up as `dist/skills/<name>/<file>` not `dist/skills/<name>/<full/path>`.
  // The prefix is the path portion of the source URL.
  const parsed = parseGitHub(entry.url)
  const prefix = parsed?.path ? parsed.path.replace(/\/$/, "") + "/" : ""
  const stripped = files
    .map((f) => ({
      ...f,
      // Remove prefix if present, otherwise leave as-is (e.g. for explicit `files` arrays)
      path: f.path.startsWith(prefix) ? f.path.slice(prefix.length) : f.path,
    }))
    // After stripping, also strip any leading slashes
    .map((f) => ({ ...f, path: f.path.replace(/^\/+/, "") }))
    // Skip empty paths (e.g. if the URL pointed to a single file)
    .filter((f) => f.path && f.path !== ".")

  const finalFiles = stripped.length ? stripped : files

  console.log(`[${index}] ${name}: ${finalFiles.length} files discovered`)

  // Fetch all files (bounded concurrency)
  const fileMap: Record<string, Uint8Array> = {}
  const CONCURRENCY = 8
  let fetched = 0
  for (let i = 0; i < finalFiles.length; i += CONCURRENCY) {
    const slice = finalFiles.slice(i, i + CONCURRENCY)
    await Promise.all(
      slice.map(async (f) => {
        try {
          const r = await fetch(f.raw_url, {
            headers: { "User-Agent": "my-skills-build" },
          })
          if (r.ok) {
            fileMap[f.path] = new Uint8Array(await r.arrayBuffer())
            fetched++
          }
        } catch {
          /* skip */
        }
      }),
    )
  }

  if (fetched === 0) {
    throw new Error("no files could be fetched")
  }

  const hash = await contentHash(fileMap)

  // Write dist/skills/<name>/...
  for (const [p, content] of Object.entries(fileMap)) {
    if (p.includes("..") || p.startsWith("/")) continue
    const full = join(OUT, "skills", name, p)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content)
  }

  // Zip into dist/bundles/<name>.zip
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(fileMap, { level: 6 }, (err, data) =>
      err ? reject(err) : resolve(data),
    )
  })
  const bundlePath = join(OUT, "bundles", `${name}.zip`)
  await mkdir(dirname(bundlePath), { recursive: true })
  await writeFile(bundlePath, zipped)

  // Sidecar hash file
  await writeFile(join(OUT, "bundles", `${name}.zip.sha256`), hash)

  return {
    name,
    hash,
    size: zipped.length,
    files: Object.keys(fileMap).length,
    url: entry.url,
    ref: entry.ref ?? null,
  }
}

async function main() {
  console.log(`Building skills → ${OUT}/`)
  await rm(OUT, { recursive: true, force: true }).catch(() => {})
  await mkdir(join(OUT, "skills"), { recursive: true })
  await mkdir(join(OUT, "bundles"), { recursive: true })

  const skillsList: any[] = JSON.parse(
    await readFile("./skills_list.json", "utf-8"),
  )
  const entries: SkillEntry[] = skillsList.map((e) =>
    typeof e === "string" ? { name: deriveName(e), url: e } : e,
  )

  console.log(`Found ${entries.length} skills to build\n`)

  const cache = new Map<string, ResolvedFile[]>()
  const manifest: any[] = []
  for (let i = 0; i < entries.length; i++) {
    try {
      const result = await buildSkill(entries[i], i, cache)
      manifest.push({
        name: result.name,
        url: result.url,
        ref: result.ref,
        file_count: result.files,
        bundle_size: result.size,
        sha256: result.hash,
        bundle_path: `/bundles/${result.name}.zip`,
        skills_path: `/skills/${result.name}/`,
      })
    } catch (e: any) {
      console.error(`[${i}] ${entries[i].url} FAILED: ${e.message}`)
      manifest.push({
        name: entries[i].name ?? deriveName(entries[i].url),
        url: entries[i].url,
        error: e.message,
      })
    }
  }

  const finalManifest = {
    generated_at: new Date().toISOString(),
    count: manifest.length,
    skills: manifest,
  }
  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify(finalManifest, null, 2),
  )

  // Generate a tiny index.html so CF Pages / GitHub Pages has something at /
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>my-skills</title></head><body>
<h1>my-skills</h1>
<p>Static skills registry. See <a href="/manifest.json">manifest.json</a>.</p>
<ul>
${manifest
  .map(
    (s) =>
      `<li><strong>${s.name}</strong> — <a href="${s.skills_path}">files</a> · <a href="${s.bundle_path}">bundle</a>${s.error ? ` — ERROR: ${s.error}` : ""}</li>`,
  )
  .join("\n")}
</ul>
</body></html>`,
  )

  console.log(`\n✓ Wrote ${manifest.length} skills to ${OUT}/`)
  console.log(`  Manifest: ${OUT}/manifest.json`)
  console.log(`  Index:    ${OUT}/index.html`)
}

await main()
