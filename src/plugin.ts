// src/plugin.ts
// my-skills — Kilo/OpenCode plugin entry point.
// Loaded by Bun after the tarball is installed. Runs on session.created.

import type { Plugin } from "@kilocode/plugin"
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

import {
  parseGitHub,
  deriveName,
  listGitHubDir,
  filterFiles,
  isSafePath,
  contentHash,
  type SkillEntry,
  type ResolvedFile,
} from "./lib.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolved at install time:
//   ~/.cache/opencode/packages/my-skills-1.0.0/package/src/plugin.ts
// So PLUGIN_ROOT is two levels up: ~/.cache/opencode/packages/my-skills-1.0.0/
const PLUGIN_ROOT = join(__dirname, "..", "..")
const SKILLS_LIST_PATH = join(PLUGIN_ROOT, "skills_list.json")

// ---- Config (env vars + plugin options) ----

const REFRESH_INTERVAL_MS = Number(
  process.env.MY_SKILLS_REFRESH_MS ?? 60 * 60 * 1000,
)
const DISABLED = process.env.MY_SKILLS_DISABLED === "1"
const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || process.env.MY_SKILLS_GITHUB_TOKEN

// Consumer can override these by passing options to the plugin in kilo.jsonc:
//   ["my-skills@https://...", { "skills_list_path": "/custom/path.json" }]
interface PluginOptions {
  skills_list_path?: string
  refresh_ms?: number
  disabled?: boolean
  github_token?: string
}

const SKILLS_ROOT = join(homedir(), ".config", "kilo", "skills")
const STATE_ROOT = join(homedir(), ".config", "kilo", ".skill-state")

let lastRefresh = 0
let lastManifestHash: string | null = null
let lastEntryNames: Set<string> = new Set()

// ---- Core sync logic ----

async function syncSkill(
  entry: SkillEntry,
  index: number,
): Promise<{ name: string; files: number; hash: string } | null> {
  const name = entry.name ?? deriveName(entry.url)

  // Discover files
  let allFiles: ResolvedFile[]
  try {
    allFiles = await listGitHubDir(entry, GITHUB_TOKEN)
  } catch (e: any) {
    console.warn(`[my-skills] [${index}] ${name}: ${e.message}`)
    return null
  }

  const files = filterFiles(allFiles, entry)
  if (!files.length) {
    console.warn(`[my-skills] [${index}] ${name}: no files matched filters`)
    return null
  }

  // Fetch all in parallel
  const fetched = new Map<string, Uint8Array>()
  await Promise.all(
    files.map(async (f) => {
      try {
        const r = await fetch(f.raw_url, {
          headers: { "User-Agent": "my-skills-plugin" },
        })
        if (r.ok) {
          fetched.set(f.path, new Uint8Array(await r.arrayBuffer()))
        }
      } catch {
        /* skip individual file failures */
      }
    }),
  )

  if (fetched.size === 0) {
    console.warn(`[my-skills] [${index}] ${name}: all file fetches failed`)
    return null
  }

  // Compute content hash
  const hash = await contentHash(fetched)
  const stateFile = join(STATE_ROOT, `${name}.hash`)

  // Skip if unchanged
  if (existsSync(stateFile)) {
    const existing = readFileSync(stateFile, "utf-8").trim()
    if (existing === hash) {
      return { name, files: fetched.size, hash }
    }
  }

  // Write to disk
  const targetDir = join(SKILLS_ROOT, name)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })

  for (const [p, content] of fetched) {
    if (!isSafePath(p)) continue
    const full = join(targetDir, p)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }

  mkdirSync(STATE_ROOT, { recursive: true })
  writeFileSync(stateFile, hash)

  console.log(`[my-skills] [${index}] ${name}: wrote ${fetched.size} files`)
  return { name, files: fetched.size, hash }
}

async function sync(entries: SkillEntry[]): Promise<void> {
  // If the manifest itself hasn't changed, no point re-syncing.
  const manifestStr = JSON.stringify(entries)
  const manifestHash = await contentHash(
    new Map([["manifest", new TextEncoder().encode(manifestStr)]]),
  )
  if (manifestHash === lastManifestHash) return
  lastManifestHash = manifestHash

  mkdirSync(SKILLS_ROOT, { recursive: true })
  mkdirSync(STATE_ROOT, { recursive: true })

  // Prune skills that were removed from the manifest
  const currentNames = new Set(entries.map((e) => e.name ?? deriveName(e.url)))
  for (const old of lastEntryNames) {
    if (!currentNames.has(old)) {
      rmSync(join(SKILLS_ROOT, old), { recursive: true, force: true })
      rmSync(join(STATE_ROOT, `${old}.hash`), { force: true })
      console.log(`[my-skills] pruned: ${old}`)
    }
  }
  lastEntryNames = currentNames

  // Sync all in parallel
  await Promise.all(entries.map((e, i) => syncSkill(e, i)))
}

// ---- Plugin entry point ----

export const MySkills: Plugin = async (_ctx, options: PluginOptions = {}) => {
  const skillsListPath = options.skills_list_path ?? SKILLS_LIST_PATH
  const refreshMs = options.refresh_ms ?? REFRESH_INTERVAL_MS
  const disabled = options.disabled ?? DISABLED
  const token = options.github_token ?? GITHUB_TOKEN

  let lastRun = 0

  async function run() {
    if (disabled) return
    if (Date.now() - lastRun < refreshMs) return
    lastRun = Date.now()

    let entries: SkillEntry[]
    try {
      const raw = JSON.parse(readFileSync(skillsListPath, "utf-8"))
      entries = raw.map((e: any) =>
        typeof e === "string"
          ? { name: deriveName(e), url: e }
          : (e as SkillEntry),
      )
    } catch (e: any) {
      console.warn(`[my-skills] failed to read ${skillsListPath}: ${e.message}`)
      return
    }

    await sync(entries)
  }

  return {
    "session.created": async () => {
      void run()
    },
    "session.idle": async () => {
      void run()
    },
  }
}
