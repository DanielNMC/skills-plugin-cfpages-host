# my-skills

Self-hosted skills registry for Kilo. Skill files live in-repo under `skills/<name>/`, a `skills.json` manifest at the repo root lists which files belong to each skill, and the plugin (bundled in a tarball on Cloudflare Pages) fetches that manifest on every session start and writes the skill files to `~/.config/kilo/skills/<name>/`. No GitHub API calls at runtime, no per-content version bumps.

## TL;DR

Add to `~/.config/kilo/kilo.jsonc`:

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

Skill content updates do not require changing this URL.

## How a request flows

```
Private GitHub repo
  src/plugin.ts        plugin entry, hooks
  src/lib.ts           SKILLS_BASE, manifest read, hashing
  skills/<name>/...    skill content (SKILL.md, LICENSE...)
  skills.json          manifest: name + files per skill
  package.json         version + plugin metadata
        | deploy (direct or git push)
        v
Cloudflare Pages (project: my-skills)
  /my-skills-X.Y.Z.tgz   plugin tarball (stable URL)
  /skills.json           manifest
  /skills/<name>/<file>  skill files
        | curl on first Kilo start
        v
Consumer's machine
  ~/.config/kilo/kilo.jsonc
    "plugin": ["my-skills@https://my-skills-atd.pages.dev/
                my-skills-1.0.0.tgz"]
  Bun downloads + extracts + installs deps + loads plugin
        | session.created / session.idle
        v
Plugin sync (debounced by refresh_ms)
  1. GET SKILLS_BASE/skills.json                   (manifest)
  2. For each entry:
       a. GET SKILLS_BASE/skills/<name>/<file>     (per file)
       b. SHA-256 over sorted (path, content) pairs
       c. Compare to ~/.config/kilo/.skill-state/<name>.hash
       d. If unchanged, skip; else rm dir, write files, save hash
  3. Prune skills removed from the manifest
        |
        v
Skills on disk
  ~/.config/kilo/skills/<name>/<file>     (Kilo reads)
  ~/.config/kilo/.skill-state/<name>.hash (next-sync key)
```

---

## 1. Configure with Kilo Code

Kilo reads configs from (later wins): `~/.config/kilo/kilo.jsonc`, `~/.kilo/kilo.jsonc`, `./kilo.jsonc`, and managed locations (`/Library/Application Support/kilo/` on macOS, `/etc/kilo/` on Linux). For global install, edit `~/.config/kilo/kilo.jsonc`.

### 1.1 Add the plugin entry

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

Bun's tarball URL format: `name@https://host/path/to/pkg-X.Y.Z.tgz`. Bun fetches, extracts, runs `bun install` to resolve `@kilocode/plugin` from the tarball's `dependencies`, then loads the entry point declared in `opencode.plugin` / `kilocode.plugin` (both point to `./src/plugin.ts`).

The version in the URL only matters for plugin-code changes. Skill content edits do not require a version bump and do not require consumers to change this URL.

### 1.2 Plugin options

Use the tuple form:

```jsonc
{
  "plugin": [
    [
      "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz",
      { "refresh_ms": 1800000 }
    ]
  ]
}
```

| Option       | Default        | Purpose                                                    |
|--------------|----------------|------------------------------------------------------------|
| `refresh_ms` | `3600000` (1h) | Minimum time between syncs. `0` = sync every session.      |
| `disabled`   | `false`        | `true` disables the plugin entirely (CI, debugging).       |

The base URL is not an option — use the `MY_SKILLS_BASE_URL` env var (1.3).

### 1.3 Env vars

| Env var                  | Equivalent                                              |
|--------------------------|---------------------------------------------------------|
| `MY_SKILLS_DISABLED=1`   | `{ "disabled": true }`                                  |
| `MY_SKILLS_REFRESH_MS=N` | `{ "refresh_ms": N }`                                   |
| `MY_SKILLS_BASE_URL=...` | Override the base URL (default `https://my-skills-atd.pages.dev`) |

