# my-skills

Self-hosted skills registry for Kilo. Private source repo on GitHub, Cloudflare Pages builds a tarball on every push, consumers install it via Bun's tarball URL format. Edit `skills_list.json`, push, every Kilo user picks up the change on their next session start.

The tarball contains no secrets and serves only public metadata; the source code that builds it stays private.

## How a request flows

```
┌──────────────────────────────────────────────────────────┐
│ Private GitHub repo                                      │
│   src/plugin.ts        Kilo plugin entry, hooks          │
│   src/lib.ts           URL parsing, GitHub API, hashing  │
│   skills_list.json     source of truth (you edit this)   │
│   package.json         version + plugin metadata         │
└──────────────────────────────────────────────────────────┘
                          │  git push origin main
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Cloudflare Pages (GitHub App connected)                   │
│   Build command:  npm run build                          │
│   Output dir:     dist/                                  │
│   Produces:       dist/my-skills-X.Y.Z.tgz               │
│   Public URL:     https://<project>.pages.dev/           │
│                   my-skills-X.Y.Z.tgz                    │
└──────────────────────────────────────────────────────────┘
                          │  curl -sSL on first Kilo start
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Consumer's machine                                       │
│   ~/.config/kilo/kilo.jsonc                              │
│     "plugin": [                                          │
│       "my-skills@https://my-skills-atd.pages.dev/        │
│        my-skills-1.0.0.tgz"                              │
│     ]                                                    │
│                                                          │
│ Bun downloads + extracts + installs deps + loads plugin  │
└──────────────────────────────────────────────────────────┘
                          │  plugin fires on session.created
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Plugin sync                                              │
│   1. Read skills_list.json from plugin install dir       │
│   2. For each entry:                                     │
│        a. List files (GitHub API, or use explicit list)  │
│        b. Fetch files                                    │
│        c. Compute sha256 of (sorted path + content)      │
│        d. Compare to ~/.config/kilo/.skill-state/*.hash  │
│        e. If unchanged, skip                             │
│        f. If changed, rm skill dir, write new files,     │
│           write new hash                                 │
│   3. Prune skills removed from the manifest              │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Skills on disk                                           │
│   ~/.config/kilo/skills/<name>/SKILL.md    (Kilo reads)  │
│   ~/.config/kilo/.skill-state/<name>.hash (next-sync key)│
└──────────────────────────────────────────────────────────┘
```

---

## 1. Configure with Kilo Code (VS Code extension)

Kilo Code is the VS Code extension. It bundles the Kilo CLI binary, reads the same config files, and registers skills at session start.

### 1.1 Pick the right `kilo.jsonc`

Kilo reads configs from four locations (later wins):

| Scope | Path |
|---|---|
| XDG global | `~/.config/kilo/kilo.jsonc` |
| User home | `~/.kilo/kilo.jsonc`, `~/.kilocode/kilo.jsonc` |
| Project root | `./kilo.jsonc`, `./.kilo/kilo.jsonc`, `./.kilocode/kilo.jsonc` |
| Managed (enterprise) | macOS `/Library/Application Support/kilo/`, Linux `/etc/kilo/` |

For "install my personal skills in every workspace," use the global config:

```bash
$EDITOR ~/.config/kilo/kilo.jsonc
```

For "install skills for one project only," use a project config (less common with this plugin — most teams want global).

### 1.2 Add the plugin entry

```jsonc
{
  "plugin": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

Bun's tarball URL format: `name@https://host/path/to/pkg-X.Y.Z.tgz`. Bun fetches, extracts, runs `bun install` to resolve `@kilocode/plugin` from the tarball's `dependencies`, then loads the entry point declared in the tarball's `package.json` (`opencode.plugin` and `kilocode.plugin` fields point to `./src/plugin.ts`).

### 1.3 Pin a version vs latest

