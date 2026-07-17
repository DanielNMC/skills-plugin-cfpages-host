# my-skills

> A self-hosted skills registry for AI coding agents. One `skills_list.json` you edit, a tiny build script, a static folder you can host anywhere. Zero Workers, zero Functions, zero wrangler.

## What this is

A static-site build pipeline for serving AI agent skills (SKILL.md files plus their `references/`, `assets/`, and scripts). You maintain a single `skills_list.json` pointing at skill sources (GitHub, GitLab, any HTTPS URL with a `SKILL.md`). The build script downloads everything, pre-zips per-skill bundles, and writes a manifest. The result is a pure static folder (`dist/`) you can deploy to Cloudflare Pages, GitHub Pages, Netlify, Vercel, nginx, a USB stick — anything that serves files.

**No runtime compute. No Functions. No Workers. No API tokens required at runtime.**

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Source repos (where skills already live)                  │
│   - github.com/anthropics/skills                            │
│   - github.com/pbakaus/impeccable                           │
│   - any HTTPS URL with a SKILL.md                           │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ Build script downloads (once, at build time)
                          │
┌─────────────────────────────────────────────────────────────┐
│  Build time: `bun run build`                                │
│   1. Read skills_list.json                                  │
│   2. For each entry, list directory via GitHub API          │
│   3. Download all files (parallel, bounded)                 │
│   4. Compute content hash (sha256)                          │
│   5. Write dist/skills/<name>/... (file tree)               │
│   6. Zip into dist/bundles/<name>.zip                       │
│   7. Write dist/manifest.json                               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Static site (dist/) — deploy anywhere                      │
│   /manifest.json                                            │
│   /skills/<name>/SKILL.md                                   │
│   /skills/<name>/references/typography.md                   │
│   /bundles/<name>.zip                                       │
│   /bundles/<name>.zip.sha256                                │
└─────────────────────────────────────────────────────────────┘
                          ▲
                          │ Kilo plugin downloads on session.created
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Kilo CLI                                                    │
│   ~/.config/kilo/skills/<name>/...   (extracted from zip)   │
└─────────────────────────────────────────────────────────────┘
```

## Quick start

### 1. Install Bun (one-time)

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install deps

```bash
cd my-skills
bun install
```

### 3. Edit `skills_list.json`

```json
[
  "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
  "https://github.com/pbakaus/impeccable/tree/main",
  "https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines"
]
```

### 4. Build

```bash
bun run build
```

Output goes to `dist/`. Inspect it:

```bash
cat dist/manifest.json
ls dist/skills/frontend-design/
unzip -l dist/bundles/frontend-design.zip
```

### 5. Deploy `dist/` anywhere

Pick your favorite:

```bash
# Cloudflare Pages (no wrangler, via dashboard)
# Just zip dist/ and drag-drop into pages.cloudflare.com

# Cloudflare Pages via API (CI-friendly, no wrangler)
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$PROJECT/deployments" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "directory=./dist"

