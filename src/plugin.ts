import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

import {
  SKILLS_BASE,
  buildFileURL,
  contentHash,
  isSafePath,
  parseSource,
  readManifest,
  type SkillEntry,
} from "./lib"

const SKILLS_ROOT = join(homedir(), ".config", "kilo", "skills")
const STATE_ROOT = join(homedir(), ".config", "kilo", ".skill-state")
const DEFAULT_REFRESH_MS = 60 * 60 * 1000

interface PluginOptions {
  refresh_ms?: number
  disabled?: boolean
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function syncSkill(
  entry: SkillEntry,
  index: number,
): Promise<void> {
  const name = typeof entry?.name === "string" ? entry.name : ""
  if (
    !isSafePath(name) ||
    !Array.isArray(entry?.files) ||
    entry.files.some(
      (file) => typeof file !== "string" || !isSafePath(file),
    )
  ) {
    console.warn(`[my-skills] [${index}] ${name}: bad path`)
    return
  }

  const url = typeof entry?.url === "string" ? entry.url : ""
  let source
  try {
    source = parseSource(url)
  } catch (error) {
    console.warn(
      `[my-skills] [${index}] ${name}: bad url: ${errorMessage(error)}`,
    )
    return
  }

  const fetched = new Map<string, Uint8Array>()
  for (const file of entry.files) {
    try {
      const fileURL = buildFileURL(source, name, file)
      const response = await fetch(fileURL, { cache: "no-store" })
      if (!response.ok) {
        console.warn(
          `[my-skills] [${index}] ${name}: ${file} fetch failed: ${response.status}`,
        )
        continue
      }
      fetched.set(file, new Uint8Array(await response.arrayBuffer()))
    } catch (error) {
      console.warn(
        `[my-skills] [${index}] ${name}: ${file} fetch failed: ${errorMessage(error)}`,
      )
    }
  }

  if (!fetched.size) return

  const hash = await contentHash(fetched)
  const stateFile = join(STATE_ROOT, `${name}.hash`)
  try {
    if ((await readFile(stateFile, "utf8")).trim() === hash) return
  } catch {}

  const targetDir = join(SKILLS_ROOT, name)
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  for (const [file, content] of fetched) {
    await writeFile(join(targetDir, file), content)
  }
  await mkdir(STATE_ROOT, { recursive: true })
  await writeFile(stateFile, hash)
  console.log(`[my-skills] [${index}] ${name}: wrote ${fetched.size} files`)
}

async function prune(manifestNames: Set<string>): Promise<void> {
  let stateFiles: string[]
  try {
    stateFiles = await readdir(STATE_ROOT)
  } catch (error: any) {
    if (error?.code === "ENOENT") return
    throw error
  }

  for (const stateFile of stateFiles) {
    if (!stateFile.endsWith(".hash")) continue
    const name = stateFile.slice(0, -5)
    if (manifestNames.has(name)) continue
    await rm(join(STATE_ROOT, stateFile), { force: true })
    if (isSafePath(name)) {
      await rm(join(SKILLS_ROOT, name), { recursive: true, force: true })
    }
  }
}

export const MySkills = async (
  _ctx: unknown,
  options: PluginOptions = {},
) => {
  const refreshMs = options.refresh_ms ?? Number(
    process.env.MY_SKILLS_REFRESH_MS ?? DEFAULT_REFRESH_MS,
  )
  const disabled = options.disabled ?? process.env.MY_SKILLS_DISABLED === "1"
  let lastRefresh = 0
  let inFlight: Promise<void> | null = null

  async function run(): Promise<void> {
    if (disabled || Date.now() - lastRefresh < refreshMs) return
    if (inFlight) return inFlight

    const currentRun = (async () => {
      try {
        const manifest = await readManifest()
        if (!manifest) return
        for (const [index, entry] of manifest.skills.entries()) {
          await syncSkill(entry, index)
        }
        const manifestNames = new Set(
          manifest.skills
            .filter((entry) => typeof entry?.name === "string" && isSafePath(entry.name))
            .map((entry) => entry.name),
        )
        await prune(manifestNames)
        lastRefresh = Date.now()
      } catch (error) {
        console.warn(`[my-skills] sync failed: ${errorMessage(error)}`)
      }
    })()
    inFlight = currentRun
    try {
      await currentRun
    } finally {
      if (inFlight === currentRun) inFlight = null
    }
  }

  return {
    "session.created": () => {
      void run()
    },
    "session.idle": () => {
      void run()
    },
  }
}