`my-skills@https://.../my-skills-1.0.0.tgz` pins to 1.0.0. To upgrade, bump the URL. To force re-download of the same version (e.g., you fixed the tarball but didn't change version), bump the version in `package.json`, push, and update the consumer URL.

Bun caches by URL. Different URL = re-download. Same URL = cached.

### 1.4 Pass plugin options (override defaults)

Use the tuple form. The second element is an options object:

```jsonc
{
  "plugin": [
    [
      "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz",
      {
        "refresh_ms": 1800000
      }
    ]
  ]
}
```

| Option | Default | Purpose |
|---|---|---|
| `refresh_ms` | `3600000` (1h) | Minimum time between syncs. Set `0` to sync every session. |
| `disabled` | `false` | Set `true` to disable the plugin entirely (CI, debugging). |
| `skills_list_path` | bundled `skills_list.json` | Absolute or `~/`-prefixed path to a custom skills manifest. Rarely needed — prefer editing the bundled file. |
| `github_token` | `GITHUB_TOKEN` env var | PAT for the GitHub Contents API. Avoid committing real tokens. |

### 1.5 Env vars (alternative to options)

| Env var | Equivalent option |
|---|---|
| `MY_SKILLS_DISABLED=1` | `{ "disabled": true }` |
| `MY_SKILLS_REFRESH_MS=1800000` | `{ "refresh_ms": 1800000 }` |
| `MY_SKILLS_GITHUB_TOKEN=ghp_xxx` | `{ "github_token": "ghp_xxx" }` |
| `GITHUB_TOKEN=ghp_xxx` | `{ "github_token": "ghp_xxx" }` (fallback) |

Useful for CI:

```bash
MY_SKILLS_DISABLED=1 kilo run "test"
```

### 1.6 Verify the plugin loaded

After saving the config:

1. **Reload VS Code window**: `Cmd+Shift+P` → "Developer: Reload Window" (Kilo loads plugins once at extension startup).
2. **Check the skill files appeared on disk**:

   ```bash
   ls ~/.config/kilo/skills/
   # Expected: frontend-design  web-design-guidelines
   ```

3. **Ask the agent to list its skills**:

   ```text
   > what skills can you load?
   ```

   It should name both `frontend-design` and `web-design-guidelines`.

4. **If a skill is missing**, check Kilo's stderr:

   ```bash
   kilo run "test" 2>&1 | grep -i my-skills
   # Look for: [my-skills] [N] <name>: wrote N files
   # Or:        [my-skills] failed to read ...
   # Or:        [my-skills] [N] <name>: GitHub 403 ...
   ```

### 1.7 Force a re-sync from disk

If the agent claims skills exist but is missing one (e.g., you just edited `skills_list.json` and need to pick it up faster than `refresh_ms`):

```bash
rm -rf ~/.config/kilo/.skill-state ~/.config/kilo/skills/*
# Restart Kilo Code session
```

The next `session.created` writes fresh skills (the hash check is bypassed because no prior hash exists).

---

## 2. Deploy workflow: adding or bumping a skill

Two scenarios: (A) adding a new skill, (B) bumping the plugin code itself. Both share the same deploy pipeline.

### 2.1 Add a new skill to the manifest

Edit `skills_list.json` (the ONLY file you change for content updates):

```jsonc
[
  {
    "name": "frontend-design",
    "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    "files": ["SKILL.md", "LICENSE.txt"]
  },
  {
    "name": "web-design-guidelines",
    "url": "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines",
    "files": ["SKILL.md"]
  }
]
```

Validate the JSON, then commit:

```bash
jq . skills_list.json  # validates
git diff skills_list.json
git add skills_list.json
git commit -m "feat: add new-skill to manifest"
git push origin main
```

CF Pages detects the push, runs `npm run build`, deploys the new tarball. Consumers pick it up on their next session start (no action from them).

### 2.2 Bump the plugin version (required when changing plugin code or skills_list.json)

Bumping is how consumers force re-download. Bun caches by URL — without a bump, existing installations won't fetch the new tarball.

```bash
cd my-skills

# Optional: edit src/plugin.ts or src/lib.ts first
npm version patch   # 1.0.0 → 1.0.1
# or: npm version minor, npm version major

git push origin main
```

CF Pages rebuilds with the new version. The new tarball URL becomes `https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz`. Tell consumers (your team) to update their `kilo.jsonc`:

```diff
-"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
+"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
```

### 2.3 End-to-end deploy (full sequence)

```bash
# 1. Edit
vim skills_list.json   # or src/*.ts


# 2. Local build to verify
npm install
npm run build
ls -lah dist/
tar -tzf dist/my-skills-*.tgz   # must show package/src/*.ts + package/skills_list.json

# 3. Bump version (only if you're happy with the build)
npm version patch

# 4. Push (triggers CF Pages)
git add -A
git commit -m "feat: ..."
git push origin main

# 5. Wait ~30-90s for CF Pages
sleep 60

# 6. Verify the deploy
wrangler pages deployment list --project-name my-skills | head -5
curl -sSL -o /tmp/check.tgz https://my-skills-atd.pages.dev/my-skills-$(jq -r .version package.json).tgz
shasum -a 256 /tmp/check.tgz
tar -tzf /tmp/check.tgz   # contents should match your local build

# 7. Tell consumers to update kilo.jsonc (or rely on automatic pickup if URL didn't change)
```

### 2.4 Roll back

```bash
git revert HEAD
git push origin main
# Wait for CF Pages rebuild
# Consumers see the reverted version at the URL they have pinned
```

If a bad version is already live, you can also re-deploy an older tarball directly:

```bash
wrangler pages deploy dist/my-skills-1.0.0.tgz --project-name my-skills
```

---

## 3. Technical reference

### 3.1 Architecture summary

- **Source of truth**: GitHub repo (private). `skills_list.json` is the manifest of skills to ship. `src/plugin.ts` is the runtime.
- **Distribution**: Cloudflare Pages builds the tarball from `npm run build` output (`dist/`). Tarball URL is public but contains no secrets.
- **Runtime**: Kilo (CLI or VS Code extension) downloads the tarball via Bun, installs dependencies, loads the plugin. Plugin reads its own bundled `skills_list.json`, fetches skill files from public GitHub repos, writes them to `~/.config/kilo/skills/<name>/`.

### 3.2 File layout

```
my-skills/
├── package.json          version, plugin metadata, build scripts
├── package-lock.json     npm lockfile (commit this)
├── tsconfig.json         IDE support for src/*.ts
├── skills_list.json      the only file you edit for content changes
├── README.md             this file
├── .gitignore            node_modules, dist, ._, .env
├── src/
│   ├── plugin.ts         entry point, exports MySkills function
│   └── lib.ts            URL parsing, GitHub Contents API, hashing
├── .kilo/                Kilo CLI project state (auto-managed)
└── dist/                 build output (gitignored)
    └── my-skills-X.Y.Z.tgz
```

### 3.3 `package.json` fields that matter

| Field | Purpose |
|---|---|
| `name` | Must match the folder name Bun extracts to (`my-skills`). Used by `resolvePluginRoot()` to find the package root. |
| `version` | Bump to force consumer re-download. Appears in the tarball filename. |
| `main` | Points to `./src/plugin.ts`. Bun loads this. |
| `exports["."]` | Same as `main`. Required for Bun's tarball URL format. |
| `opencode.plugin` | OpenCode-specific entry pointer. Same as `main`. |
| `kilocode.plugin` | Kilo-specific entry pointer. Same as `main`. |
| `files` | Whitelist of what `npm pack` includes. Default includes nothing useful — must list `src`, `skills_list.json`, `README.md`. |
| `scripts.build` | `npm run clean && npm pack --pack-destination dist`. Runs on CF Pages. |
| `dependencies` | `{ "@kilocode/plugin": "latest" }`. Bun installs this from npm at consumer install time. |
| `engines.bun` | `>=1.3.0`. Kilo uses Bun to install the tarball. |
| `engines.node` | `>=22.0.0`. CF Pages build runs on Node. |

### 3.4 Tarball layout (what Bun extracts)

```
my-skills-1.0.0.tgz
└── package/
    ├── package.json
    ├── skills_list.json
    ├── README.md
    └── src/
        ├── plugin.ts
        └── lib.ts
```

`npm pack` always wraps files in a `package/` directory. Bun extracts that and runs `bun install` to resolve deps.

### 3.5 Plugin lifecycle (when hooks fire)

| Hook | Fires when | Plugin action |
|---|---|---|
| `session.created` | New Kilo session starts | Sync (debounced by `refresh_ms`) |
| `session.idle` | Session goes idle | Sync (debounced) — catches long sessions |

Both call the same `run()` function. The first call after install always syncs. Subsequent calls within `refresh_ms` are no-ops. The sync does:

1. Compute `manifestHash` from `JSON.stringify(entries)`. If unchanged from last sync, return immediately (manifest-level dedup).
2. For each entry:
   - `listGitHubDir(entry)` — calls GitHub Contents API, returns all files under the skill's directory.
   - If GitHub returns 403 and entry has explicit `files`, use those instead (no API call).
   - `filterFiles()` — apply `include_glob` / `exclude`.
   - Fetch all files in parallel via `fetch()` on `download_url`.
   - `contentHash()` — SHA-256 over sorted `(path, content)` pairs.
   - Compare to `~/.config/kilo/.skill-state/<name>.hash`. If equal, skip.
   - If different, `rmSync(targetDir)`, mkdir, write each file, save new hash.
3. Prune skills that were removed from the manifest (compare `lastEntryNames` set).

### 3.6 `skills_list.json` schema

Array of entries, each either a string (URL) or an object:

```ts
interface SkillEntry {
  name?: string                    // inferred from URL if absent
  url: string                      // GitHub tree URL or raw.githubusercontent.com URL
  ref?: string | null              // branch/tag/SHA, default "main"
  files?: string[]                 // explicit file list (skips GitHub API)
  include_glob?: string            // e.g. "references/*.md"
  exclude?: string[]               // e.g. ["*.bak"]
  expand?: boolean                 // (reserved, currently unused)
}
```

**URL formats accepted**:

| Host | URL pattern |
|---|---|
| github.com | `https://github.com/{owner}/{repo}/tree/{ref}/{path}` |
| raw.githubusercontent.com | `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}/SKILL.md` |
| (others) | rejected — `parseGitHub` returns null |

**Path-stripping logic**: GitHub Contents API returns `item.path` as the full repo-relative path (e.g. `skills/frontend-design/SKILL.md`). The plugin strips `<parsed.path>/` prefix to make paths relative to the skill dir (`SKILL.md`). This is what makes the on-disk layout match Kilo's discovery rule.

### 3.7 Content-hash details

```
hash = SHA-256(join(sorted_keys(filenames), concat(path_i + content_i)))
```

- Sort keys alphabetically → same files in any order give the same hash.
- Whitespace change → different hash (the entire file content is part of the digest).
- Adding an unrelated file to the source directory → different hash → re-download.

To avoid unnecessary re-downloads when the source repo grows, use the explicit `files` array to pin what you want.

### 3.8 PLUGIN_ROOT resolution

```ts
function resolvePluginRoot(start: string): string {
  let dir = start
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, "package.json")
    const list = join(dir, "skills_list.json")
    if (existsSync(pkg) && existsSync(list)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf-8")).name
        if (name === "my-skills") return dir
      } catch {}
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return join(start, "..", "..") // dev fallback
}
```

Walks up from `__dirname` looking for the directory containing both `package.json` (with `name: "my-skills"`) and `skills_list.json`. Works for both layouts:
- Consumer-installed: `~/.cache/kilo/packages/my-skills@.../node_modules/my-skills/` → walks up 1 level (1: to node_modules, 2: wrong... wait it actually matches at `node_modules/my-skills/` directly because both files are there).
- Dev mode (`bun run src/plugin.ts` from repo root): walks up from `src/` to repo root, matches `package.json` + `skills_list.json` at repo root.

### 3.9 Cache layout

```
~/.cache/kilo/packages/
├── my-skills@https:/<host>/<path>/my-skills-1.0.0.tgz/
│   ├── my-skills-1.0.0.tgz       # downloaded tarball (may be extracted in place)
│   └── node_modules/             # after bun add resolves deps
│       ├── my-skills/            # the plugin package
│       │   ├── package.json
│       │   ├── skills_list.json
│       │   └── src/
│       │       ├── plugin.ts
│       │       └── lib.ts
│       └── @kilocode/plugin/     # installed dependency
├── superpowers@git+https:/github.com/obra/superpowers.git/
└── ...
```

The cache key includes the URL (`my-skills@https:` + URL with `:` and `/` becoming filesystem path components).

### 3.10 Cloudflare Pages config

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | 22 |
| Build caching | enabled |

**Required**: Cloudflare GitHub App installed on the repo. CF Pages → Create → Pages → Connect to Git → select this repo → configure build → Save and Deploy.

**Environment variables** (set in Pages dashboard):

| Name | Type | Required | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | Secret | recommended for shared CI IPs | Lifts rate limit 60/hr → 5000/hr. No scopes needed for public repos. Used by the plugin at consumer runtime, NOT at build time. |

**Branch previews**: every branch gets a preview URL automatically. Format: `https://<commit-hash>.my-skills-atd.pages.dev/my-skills-1.0.0.tgz`. Useful for testing before merging.

**Custom domain**: Pages → Custom domains → enter `skills.example.com`. Cloudflare auto-provisions SSL. Update consumer URLs accordingly.

### 3.11 Security model

- **Source repo is private.** Only people you grant access can see the build config, `skills_list.json`, plugin code.
- **CF Pages deployment is public.** The tarball is served over HTTPS to anyone who knows the URL.
- **The tarball contains no secrets.** It only has `skills_list.json` (public URLs), `src/*.ts` (plugin code that points at public GitHub), and a README.
- **`GITHUB_TOKEN` is per-consumer.** Not baked into the tarball. Each consumer sets their own (or the plugin uses anonymous rate-limited requests).
- **GitHub rate limits**: 60 req/hr unauthenticated per IP. On shared IPs (CI, corporate NAT), you'll 403 fast. Each consumer should set `GITHUB_TOKEN` themselves.

### 3.12 Troubleshooting

**Plugin doesn't load at all**

```bash
curl -sI https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz  # expect 200
file <(curl -sSL https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz)  # expect gzip
tar -tzf <(curl -sSL ...)  # expect package/src/*.ts etc.
kilo run "test" 2>&1 | grep -i my-skills  # look for "loading plugin" + any errors
```

**Skills don't appear after install**

```bash
ls ~/.config/kilo/skills/        # should list skills
ls ~/.config/kilo/.skill-state/  # should have <name>.hash files
# Force re-sync by clearing state
rm -rf ~/.config/kilo/.skill-state
# Restart Kilo Code session (Cmd+Shift+P → Reload Window)
```

**Agent says "no skills loaded"**

The skill list is loaded at session start. Plugins loaded later (e.g., after config changes) require a session restart.

**GitHub 403 in plugin output**

```bash
# Either set a token:
export GITHUB_TOKEN=ghp_xxx
# Or use explicit files in skills_list.json (no API call needed):
{ "name": "...", "url": "...", "files": ["SKILL.md"] }
```

**Tarball not updating on CF Pages**

```bash
wrangler pages deployment list --project-name my-skills
# Check the latest deployment status — should be "Active"
# If failed, check the Build link in dashboard for npm errors
```

Common CF Pages build failures:
- `npm install` fails → check Node version (22+)
- `npm pack` produces 0 files → `files` field in package.json missing or wrong
- Build succeeds but `dist/` empty → check `npm pack --pack-destination` flag works (npm 9+)

**Consumers see old version**

Bun caches by URL. Bump the version in `package.json`, push, update consumer URLs. Or have the consumer run `rm -rf ~/.bun/install/cache/`.

**Plugin fires but doesn't write skills**

Check `~/.config/kilo/skills/` permissions. Kilo runs as your user, so this should be fine, but if you ran Kilo as another user, the dir might be owned by them.

**Plugin reads wrong `skills_list.json`**

If you used the `skills_list_path` option, it overrides the bundled file. Clear it from your `kilo.jsonc` to use the bundled default.

**Test the plugin without restarting Kilo Code**

You can fire the plugin's hooks in a Bun REPL:

```bash
~/.bun/bin/bun -e '
const path = "/Users/<you>/.cache/kilo/packages/my-skills@https:/my-skills-atd.pages.dev/my-skills-1.0.0.tgz/node_modules/my-skills/src/plugin.ts"
const { MySkills } = await import(path)
const hooks = await MySkills({}, {})
await hooks["session.created"]({})
'
```

This is exactly what Kilo does internally.

### 3.13 File reference

**`src/plugin.ts`** (entry point):

```ts
export const MySkills: Plugin = async (_ctx, options = {}) => {
  const skillsListPath = options.skills_list_path ?? SKILLS_LIST_PATH
  const refreshMs      = options.refresh_ms ?? REFRESH_INTERVAL_MS
  const disabled       = options.disabled ?? DISABLED
  const token          = options.github_token ?? GITHUB_TOKEN

  let lastRun = 0
  async function run() {
    if (disabled) return
    if (Date.now() - lastRun < refreshMs) return
    lastRun = Date.now()
    const entries = parse(skillsListPath)
    await sync(entries)
  }

  return {
    "session.created": () => { void run() },
    "session.idle":    () => { void run() },
  }
}
```

**`src/lib.ts`** helpers:

| Function | Purpose |
|---|---|
| `parseGitHub(url)` | Extract `{owner, repo, ref, path}` from a GitHub URL |
| `deriveName(url)` | Infer skill name from URL's last path segment |
| `listGitHubDir(entry, token)` | Recursively list files via GitHub Contents API, with explicit-files fallback |
| `filterFiles(files, entry)` | Apply `include_glob` / `exclude` filters |
| `isSafePath(p)` | Reject `..`, absolute paths, null bytes |
| `contentHash(files)` | SHA-256 over sorted `(path, content)` pairs |
| `matchGlob(p, pattern)` | `*` → `[^/]*`, `**` → `.*` |

### 3.14 CI / pre-commit checks (recommended)

```bash
# Validate JSON
jq . skills_list.json > /dev/null

# Verify the tarball builds and has the right shape
npm install
rm -rf dist
npm run build
test -f dist/my-skills-$(jq -r .version package.json).tgz
tar -tzf dist/my-skills-*.tgz | grep -q 'package/src/plugin.ts'
tar -tzf dist/my-skills-*.tgz | grep -q 'package/skills_list.json'

# Verify TS compiles
npx tsc --noEmit
```

### 3.15 Migration from older setups

**From public `git+https://` install**:

```diff
-"my-skills@git+https://github.com/USER/REPO.git"
+"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.0.tgz"
```

**From static-`dist/` Pages deploy** (legacy version where `dist/` was the Pages output): delete `wrangler.toml`, `_headers`; add the `package.json` plugin fields (`opencode.plugin`, `kilocode.plugin`, `exports`, `main`, `files`, `scripts.build`); change CF Pages build command to `npm run build`.

### 3.16 Maintainer checklist

- [ ] `skills_list.json` is the only file for content changes.
- [ ] Bump `package.json` version on every change (forces re-download).
- [ ] Local `npm run build` produces a tarball that matches what CF Pages deploys (verify via SHA256).
- [ ] CF Pages deploy is `Active` after push (`wrangler pages deployment list`).
- [ ] `GITHUB_TOKEN` is set in CF Pages env (recommended) and optionally in consumer env.
- [ ] `kilo.jsonc` URL is updated when version bumps (unless you want consumers to follow `latest`).

## License

MIT. The skills you reference have their own licenses — respect them.