# GitHub Pages
cp -r dist/* /path/to/username.github.io/

# Netlify
netlify deploy --dir=dist --prod

# nginx
rsync -avz dist/ user@server:/var/www/my-skills/

# Local testing
cd dist && python3 -m http.server 8000
```

### 6. Add the Kilo plugin to your projects

In any project that uses Kilo, copy `.kilo/plugin/refresh-skills.ts` from this repo, set `SKILLS_BASE` to your deployed URL, and reference it in `kilo.jsonc`:

```jsonc
{
  "$schema": "https://app.kilo.ai/config.json",
  "plugin": ["./.kilo/plugin/refresh-skills.ts"]
}
```

## Repo layout

```
my-skills/
├── README.md                              ← this file
├── skills_list.json                       ← the only file you edit
├── build.ts                               ← the build script (runs once per deploy)
├── package.json                           ← bun + fflate
├── .gitignore                             ← ignores dist/, node_modules/
├── .kilo/
│   └── plugin/
│       └── refresh-skills.ts              ← Kilo plugin (copy to consumer projects)
├── kilo.jsonc.example                     ← example for consumer projects
└── dist/                                  ← build output (gitignored, or commit for static deploys)
    ├── manifest.json
    ├── skills/<name>/...                  ← full file tree per skill
    └── bundles/<name>.zip                 ← pre-zipped for Kilo
```

## `skills_list.json` reference

Top-level: a JSON array of entries. Each is either a string URL or an object.

### String form (simplest)

```json
[
  "https://github.com/anthropics/skills/tree/main/skills/frontend-design"
]
```

The skill name is inferred from the last URL segment. The ref defaults to `main`.

### Object form (full control)

```json
{
  "name": "impeccable",
  "url": "https://github.com/pbakaus/impeccable",
  "ref": "v1.2.0",
  "files": ["SKILL.md", "references/typography.md"],
  "include_glob": null,
  "exclude": ["*.bak", "drafts/**"],
  "expand": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `name` | string | Skill name (folder name in `dist/skills/<name>/`) |
| `url` | string | Source URL (GitHub tree, raw URL, GitLab, or any HTTPS) |
| `ref` | string? | Git ref (branch, tag, SHA). Defaults to `main`. |
| `files` | string[]? | Explicit file list. Skips GitHub API discovery. |
| `include_glob` | string? | Glob filter for discovered files (e.g. `references/*.md`) |
| `exclude` | string[]? | Glob patterns to exclude |
| `expand` | boolean? | Treat the URL as a directory of multiple skills; emit one entry per `SKILL.md` |

### Accepted URL forms

| URL | Resolves to |
|---|---|
| `https://github.com/owner/repo/tree/main/path` | GitHub directory listing |
| `https://github.com/owner/repo/tree/v1.0/path` | Same, ref pinned |
| `https://raw.githubusercontent.com/owner/repo/main/path/SKILL.md` | Direct raw file |
| `https://gitlab.com/owner/repo/-/raw/main/path/SKILL.md` | GitLab raw |
| `https://any-site.com/path/SKILL.md` | Direct URL (requires `files` array) |

### Monorepo pattern (`expand: true`)

For repos with multiple skills under one path (e.g. `nexu-io/open-design` has 19 skills under `skills/`):

```json
{
  "name": "open-design-kilo",
  "url": "https://github.com/mojila/open-design-kilo",
  "include_glob": "skills/*/SKILL.md",
  "expand": true
}
```

The build splits this into one skill per matching `SKILL.md`. Each becomes its own entry in the manifest.

## Build script reference

```bash
bun run build                    # build to dist/
bun run build -- --out=public    # custom output dir
GITHUB_TOKEN=ghp_xxx bun run build   # higher GitHub rate limit
```

The build is **idempotent** — running it twice produces the same `dist/` (modulo timestamps in the manifest). It downloads from GitHub's public API, which is rate-limited to 60 requests/hour/IP. Set `GITHUB_TOKEN` to lift to 5000/hour.

## What `dist/` looks like

After `bun run build`:

```
dist/
├── manifest.json
├── skills/
│   ├── frontend-design/
│   │   ├── SKILL.md
│   │   └── assets/...
│   ├── impeccable/
│   │   └── SKILL.md
│   └── web-design-guidelines/
│       └── SKILL.md
└── bundles/
    ├── frontend-design.zip
    ├── frontend-design.zip.sha256
    ├── impeccable.zip
    ├── impeccable.zip.sha256
    ├── web-design-guidelines.zip
    └── web-design-guidelines.zip.sha256