Options take precedence. Useful for CI and staging:

```bash
MY_SKILLS_DISABLED=1 kilo run "test"
MY_SKILLS_BASE_URL=https://staging.my-skills.pages.dev kilo run "test"
```

### 1.4 Verify

After saving the config:

1. **Reload VS Code window**: `Cmd+Shift+P` -> "Developer: Reload Window".
2. **Check the manifest is reachable**: `curl -sSL https://my-skills-atd.pages.dev/skills.json | jq .`
3. **Check the skill files appeared on disk**: `ls ~/.config/kilo/skills/`
4. **Ask the agent**: `> what skills can you load?`
5. **If a skill is missing**: `kilo run "test" 2>&1 | grep -i my-skills`

### 1.5 Force a re-sync from disk

```bash
rm -rf ~/.config/kilo/.skill-state ~/.config/kilo/skills/*
# Restart Kilo Code session
```

The next `session.created` writes fresh skills (the hash check is bypassed because no prior hash exists).

---

## 2. Deploy workflow

Two scenarios: (A) editing skill content, (B) editing plugin code. Only B requires a version bump and a consumer URL change.

### 2.1 Add or edit a skill (no version bump)

Drop a new folder under `skills/<name>/` and add an entry to `skills.json`:

```bash
mkdir -p skills/new-skill
# ... write skills/new-skill/SKILL.md ...
```

```jsonc
{
  "skills": [
    { "name": "frontend-design",        "files": ["SKILL.md", "LICENSE.txt"] },
    { "name": "web-design-guidelines",  "files": ["SKILL.md"] },
    { "name": "animation-vocabulary",   "files": ["SKILL.md"] },
    { "name": "new-skill",              "files": ["SKILL.md"] }
  ]
}
```

`files` is the literal list of filenames to fetch for that skill. Paths are relative to `skills/<name>/` and become filenames under `~/.config/kilo/skills/<name>/`.

Validate, then redeploy (see 2.3). Consumers pick up the change on their next session start. No URL change is needed on their side.

### 2.2 Bump the plugin (required when changing plugin code)

Plugin code lives in `src/plugin.ts` and `src/lib.ts`. Bumping is how consumers force re-download — Bun caches by URL, so without a bump, existing installations won't fetch the new tarball.

```bash
cd my-skills
# Edit src/*.ts first
npm version patch   # 1.0.0 -> 1.0.1
# Then deploy (2.3)
```

Tell consumers to update their `kilo.jsonc`:

```diff
-"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
+"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
```

### 2.3 Deploy methods

Three ways, all targeting CF Pages project `my-skills`. Output dir is `dist`.

#### A. Direct upload with wrangler (used this session)

```bash
npm install && npm run build   # produces dist/
npx wrangler login             # once
npx wrangler pages deploy dist --project-name my-skills
```

Skips git push. Deploy is immediate.

#### B. Git push -> auto-build

If CF Pages is connected to this repo via the Cloudflare GitHub App:

```bash
git add -A && git commit -m "feat: add new-skill" && git push origin main
```

CF Pages runs `npm run build` and deploys `dist/`. Dashboard must be set to "Build output directory: `dist`". ~30-90s end-to-end.

#### C. Drag-and-drop

CF dashboard -> Workers & Pages -> `my-skills` -> Create new deployment -> drag the `dist/` folder -> Deploy. Useful for one-offs without wrangler auth.

### 2.4 End-to-end deploy checklist

```bash
# 1. Edit (content only -> no version bump)
vim skills.json skills/<name>/SKILL.md
# or (plugin code -> bump version):
vim src/plugin.ts src/lib.ts && npm version patch

# 2. Local build
npm install && npm run build
tar -tzf dist/my-skills-*.tgz   # package/{src,skills.json,skills/...}

# 3. Deploy
npx wrangler pages deploy dist --project-name my-skills
# or: git push origin main

# 4. Verify
curl -sSL https://my-skills-atd.pages.dev/skills.json | jq .
curl -sI https://my-skills-atd.pages.dev/skills/frontend-design/SKILL.md

# 5. (Plugin bump only) Tell consumers to update kilo.jsonc URL
```

