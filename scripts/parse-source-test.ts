import { strict as assert } from "node:assert"
import { parseSource, buildFileURL, type Source } from "../src/lib.ts"

let passed = 0
let failed = 0
const failures: string[] = []

function check(label: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  ok  ${label}`)
  } catch (error) {
    failed++
    const msg = error instanceof Error ? error.message : String(error)
    failures.push(`${label}: ${msg}`)
    console.log(`  FAIL ${label}: ${msg}`)
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, () => assert.deepStrictEqual(actual, expected))
}

console.log("parseSource")

eq(
  "github tree URL with path",
  parseSource("https://github.com/anthropics/skills/tree/main/skills/frontend-design"),
  { kind: "github", owner: "anthropics", repo: "skills", ref: "main", path: "skills/frontend-design" } satisfies Source,
)

eq(
  "github blob URL with file in path",
  parseSource("https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md"),
  { kind: "github", owner: "anthropics", repo: "skills", ref: "main", path: "skills/frontend-design/SKILL.md" } satisfies Source,
)

eq(
  "raw.githubusercontent.com URL",
  parseSource("https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md"),
  { kind: "github", owner: "anthropics", repo: "skills", ref: "main", path: "skills/frontend-design/SKILL.md" } satisfies Source,
)

eq(
  "github tree URL with empty path",
  parseSource("https://github.com/anthropics/skills/tree/main"),
  { kind: "github", owner: "anthropics", repo: "skills", ref: "main", path: "" } satisfies Source,
)

eq(
  "cf base URL no slash",
  parseSource("https://my-skills-atd.pages.dev"),
  { kind: "cf", base: "https://my-skills-atd.pages.dev" } satisfies Source,
)

eq(
  "cf base URL with trailing slash stripped",
  parseSource("https://my-skills-atd.pages.dev/"),
  { kind: "cf", base: "https://my-skills-atd.pages.dev" } satisfies Source,
)

eq(
  "cf base URL with non-root path preserved",
  parseSource("https://example.com/skills"),
  { kind: "cf", base: "https://example.com/skills" } satisfies Source,
)

check("github URL missing ref/path throws", () => {
  assert.throws(
    () => parseSource("https://github.com/anthropics/skills"),
    /^Error: invalid GitHub URL: https:\/\/github\.com\/anthropics\/skills$/,
  )
})

console.log("buildFileURL")

const srcGithub = {
  kind: "github" as const,
  owner: "anthropics",
  repo: "skills",
  ref: "main",
  path: "skills/frontend-design",
}

eq(
  "github: appends file when path doesn't end with it",
  buildFileURL(srcGithub, "frontend-design", "SKILL.md"),
  "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md",
)

const srcBlob = {
  kind: "github" as const,
  owner: "anthropics",
  repo: "skills",
  ref: "main",
  path: "skills/frontend-design/SKILL.md",
}

eq(
  "github: strips trailing file when path ends with it (blob-style)",
  buildFileURL(srcBlob, "frontend-design", "SKILL.md"),
  "https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md",
)

const srcGithubEmptyPath = {
  kind: "github" as const,
  owner: "anthropics",
  repo: "skills",
  ref: "main",
  path: "",
}

eq(
  "github: empty path appends file",
  buildFileURL(srcGithubEmptyPath, "frontend-design", "SKILL.md"),
  "https://raw.githubusercontent.com/anthropics/skills/main/SKILL.md",
)

const srcCf = { kind: "cf" as const, base: "https://my-skills-atd.pages.dev" }

eq(
  "cf: builds skills/<name>/<file> under base",
  buildFileURL(srcCf, "frontend-design", "SKILL.md"),
  "https://my-skills-atd.pages.dev/skills/frontend-design/SKILL.md",
)

const srcCfPath = { kind: "cf" as const, base: "https://example.com/skills" }

eq(
  "cf: non-root base path is preserved",
  buildFileURL(srcCfPath, "frontend-design", "SKILL.md"),
  "https://example.com/skills/skills/frontend-design/SKILL.md",
)

console.log("")
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