```

`manifest.json` shape:
```json
{
  "generated_at": "2026-07-17T20:00:00.000Z",
  "count": 3,
  "skills": [
    {
      "name": "frontend-design",
      "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
      "ref": "main",
      "file_count": 5,
      "bundle_size": 12345,
      "sha256": "abc123...",
      "bundle_path": "/bundles/frontend-design.zip",
      "skills_path": "/skills/frontend-design/"
    }
  ]
}
```

## Kilo CLI integration

Copy `.kilo/plugin/refresh-skills.ts` from this repo into any consumer project, set `SKILLS_BASE` to your deployed URL, and reference it in `kilo.jsonc`. The plugin:

1. Fetches `manifest.json` on `session.created`
2. Compares each skill's `sha256` to a cached version in `~/.config/kilo/.skill-state/`
3. If unchanged, skips
4. Otherwise downloads `<bundle_path>` and extracts to `~/.config/kilo/skills/<name>/`

Debounced to 1 hour by default. Force a refresh:

```bash
rm -rf ~/.config/kilo/.skill-state
```

## Refresh strategy

The static build means skills only update on rebuild. Pick a refresh approach:

- **Manual** — `bun run build && deploy` whenever you want
- **On `skills_list.json` change** — push to git, CF Pages auto-rebuilds
- **Nightly cron** — schedule `bun run build` via cron, GitHub Action, or CF Worker
- **Per-skill schedule** — pin `ref` to tags, only bump when you want an update

For most use cases, "rebuild on push" + a weekly cron is plenty.

## Deployment recipes

### Cloudflare Pages (no wrangler)

**Method 1: Dashboard**
1. Cloudflare dashboard → Workers & Pages → Create → Pages → Upload assets
2. Zip `dist/` and drop it
3. Get a `*.pages.dev` URL

**Method 2: API (CI)**
```bash
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$PROJECT/deployments" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "directory=./dist"
```

**Method 3: Git-integrated (most "set and forget")**
1. Push this repo to GitHub
2. Cloudflare Pages → Create → Connect to Git
3. Build command: `bun run build`
4. Build output: `dist`
5. Save. Every `git push` auto-rebuilds and deploys.

### GitHub Pages

```bash
cp -r dist/* ../username.github.io/
cd ../username.github.io
git add . && git commit -m "skills" && git push
```

### Netlify

```bash
netlify deploy --dir=dist --prod
```

### Vercel

```bash
vercel deploy dist --prod
```

### Local file server (testing)

```bash
cd dist && python3 -m http.server 8000
# Visit http://localhost:8000/manifest.json
```

### Any static host

The output is just files. If it can serve `index.html`, it can serve this.

## Troubleshooting

### "GitHub API 403 rate limit exceeded" (or "raw.githubusercontent.com 403")

GitHub blocks unauthenticated requests aggressively — both the Contents API and the raw file fetches. You'll see 403s either way. The build script handles them gracefully and writes the failure to the manifest as an `error` field, so your build doesn't break; you just don't get that skill.

Fix:

```bash
# 1. Create a GitHub PAT: https://github.com/settings/tokens/new
#    No scopes needed for public repos
# 2. Re-run the build with the token
GITHUB_TOKEN=ghp_your_personal_access_token bun run build
```

With a token: 5000 API calls/hour. Without: often blocked entirely on shared/cloud IPs. The `example` config in this repo uses 2 skills that work even on a restricted IP because we list their files explicitly (bypassing the Contents API); add a token to use the `auto-discover` form.

### Build fails on a specific skill

The build continues past failures. Check `dist/manifest.json` — failed skills appear with an `error` field:

```json
{ "name": "broken-skill", "url": "...", "error": "GitHub API 404" }
```

### "Skill X not found" in Kilo

The plugin's `SKILLS_BASE` doesn't match your deployed URL. Check both:

```bash
curl https://your-url/manifest.json | grep '"name"'
grep SKILLS_BASE .kilo/plugin/refresh-skills.ts
```

### Bundle zip is empty or corrupt

Check the source URL — if the `tree` path is wrong, the directory listing returns 404 and the bundle is empty. Test with the explicit `files` form:

```json
{
  "name": "weird-skill",
  "url": "https://github.com/owner/repo/tree/main",
  "files": ["SKILL.md", "assets/x.md"]
}
```

### Path with special characters

The build script sanitizes file paths. If a skill has `..` in any path, it's skipped during extraction (defense in depth — also blocked in the Kilo plugin).

## Migration from the Workers version

If you used the previous Functions-based design:

1. Delete the `functions/` directory
2. Delete `wrangler.toml` (no longer needed)
3. Delete `_headers` (CF Pages default headers are fine)
4. Add `build.ts` and `package.json`
5. Update `.kilo/plugin/refresh-skills.ts` to fetch from `/manifest.json` and `/bundles/<name>.zip` instead of `/api/...`
6. The manifest format is nearly identical — `bundle_path` changed from `/api/skills/<name>/bundle` to `/bundles/<name>.zip`

## What's in this example

The `dist/` in this repo was actually built — it contains real working bundles for two skills:

- **`frontend-design`** — Anthropic's anti-AI-slop frontend design skill (2 files, 7.7KB bundle)
- **`web-design-guidelines`** — Vercel's UI audit skill (1 file, 0.7KB bundle)

You can inspect the built artifacts:

```bash
cat dist/manifest.json
ls dist/skills/frontend-design/
unzip -l dist/bundles/frontend-design.zip
open dist/index.html   # a tiny landing page
```

A third example skill (impeccable by pbakaus) is commented out in `skills_list.json` because it requires a GitHub token to fetch (the file paths aren't easily guessable from the public listing). To add it back, set `GITHUB_TOKEN` and uncomment the entry.

## Why static beats Workers for this use case

- **Cost** — zero per-request. CF Pages free tier handles the whole site.
- **Speed** — no Worker cold start, no compute, just edge-cached file delivery.
- **Simplicity** — no Functions runtime, no env vars, no secrets to manage.
- **Portability** — deploy to any static host. Vendor the `dist/` if you want.
- **Limits** — no 10MB Worker response limit, no Worker CPU limits, no concurrent execution caps.

The only thing you give up is "always live" — skills only update when you rebuild. For most teams, that's a feature, not a bug.

## Maintainer handoff notes

- **Only file to edit is `skills_list.json`.** Everything else is generated.
- **Rebuild + redeploy** is the only maintenance step. Automate it however you like.
- **`dist/` is build output.** Commit it for direct-upload workflows; gitignore it for git-integrated CF Pages builds.
- **The Kilo plugin is meant to be copied to consumer projects.** Don't try to centralize it.
- **No secrets in the build output.** Token is only used during the build, never embedded.

## License

MIT. The skills you host have their own licenses — respect them.