### 2.5 Roll back

```bash
git checkout v1.0.0
npm install && npm run build
npx wrangler pages deploy dist --project-name my-skills
```

Or `git revert HEAD && git push origin main`.

---

## 3. Technical reference

### 3.1 Architecture summary

- **Source of truth**: GitHub repo (private). `skills.json` is the manifest. `skills/<name>/` holds the content. `src/plugin.ts` is the runtime.
- **Distribution**: Cloudflare Pages serves both the plugin tarball and the static skill content from the same deployment at `https://my-skills-atd.pages.dev/`.
- **Runtime**: Kilo (CLI or VS Code extension) downloads the tarball via Bun, installs dependencies, loads the plugin. Plugin fetches the manifest and each skill file directly from the same Pages deployment. No GitHub API at runtime.

### 3.2 File layout

```
my-skills/
├── package.json          version, plugin metadata, build scripts
├── tsconfig.json         IDE support for src/*.ts
├── skills.json           manifest: name + files per skill
├── README.md             this file
├── src/
│   ├── plugin.ts         entry point, exports MySkills function
│   └── lib.ts            SKILLS_BASE, readManifest, hashing, path safety
├── skills/
│   ├── frontend-design/SKILL.md
│   ├── frontend-design/LICENSE.txt
│   ├── web-design-guidelines/SKILL.md
│   └── animation-vocabulary/SKILL.md
└── dist/                 build output (gitignored)
    ├── my-skills-X.Y.Z.tgz
    ├── skills.json
    └── skills/<name>/...
```

### 3.3 `package.json` fields that matter

| Field             | Purpose                                                                       |
|-------------------|-------------------------------------------------------------------------------|
| `version`         | Bump only when plugin code changes. Appears in the tarball filename.          |
| `main` / `exports["."]` / `opencode.plugin` / `kilocode.plugin` | All point to `./src/plugin.ts`. Required for Bun's tarball URL format. |
| `files`           | Whitelist for `npm pack`: `src`, `skills`, `skills.json`, `README.md`.         |
| `scripts.build`   | `clean && pack && copy-skills`. Runs on CF Pages.                             |
| `dependencies`    | `{ "@kilocode/plugin": "latest" }`. Resolved by Bun at consumer install.       |

### 3.4 Tarball layout (what Bun extracts)

```
my-skills-1.0.0.tgz
└── package/
    ├── package.json
    ├── README.md
    ├── skills.json
    ├── src/
    │   ├── plugin.ts
    │   └── lib.ts
    └── skills/<name>/...
```

`npm pack` always wraps files in a `package/` directory. Bun extracts and runs `bun install` to resolve deps. The tarball does NOT bake in any base URL — to migrate a consumer, set `MY_SKILLS_BASE_URL` for that consumer; no rebuild needed.

### 3.5 Build pipeline

```
npm run build
  -> clean          (rm -rf dist)
  -> pack           (npm pack --pack-destination dist)
       produces dist/my-skills-X.Y.Z.tgz
  -> copy-skills    (cp -R skills/. dist/skills/ ; cp skills.json dist/skills.json)
       produces dist/skills.json + dist/skills/<name>/<file>...
```

`dist/` is what CF Pages serves. Tarball and static content share the same deployment.

### 3.6 Plugin lifecycle (when hooks fire)

| Hook              | Fires when              | Plugin action                       |
|-------------------|-------------------------|-------------------------------------|
| `session.created` | New Kilo session starts | Sync (debounced by `refresh_ms`)    |
| `session.idle`    | Session goes idle       | Sync (debounced) — catches long sessions |

Both call the same `run()`. The first call after install always syncs; subsequent calls within `refresh_ms` are no-ops. Concurrent calls are de-duplicated (a second `run()` while one is in flight returns the same promise).

The sync does:

