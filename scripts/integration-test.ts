import { strict as assert } from "node:assert"
import { existsSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const root = join(import.meta.dir, "..")
const configRoot = join(homedir(), ".config", "kilo")
const skillsRoot = join(configRoot, "skills")
const stateRoot = join(configRoot, ".skill-state")

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const pathname = new URL(request.url).pathname
    if (request.method !== "GET") return new Response("Not found", { status: 404 })
    if (pathname === "/skills.json") {
      return new Response(Bun.file(join(root, "skills.json")))
    }
    const match = pathname.match(/^\/skills\/([^/]+)\/([^/]+)$/)
    if (!match) return new Response("Not found", { status: 404 })
    const file = join(root, "skills", match[1], match[2])
    if (!existsSync(file)) return new Response("Not found", { status: 404 })
    return new Response(Bun.file(file))
  },
})

let failed = false
try {
  process.env.MY_SKILLS_BASE_URL = `http://localhost:${server.port}`
  await rm(skillsRoot, { recursive: true, force: true })
  await rm(stateRoot, { recursive: true, force: true })
  await mkdir(configRoot, { recursive: true })

  const mod = await import("../src/plugin.ts")
  const hooks = await mod.MySkills({} as any, {} as any)
  await hooks["session.created"]({} as any)
  await Bun.sleep(5000)

  const expectedFiles = [
    join(skillsRoot, "frontend-design", "SKILL.md"),
    join(skillsRoot, "frontend-design", "LICENSE.txt"),
    join(skillsRoot, "web-design-guidelines", "SKILL.md"),
    join(skillsRoot, "animation-vocabulary", "SKILL.md"),
  ]
  for (const file of expectedFiles) assert(existsSync(file), file)

  const stateFiles = [
    join(stateRoot, "frontend-design.hash"),
    join(stateRoot, "web-design-guidelines.hash"),
    join(stateRoot, "animation-vocabulary.hash"),
  ]
  for (const file of stateFiles) assert(existsSync(file), file)
  console.log("integration test passed")
} catch (error) {
  failed = true
  console.error(error)
} finally {
  server.stop()
  process.exit(failed ? 1 : 0)
}
