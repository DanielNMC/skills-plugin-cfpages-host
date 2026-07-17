# my-skills

> Self-hosted skills registry for Kilo CLI / OpenCode. Private source repo, Cloudflare Pages serves a tarball, consumers install via Bun's tarball URL format. Edit one JSON file, push, every consumer picks it up on next session.

## What this is

A Kilo/OpenCode plugin that you install via Bun's tarball install (`name@https://...tgz`). The plugin source lives in your private GitHub repo, Cloudflare Pages builds a tarball on every push, and the tarball is served at a public `*.pages.dev` URL. Consumers add one line to `kilo.jsonc` and the plugin handles everything: read the bundled `skills_list.json`, download each skill's files from GitHub, write them to `~/.config/kilo/skills/`, and skip unchanged skills on subsequent sessions via content-hash caching.

**No static site, no Functions, no wrangler, no public source code.**

## How it works

```
┌──────────────────────────────────────────────────────────┐
│  Private GitHub repo                                     │
│   - src/plugin.ts (entry point)                          │
│   - src/lib.ts (URL parsing, GitHub API)                 │
│   - skills_list.json (you edit this)                     │
│   - package.json (version, deps, plugin metadata)        │
└──────────────────────────────────────────────────────────┘
                         │
                         │  git push
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Pages (connected via GitHub App)             │
│                                                          │
│  Build command:  npm run build                           │
│  Output dir:     dist                                    │
│  Result:         dist/my-skills-1.0.0.tgz                │
│                                                          │
│  Public URL:     https://my-skills.pages.dev/my-skills-  │
│                  1.0.0.tgz                                │
└──────────────────────────────────────────────────────────┘
                         │
                         │  Bun downloads on first install
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Consumer's machine                                      │
│   kilo.jsonc:                                          │
│     "plugin": [                                         │
│       "my-skills@https://my-skills.pages.dev/           │
│        my-skills-1.0.0.tgz"                              │
│     ]                                                   │
│                                                          │
│  Bun extracts tarball → bun install → loads plugin       │
└──────────────────────────────────────────────────────────┘
                         │
                         │  plugin runs on session.created
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Kilo plugin fires                                       │
│   1. Read skills_list.json from plugin install dir       │
│   2. For each entry, check content hash                  │
│   3. If unchanged, skip                                  │
│   4. If changed, download files from GitHub              │
│   5. Write to ~/.config/kilo/skills/<name>/              │
│   6. Save new hash                                       │
└──────────────────────────────────────────────────────────┘
```

## One-time setup

### 1. Create the private GitHub repo

```bash
git init my-skills
cd my-skills
# copy files from this draft, or use them as-is
git add .
git commit -m "initial"
gh repo create my-skills --private --source=. --push
```

### 2. Connect Cloudflare Pages to the private repo