1. `readManifest()` — `fetch(SKILLS_BASE + "/skills.json", cache: "no-store")`. Returns `null` on non-2xx or invalid JSON.
2. For each entry in `manifest.skills`:
   - Validate `name` and every `file` against `isSafePath()` (no `..`, no slashes, no null bytes, must start with a letter).
   - For each `file`, `fetch(SKILLS_BASE + "/skills/" + name + "/" + file, cache: "no-store")`. Skip failures with a warning; continue with whatever succeeded.
   - If nothing succeeded, skip the entry.
   - `contentHash(fetched)` — SHA-256 over sorted `(path, content)` pairs.
   - Compare to `~/.config/kilo/.skill-state/<name>.hash`. If equal, skip.
   - If different (or no prior hash), `rm` the target dir, mkdir, write each file, save new hash.
3. `prune(manifestNames)` — remove `~/.config/kilo/skills/<name>/` and `<name>.hash` for any name in state that's no longer in the manifest.

### 3.7 `skills.json` schema

```jsonc
{
  "skills": [
    {
      "name": "frontend-design",
      "files": ["SKILL.md", "LICENSE.txt"]
    }
  ]
}
```

| Field         | Type       | Required | Purpose                                          |
|---------------|------------|----------|--------------------------------------------------|
| `name`        | string     | yes      | Skill directory name under `skills/` and on disk under `~/.config/kilo/skills/`. |
| `files`       | string[]   | yes      | Filenames to fetch from `SKILLS_BASE/skills/<name>/`. Written verbatim under `~/.config/kilo/skills/<name>/`. |

Unknown fields are ignored. Entries with invalid `name` or `files` are logged and skipped at sync time.

### 3.8 Content-hash details

```
hash = SHA-256(concat(sorted_keys, for each key: enc(key) || bytes(content)))
```

Sort keys alphabetically — same files in any order give the same hash. Any byte change or any file add/remove produces a different hash, triggering a re-write of the skill directory.

### 3.9 Cache and on-disk layout

```
~/.cache/kilo/packages/my-skills@https:/my-skills-atd.pages.dev/my-skills-1.0.0.tgz/
├── my-skills-1.0.0.tgz             # downloaded tarball
└── node_modules/
    ├── my-skills/                  # extracted plugin package (skills.json bundled but unused)
    └── @kilocode/plugin/           # installed dependency

~/.config/kilo/
├── skills/<name>/<file>            # what the agent reads
└── .skill-state/<name>.hash        # plugin's per-skill hash cache
```

### 3.10 Cloudflare Pages config

| Setting                | Value           |
|------------------------|-----------------|
| Build command          | `npm run build` |
| Build output directory | `dist`          |
| Root directory         | `/`             |
| Node version           | 22              |

The same Pages project serves both `/my-skills-X.Y.Z.tgz` AND the static skill content at `/skills.json` and `/skills/<name>/<file>` — they deploy together because they share `dist/`.

**Direct deploy (no git integration)**:

```bash
npx wrangler pages deploy dist --project-name my-skills
```

**Git-connected deploy**: Cloudflare GitHub App installed on the repo. CF Pages -> Create -> Pages -> Connect to Git -> select this repo -> configure build (command `npm run build`, output `dist`) -> Save and Deploy.

**Branch previews**: every branch gets `https://<commit-hash>.my-skills-atd.pages.dev/...`. Useful for testing before merging.

**Custom domain**: Pages -> Custom domains -> enter `skills.example.com`. Cloudflare auto-provisions SSL.

### 3.11 Security model

- **Source repo is private.** Only collaborators see the build config, `skills.json`, plugin code.
- **CF Pages deployment is public.** The tarball and the static content are served over HTTPS to anyone who knows the URL.
- **The tarball contains no secrets** — only plugin code and metadata.
- **No tokens at runtime.** The plugin does not call GitHub. No rate limits to worry about, only CF Pages serving limits.
- **Static content is content-only.** `dist/skills/<name>/*.md|txt` — no executable code, no secrets.

