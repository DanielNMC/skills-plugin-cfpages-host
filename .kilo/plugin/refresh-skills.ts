// .kilo/plugin/refresh-skills.ts
// Kilo CLI plugin: pull skills from a static my-skills deployment.
//
// Copy this file into any project that uses Kilo, then edit SKILLS_BASE
// to point at your deployed site. Reference it from kilo.jsonc:
//
//   {
//     "plugin": ["./.kilo/plugin/refresh-skills.ts"]
//   }

import type { Plugin } from "@kilocode/plugin"
import { unzipSync } from "fflate"

// Your deployed site URL. Change this when you rebrand or move.
const SKILLS_BASE = "https://my-skills.pages.dev"

// How often to actually hit the network. Default: once per hour.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000

interface SkillInfo {
  name: string
  bundle_path: string
  sha256: string
  file_count?: number
  error?: string
}

interface Manifest {
  generated_at: string
  count: number
  skills: SkillInfo[]
}

let lastRefresh = 0

async function sync() {
  if (Date.now() - lastRefresh < REFRESH_INTERVAL_MS) return
  lastRefresh = Date.now()

  const home = process.env.HOME || "~"
  const skillsRoot = `${home}/.config/kilo/skills`
  const stateRoot = `${home}/.config/kilo/.skill-state`
  await Bun.$`mkdir -p ${skillsRoot} ${stateRoot}`.quiet()

  let manifest: Manifest
  try {
    manifest = await (await fetch(`${SKILLS_BASE}/manifest.json`)).json()
  } catch (e) {
    console.warn("[refresh-skills] manifest fetch failed:", e)
    return
  }

  await Promise.all(
    manifest.skills.map(async (skill) => {
      if (skill.error) {
        console.warn(`[refresh-skills] ${skill.name} error: ${skill.error}`)
        return
      }
      try {
        // Skip if hash unchanged
        const stateFile = `${stateRoot}/${skill.name}.hash`
        if (
          (await Bun.file(stateFile).exists()) &&
          (await Bun.file(stateFile).text()) === skill.sha256
        ) {
          return
        }

        const res = await fetch(`${SKILLS_BASE}${skill.bundle_path}`)
        if (!res.ok) throw new Error(`bundle ${res.status}`)

        const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
        const targetDir = `${skillsRoot}/${skill.name}`
        await Bun.$`rm -rf ${targetDir}`.quiet()
        await Bun.$`mkdir -p ${targetDir}`.quiet()

        for (const [path, content] of Object.entries(files)) {
          if (path.includes("..") || path.startsWith("/")) continue
          if (content instanceof Uint8Array) {
            const full = `${targetDir}/${path}`
            await Bun.$`mkdir -p ${full.split("/").slice(0, -1).join("/")}`.quiet()
            await Bun.write(full, content)
          }
        }

        await Bun.write(stateFile, skill.sha256)
        console.log(
          `[refresh-skills] ${skill.name}: ${Object.keys(files).length} files`,
        )
      } catch (e) {
        console.warn(`[refresh-skills] ${skill.name} failed:`, e)
      }
    }),
  )
}

export const RefreshSkills: Plugin = async () => ({
  "session.created": async () => {
    void sync()
  },
  "session.idle": async () => {
    void sync()
  },
})
