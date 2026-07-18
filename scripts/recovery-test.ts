#!/usr/bin/env bun
// scripts/recovery-test.ts
// Regression test: plugin must re-write files when on-disk files are missing,
// even if the content hash matches the state hash. Tests the "hash check skips
// too aggressively" bug where deleted files don't get restored on next session.

import { strict as assert } from "node:assert"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const root = join(import.meta.dir, "..")
const configRoot = join(homedir(), ".config", "kilo")
const skillsRoot = join(configRoot, "skills")
const stateRoot = join(configRoot, ".skill-state")
const skillName = "recovery-test"
const skillFile = join(skillsRoot, skillName, "SKILL.md")
const stateFile = join(stateRoot, `${skillName}.hash`)

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (pathname === "/skills.json") {
      return new Response(
        JSON.stringify({
          skills: [{
            name: skillName,
            url: `http://localhost:${server.port}`,
            files: ["SKILL.md"],
          }],
        }),
      )
    }
    if (pathname === `/skills/${skillName}/SKILL.md`) {
      return new Response("# Recovery Test\nThis is the test content.\n")
    }
    return new Response("Not found", { status: 404 })
  },
})

let failed = false
try {
  process.env.MY_SKILLS_BASE_URL = `http://localhost:${server.port}`
  await rm(skillsRoot, { recursive: true, force: true })
  await rm(stateRoot, { recursive: true, force: true })
  await mkdir(configRoot, { recursive: true })

  const mod = await import("../src/plugin.ts")

  // First sync: should populate skill files + state hash
  {
    const hooks = await mod.MySkills({} as any, {} as any)
    await hooks["session.created"]({} as any)
    await Bun.sleep(4000)
    assert(existsSync(skillFile), `first sync: ${skillFile} should exist`)
    assert(existsSync(stateFile), `first sync: ${stateFile} should exist`)
  }

  // Simulate the bug condition: delete skill files but KEEP the state hash.
  // Without the fix, the plugin would skip the write on the next sync
  // because hash matches.
  await rm(skillsRoot, { recursive: true, force: true })
  await mkdir(skillsRoot, { recursive: true })
  assert(!existsSync(skillFile), `precondition: ${skillFile} should be deleted`)
  assert(existsSync(stateFile), `precondition: ${stateFile} should still exist`)

  // Second sync: plugin must re-write the missing files even though
  // the hash matches.
  {
    const hooks = await mod.MySkills({} as any, {} as any)
    await hooks["session.created"]({} as any)
    await Bun.sleep(4000)
    assert(
      existsSync(skillFile),
      `recovery sync: ${skillFile} should reappear even when hash matches`,
    )
  }

  console.log("recovery test passed")
} catch (error) {
  failed = true
  console.error(error)
} finally {
  server.stop()
  process.exit(failed ? 1 : 0)
}