### 3.12 Troubleshooting

**Plugin doesn't load at all**

```bash
curl -sI https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz          # expect 200
tar -tzf <(curl -sSL https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz)
# expect: package/src/plugin.ts, package/skills.json, package/skills/<name>/...
kilo run "test" 2>&1 | grep -i my-skills
```

**Skills don't appear after install**

```bash
curl -sSL https://my-skills-atd.pages.dev/skills.json | jq .
ls ~/.config/kilo/skills/        # should list skills
ls ~/.config/kilo/.skill-state/  # should have <name>.hash files

# Force re-sync
rm -rf ~/.config/kilo/.skill-state ~/.config/kilo/skills/*
# Restart Kilo Code session (Cmd+Shift+P -> Reload Window)
```

**Plugin fires but a single file fails**

The plugin logs `[my-skills] [N] <name>: <file> fetch failed: <status>` and continues with whatever succeeded. A 404 means the file isn't at the expected path in `dist/skills/<name>/` — re-check the `files` array in `skills.json` matches what's in the repo.

**Stale skill content**

Bun caches the tarball by URL. The static content is fetched on every sync with `cache: "no-store"`, so `refresh_ms` is the only delay. Force immediate pickup:

```bash
rm -rf ~/.config/kilo/.skill-state ~/.config/kilo/skills/*
# Restart session
```

**Tarball not updating on CF Pages**

```bash
npx wrangler pages deployment list --project-name my-skills
# Latest should be "Active". If failed, open the Build link in the dashboard.
```

Common build failures:
- `npm install` fails -> Node version must be 22+
- `npm pack` produces 0 files -> `files` field in package.json is missing/wrong
- Build succeeds but `dist/` empty -> `npm pack --pack-destination` requires npm 9+
- Static content missing from deploy -> `copy-skills` didn't run; check `npm run build` output

**Agent says "no skills loaded"**

The skill list is loaded at session start. Config changes require a session restart.

**Stale `skills.json` at the edge**

The plugin always fetches `${SKILLS_BASE}/skills.json` with `cache: "no-store"`. If you see old entries, the deployment didn't replace the file:

```bash
curl -sSL https://my-skills-atd.pages.dev/skills.json | jq .
```

Compare against `dist/skills.json` from the build.

### 3.13 File reference

**`src/plugin.ts`** (entry point): exports `MySkills(ctx, options)` returning `{ "session.created", "session.idle" }` hooks. Internally calls `readManifest()` and `syncSkill()` per entry.

**`src/lib.ts`** helpers:

| Export                       | Purpose                                                                  |
|------------------------------|--------------------------------------------------------------------------|
| `SKILLS_BASE`                | `process.env.MY_SKILLS_BASE_URL ?? "https://my-skills-atd.pages.dev"`    |
| `readManifest()`             | `fetch(SKILLS_BASE + "/skills.json", no-store)`. Returns `{skills}` or `null`. |
| `contentHash(files)`         | SHA-256 over sorted `(path, content)` pairs.                             |
| `isSafePath(p)`              | Reject empty, non-letter-start, `..`, `/`, `\`, null bytes.              |
| `matchGlob` / `filterFiles`  | Glob helpers (defined; not consumed by current `syncSkill`).             |

### 3.14 Maintainer checklist

- [ ] Skill content changes only touch `skills/<name>/` and `skills.json`.
- [ ] Plugin-code changes bump `package.json` version and update consumer URLs.
- [ ] `npm run build` produces a `dist/` that matches what CF Pages deploys.
- [ ] `npx wrangler pages deployment list --project-name my-skills` shows the latest deploy as `Active`.
- [ ] `curl -sSL https://my-skills-atd.pages.dev/skills.json | jq .` shows the current manifest.
- [ ] `curl -sI https://my-skills-atd.pages.dev/skills/<name>/<file>` returns 200 for every `(name, file)` pair in `skills.json`.

## License

MIT. The skills you bundle have their own licenses — respect them.