1. Install Cloudflare's GitHub App: https://github.com/apps/cloudflare-pages
   - Grant access to **only the `my-skills` repo** (don't give it org-wide access)
2. In Cloudflare dashboard: **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. Select your `my-skills` repo
4. Project name: `my-skills` (this sets the `*.pages.dev` URL)
5. **Build settings:**

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `/` (leave default) |
   | Node version | 22 (or default) |

6. **Environment variables** (optional but recommended):

   | Variable | Purpose |
   |---|---|
   | `GITHUB_TOKEN` | Lifts GitHub API rate limit from 60/hr to 5000/hr. Set to a GitHub PAT with no special scopes needed for public repos. Mark as **Secret**. |

7. Click **Save and Deploy**. First build takes ~1 min. The tarball is now at:
   `https://my-skills.pages.dev/my-skills-1.0.0.tgz`

### 3. Verify

```bash
curl -I https://my-skills.pages.dev/my-skills-1.0.0.tgz
# Should return 200, content-type: application/octet-stream (or similar)
```

## Configuring the plugin in `kilo.jsonc`

### Basic install

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "plugin": [
    "my-skills@https://my-skills.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

When Kilo starts for the first time, Bun downloads the tarball, extracts it, runs `bun install` for the dependencies (`@kilocode/plugin`), and loads the entry point specified in the tarball's `package.json`. The plugin's hooks register and the first `session.created` event fires the sync.

### Pin to a specific version

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

Change the version number in the URL to upgrade. To force a re-download of the same version (e.g. you fixed the build but didn't bump the version), bump the version.

### Pass options to the plugin

```jsonc
{
  "plugin": [
    [
      "my-skills@https://my-skills.pages.dev/my-skills-1.0.0.tgz",
      {
        "skills_list_path": "~/.config/kilo/my-custom-skills.json",
        "refresh_ms": 1800000,
        "github_token": "ghp_override_token"
      }
    ]
  ]
}
```

| Option | Default | Purpose |
|---|---|---|
| `skills_list_path` | bundled `skills_list.json` | Path to a custom skills list. Useful for per-project overrides. |
| `refresh_ms` | `3600000` (1h) | How often to check for skill updates. Set to `0` to refresh every session. |
| `disabled` | `false` | Set `true` to disable the plugin entirely (for CI, debugging). |
| `github_token` | `GITHUB_TOKEN` env var | Override the GitHub token. Avoid putting real tokens in committed config. |

### Use env vars instead of options

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills.pages.dev/my-skills-1.0.0.tgz"
  ]
}
```

Then in the consumer's shell or `.env`:

```bash
export MY_SKILLS_DISABLED=0
export MY_SKILLS_REFRESH_MS=1800000
export MY_SKILLS_GITHUB_TOKEN=ghp_xxx
```

| Env var | Equivalent option |
|---|---|
| `MY_SKILLS_DISABLED=1` | `{ "disabled": true }` |
| `MY_SKILLS_REFRESH_MS=1800000` | `{ "refresh_ms": 1800000 }` |
| `MY_SKILLS_GITHUB_TOKEN=ghp_xxx` | `{ "github_token": "ghp_xxx" }` |
| `GITHUB_TOKEN=ghp_xxx` | `{ "github_token": "ghp_xxx" }` (used as fallback) |

### Disable in CI

```bash
# In your CI environment
MY_SKILLS_DISABLED=1 kilo run --auto "test the build"
```

The plugin becomes a no-op. Useful for reproducible CI runs.

## Configuring the source: `skills_list.json`

This is the only file the plugin author edits. Lives in the repo root, gets bundled into the tarball.

### Simplest form

```json
[
  "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
  "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines"
]
```

Skill name is inferred from the last URL segment.

### Object form (recommended)

```json
[
  {
    "name": "frontend-design",
    "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
    "files": ["SKILL.md", "LICENSE.txt"]
  },
  {
    "name": "impeccable",
    "url": "https://github.com/pbakaus/impeccable/tree/main",
    "ref": "v1.2.0"
  }
]
```

| Field | Required | Purpose |
|---|---|---|
| `name` | no (inferred) | Folder name under `~/.config/kilo/skills/` |
| `url` | yes | Source URL — GitHub tree, raw URL, GitLab, or any HTTPS with a `SKILL.md` |
| `ref` | no (default `main`) | Git branch/tag/SHA to pin |
| `files` | no | Explicit file list. Skips GitHub API discovery. **Use this to avoid 403s on unauthenticated IPs.** |
| `include_glob` | no | Glob filter (e.g. `references/*.md`) |
| `exclude` | no | Glob patterns to skip (e.g. `["*.bak"]`) |
| `expand` | no | If `true`, treat the URL as a directory of multiple skills |

### Use explicit `files` to avoid rate limits

If you're building on a CI server or shared IP, GitHub may 403 unauthenticated requests. Listing files explicitly bypasses the API:

```json
{
  "name": "my-skill",
  "url": "https://github.com/owner/repo/tree/main/skills/my-skill",
  "files": ["SKILL.md", "references/x.md", "assets/y.md"]
}
```

You lose auto-discovery but gain reliability. Use the `GITHUB_TOKEN` env var in CF Pages for the auto-discover form to work on shared IPs.

## Build configuration

The `package.json` has a `build` script that does the only thing needed:

```json
{
  "scripts": {
    "build": "npm run clean && npm run pack",
    "pack": "mkdir -p dist && npm pack --pack-destination dist",
    "clean": "rm -rf dist"
  }
}
```

`npm pack` produces a tarball with the layout Bun expects:

```
my-skills-1.0.0.tgz
└── package/
    ├── package.json     # has opencode.plugin + kilocode.plugin fields
    ├── skills_list.json # the user-edited file
    └── src/
        ├── plugin.ts    # main entry
        └── lib.ts       # helpers
```

The `files` array in `package.json` controls what gets included:

```json
{
  "files": ["src", "skills_list.json", "README.md"]
}
```

Only files matching these patterns go into the tarball. The `dist/` folder, `node_modules/`, `.git/`, etc. are excluded.

### Local build (for testing)

```bash
cd my-skills
npm install
npm run build
ls -lah dist/
# Should show: my-skills-1.0.0.tgz

# Verify the tarball structure
tar -tzf dist/my-skills-1.0.0.tgz
# Should show: package/package.json, package/skills_list.json, package/src/*.ts
```

### Bump the version

Before pushing a change to `skills_list.json` or the plugin code:

```bash
# Edit files...
npm version patch   # 1.0.0 → 1.0.1
# or: npm version minor  # 1.0.0 → 1.1.0
git add .
git commit -m "bump to 1.0.1"
git push
```

CF Pages rebuilds. The new tarball appears at `https://my-skills.pages.dev/my-skills-1.0.1.tgz`. Update the URL in consumer `kilo.jsonc` files.

**Why bump on every change:** Bun caches by URL. If you don't bump, consumers won't pick up the new tarball unless they manually clear `~/.bun/install/cache/`. Bumping the version forces a fresh download.

## Cloudflare Pages configuration reference

### Build settings

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` |
| Node version | 22 |
| Enable build caching | ✅ |

### Environment variables

| Name | Type | Required | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | Secret | recommended | GitHub PAT. Lifts rate limit 60/hr → 5000/hr. No scopes needed for public repos. |

### Custom domain

In Pages dashboard: **Custom domains** → **Set up a custom domain** → enter e.g. `skills.example.com`. Cloudflare auto-provisions SSL. Update consumer URLs accordingly.

### Branch previews

CF Pages automatically creates preview deployments for non-`main` branches. Useful for testing before merging:

- `https://abc123.my-skills.pages.dev/my-skills-1.0.0.tgz` (preview branch)
- `https://main.my-skills.pages.dev/my-skills-1.0.0.tgz` (main branch)

Consumers can test against a preview URL before you merge to main.

### Access policies (for the tarball)

If you want the tarball itself gated (not just the source repo), use Cloudflare Access:

1. Zero Trust dashboard → **Access** → **Applications** → **Add** → **Self-hosted**
2. Application domain: `my-skills.pages.dev`
3. Policy: require email match (your team) or service auth
4. Save

Consumers then need a CF Access service token in their requests. To make this work with Bun's tarball install, you'd need to either:
- Bake the token into the URL: `name@https://CF_Access_ClientId:CF_Access_Client_Secret@my-skills.pages.dev/...` (awkward, leaks creds)
- Or skip CF Pages for the plugin and use Path B (private GitHub + auth)

For most teams, the private source repo is sufficient access control. The CF Pages deployment is intentionally public because the tarball contains no secrets (just skill metadata and code that points at public GitHub repos).

## Plugin behavior reference

### What fires when

| Event | What happens |
|---|---|
| First Kilo session after install | Plugin loads, manifest is unknown, sync runs immediately |
| Subsequent sessions within `refresh_ms` | Plugin loads, last refresh is recent, no-op |
| Session after `refresh_ms` elapsed | Plugin loads, debounce expires, sync runs |
| `session.created` | Sync runs (debounced) |
| `session.idle` | Sync runs (debounced) — catches long-running sessions |
| Skill source updates on GitHub | Next sync detects hash change, re-downloads, re-extracts |
| Skill removed from `skills_list.json` | Next sync removes the local folder and state file |

### What gets written to disk

```
~/.config/kilo/skills/<name>/
  SKILL.md
  references/...
  assets/...
  ...

~/.config/kilo/.skill-state/<name>.hash
  # 64-char sha256 of the sorted (path, content) pairs
```

### Content-hash details

The hash is computed over:
- All file paths in sorted order (joined with the file contents)
- SHA-256

Same files in different order → same hash. Same files but with a whitespace change → different hash. This means GitHub adding an unrelated file to a directory changes the hash and triggers a re-download.

To avoid that for skill sources you don't control, use the explicit `files` array to pin what you want.

## Troubleshooting

### Plugin doesn't load

Check that the tarball URL is reachable and the package.json has the right fields:

```bash
# Verify tarball is downloadable
curl -I https://my-skills.pages.dev/my-skills-1.0.0.tgz

# Check Kilo's stderr for plugin load errors
kilo run --print-logs "test" 2>&1 | grep -i "my-skills"
```

### Skills not appearing

```bash
# Check the manifest was read
ls ~/.config/kilo/skills/   # should list your skills

# Check the state file
ls ~/.config/kilo/.skill-state/   # should have <name>.hash files

# Force a re-sync
rm -rf ~/.config/kilo/.skill-state
kilo run --print-logs "test" 2>&1 | grep my-skills
```

### GitHub 403 in plugin output

The plugin can't reach GitHub from the consumer's machine, or the rate limit is hit. Options:
- Set `GITHUB_TOKEN` in the consumer's env (or pass it via the plugin options)
- Switch the `skills_list.json` entry to use an explicit `files` array (no API call needed)

### "Bad path" warnings in plugin output

Path traversal defense. A skill source has a file with `..` or absolute path. Add to `exclude`:

```json
{
  "exclude": ["../**", "**/.*", "**/*.bak"]
}
```

### Tarball not updating on CF Pages

Check the build log in Pages dashboard. Common issues:
- `npm install` fails → check Node version (needs 22+)
- `npm pack` produces 0 files → check `files` array in `package.json`
- Build succeeds but `dist/` is empty → check `--pack-destination` flag works in your npm version

### Version not bumping / consumers seeing old version

Bun caches tarball downloads. To force refresh on a consumer:
```bash
rm -rf ~/.bun/install/cache/
```

Or bump the version in `package.json` so the URL changes.

## Migration from previous versions

### From the static-`dist/` version

1. Delete `dist/`, `build.ts`, `_headers`, `wrangler.toml` (no longer needed)
2. Add the `package.json` fields: `main`, `opencode`, `kilocode`, `files`, `scripts.build`
3. Move `src/plugin.ts` to the new layout
4. CF Pages build command: `npm run build` (was `bun run build`)
5. Consumer install format: `name@https://pages.dev/my-skills-1.0.0.tgz` (was direct file URLs)

### From public GitHub + `git+https://` install

1. Set the GitHub repo to private
2. Install Cloudflare GitHub App on the repo
3. Connect CF Pages (build command: `npm run build`)
4. Update consumer `kilo.jsonc` from:
   ```jsonc
   "my-skills@git+https://github.com/USER/REPO.git"
   ```
   to:
   ```jsonc
   "my-skills@https://my-skills.pages.dev/my-skills-1.0.0.tgz"
   ```

## File layout

```
my-skills/
├── package.json              # version, plugin metadata, build scripts
├── tsconfig.json             # IDE support for src/*.ts
├── skills_list.json          # ← only file you edit
├── README.md                 # this file
├── .gitignore
├── src/
│   ├── plugin.ts             # main entry, Kilo/OpenCode plugin
│   └── lib.ts                # helpers: URL parsing, GitHub API, hashing
└── dist/                     # build output (gitignored)
    └── my-skills-X.Y.Z.tgz   # produced by `npm run build`
```

## Maintainer handoff notes

- **`skills_list.json` is the only file you edit for content changes.** Bump `package.json` version on every change.
- **CF Pages is the build target.** It rebuilds on every push to main. No GitHub Actions needed.
- **Bun's tarball install format** is what makes this work. The tarball is just an npm package; Bun handles the rest.
- **The plugin reads its own bundled `skills_list.json`** at runtime. Consumer overrides via `skills_list_path` option are supported but rarely needed.
- **No secrets in the tarball.** `GITHUB_TOKEN` is set at build time (in CF Pages env), not embedded. Consumers set their own.
- **Versioning is manual but trivial.** Run `npm version patch/minor/major`, commit, push. CF Pages handles the rest.

## License

MIT. The skills you reference have their own licenses — respect them.
