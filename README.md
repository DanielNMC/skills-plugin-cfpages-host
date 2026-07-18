# my-skills

`my-skills` distributes a Kilo plugin through Cloudflare Pages and syncs skills from URLs in a remote manifest. Skill-content updates change the source or manifest; plugin-code updates change the versioned tarball.

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
  ]
}
```

The consumer URL stays at `1.0.1` for content updates. Change it only when plugin code changes.

## How a request flows

```text
Maintainer
  edit skills.json
        |
        v
  npm run deploy
        |
        +--------------------+--------------------+------------------+
        |                    |                    |
        v                    v                    v
  wrangler deploy      drag dist/ in CF     push origin/main
        |                    |                    |
        +--------------------+--------------------+
                             |
                             v
Cloudflare Pages: https://my-skills-atd.pages.dev
  /my-skills-1.0.1.tgz
  /skills.json
  /skills/<name>/<file>      legacy copies
                             |
                             v
Consumer starts or idles a Kilo session
  session.created / session.idle
                             |
                             v
Plugin GETs SKILLS_BASE/skills.json
                             |
                             v
For each entry: parseSource(entry.url) -> buildFileURL(...)
        |
        +-- GitHub folder/raw URL -> raw.githubusercontent.com -> fetch
        |
        +-- Other hostname -> <base>/skills/<name>/<file> -> fetch
                             |
                             v
SHA-256 compare -> write changes -> prune removed skills
  ~/.config/kilo/skills/<name>/<file>
  ~/.config/kilo/.skill-state/<name>.hash
```

The current manifest points to GitHub folders. Pages serves the manifest and plugin; the plugin fetches skill content from raw GitHub URLs. `dist/skills/` is legacy output not selected by the current manifest.

---

## 1. Configure with Kilo Code

### Config locations

| Scope | Path |
|---|---|
| Global XDG location | `~/.config/kilo/kilo.jsonc` |
| Project root | `./kilo.jsonc` |
| Project config directory | `./.kilo/kilo.jsonc` |

Kilo documentation states that `.kilo/kilo.jsonc` takes priority when both project forms exist.

### Plugin entry

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
  ]
}
```

The Bun tarball specifier is `<package-name>@https://<host>/<package-name>-<version>.tgz`. Kilo installs the package and dependencies, then loads `./src/plugin.ts`, which exports `MySkills`.

### Plugin options

Use Kilo's plugin tuple form:

```jsonc
{
  "plugin": [
    [
      "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz",
      { "refresh_ms": 1800000, "disabled": false }
    ]
  ]
}
```

| Option | Type | Default | Behavior |
|---|---|---:|---|
| `refresh_ms` | number | `3600000` | Minimum milliseconds between successful runs in one plugin instance. `0` checks every hook. |
| `disabled` | boolean | `false` | `true` makes every sync hook return without fetching. |

### Environment variables

| Variable | Default | Behavior |
|---|---|---|
| `MY_SKILLS_REFRESH_MS` | `3600000` | Converted with `Number()` when `refresh_ms` is absent. |
| `MY_SKILLS_DISABLED` | unset | Exact value `1` disables sync when `disabled` is absent. |
| `MY_SKILLS_BASE_URL` | `https://my-skills-atd.pages.dev` | Base used to fetch `/skills.json`. |

Explicit options take precedence over environment values. `MY_SKILLS_BASE_URL` is read by `src/lib.ts`; it is not a plugin option.

### Verify

```bash
curl -fsS https://my-skills-atd.pages.dev/skills.json
```

Start a Kilo session and ask `What skills can you load?`. Synced files appear under `~/.config/kilo/skills/`.

---

## 2. Add a new skill

This is the normal content workflow. Do not bump the package version.

### Step 1: choose the source

A skill needs a safe name, a GitHub folder URL or non-GitHub base URL, a literal file list, and anonymous HTTP access to every resulting URL.

GitHub folder form:

```text
https://github.com/<owner>/<repo>/tree/<ref>/<path-to-skill>
```

Static-host form; the host must serve this path:

```text
<base>/skills/<name>/<file>
```

### Step 2: edit `skills.json`

```json
{
  "skills": [
    {
      "name": "frontend-design",
      "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
      "files": ["SKILL.md", "LICENSE.txt"]
    },
    {
      "name": "new-skill",
      "url": "https://github.com/example/skills/tree/main/skills/new-skill",
      "files": ["SKILL.md"]
    }
  ]
}
```

`files` contains filenames, not nested paths. The plugin rejects empty values, names that do not start with a letter, `..`, `/`, `\`, and null bytes.

### Step 3: build

```bash
npm run deploy
```

Or, on macOS:

```bash
npm run deploy:open
```

`deploy` builds `dist/` but does not upload. `deploy:open` builds the same directory and opens it in Finder.

### Step 4: deploy

| Path | Command or action |
|---|---|
| Wrangler CLI | `npm run deploy && wrangler pages deploy` |
| Drag-and-drop | Run `npm run deploy:open`, then drag `dist/` to the `my-skills` Pages project. |
| Git integration | Commit `skills.json` and push `origin main`. |

### Step 5: consumer pickup

No version bump, consumer config change, or extra restart is needed beyond the next session start. The plugin reads the manifest on the next eligible `session.created` or `session.idle` run; the default in-process debounce is one hour.

If only an existing remote file changes, no registry rebuild is needed. The plugin fetches it again on its next eligible sync.

### Add another static source target

Set an entry's `url` to the new base:

```json
{
  "name": "new-skill",
  "url": "https://skills-example.pages.dev",
  "files": ["SKILL.md"]
}
```

It must serve `https://skills-example.pages.dev/skills/new-skill/SKILL.md`. Any hostname except `github.com` and `raw.githubusercontent.com` uses base-URL semantics; no plugin change is required.

---

## 3. Update plugin code

Use this workflow only when `src/plugin.ts` or `src/lib.ts` changes.

### Step 1: edit and verify

```bash
bun run scripts/parse-source-test.ts
npx tsc --noEmit
```

### Step 2: bump the version

```bash
npm version patch
```

The version becomes part of `my-skills-X.Y.Z.tgz`, giving consumers a new download URL. The command updates `package.json` and `package-lock.json`.

With npm's current `git-tag-version=true`, the default command requires a clean worktree and creates a version commit and tag. Commit source edits first. For an intentional local uncommitted build:

```bash
npm version patch --no-git-tag-version
```

### Step 3: build and deploy

```bash
npm run deploy
```

Deploy `dist/` through Wrangler, drag-and-drop, or Git integration.

### Step 4: update consumers

```diff
-"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
+"my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.2.tgz"
```

Manifest-only and skill-content changes do not perform this step.

---

## 4. Deploy workflow

The Pages project is `my-skills`, its production domain is `my-skills-atd.pages.dev`, and Cloudflare reports a connected Git provider.

### Wrangler CLI

```bash
npm run deploy && wrangler pages deploy
```

Use for scripted deployment. `wrangler.toml` supplies the project name and output directory, so no `--project-name` or positional `dist` argument is needed. This path requires Wrangler authentication and no Git push.

### Drag-and-drop

```bash
npm run deploy:open
```

This builds and runs `open dist`. Drag `dist/` to the `my-skills` project in the Pages dashboard. It needs no Wrangler CLI authentication.

### Git push

```bash
git add skills.json
git commit -m "feat: add new skill"
git push origin main
```

Use when the connected Pages Git integration should build and deploy the commit.

### Why `wrangler.toml` exists

It keeps the Pages project name, output directory, compatibility date, and build command in source control. Cloudflare treats a deployed Wrangler configuration as the Pages configuration source of truth, reducing drift between direct and Git-connected deployments.

```toml
name = "my-skills"
pages_build_output_dir = "dist"
compatibility_date = "2024-01-01"

[build]
command = "npm run build"
```

### Verify after deployment

```bash
curl -fsS https://my-skills-atd.pages.dev/skills.json
curl -fsSI https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz
```

Then start a Kilo session and ask which skills are available.

---

## 5. Configuration reference

### Consumer `kilo.jsonc`

```jsonc
{
  "plugin": [
    "my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz"
  ]
}
```

The full package URL is the code cache key. Keep it stable for content changes; update it after a plugin version bump.

### `package.json`

| Field | Current value | Purpose |
|---|---|---|
| `name` | `my-skills` | Package and tarball prefix. |
| `version` | `1.0.1` | Tarball filename version. |
| `type` | `module` | ES module mode. |
| `main`, `exports["."]` | `./src/plugin.ts` | Package entry. |
| `opencode.plugin`, `kilocode.plugin` | `./src/plugin.ts` | Plugin metadata entries. |
| `files` | `src`, `skills`, `skills.json`, `README.md` | `npm pack` whitelist. |
| `dependencies` | `@kilocode/plugin: latest` | Runtime dependency. |
| `devDependencies` | `@types/bun`, `typescript` | Bun typing and TypeScript checks. |
| `engines` | Bun `>=1.3.0`, Node `>=22.0.0` | Declared runtime floors. |
| `license` | `MIT` | Plugin package license. |

| Script | Exact command | Result |
|---|---|---|
| `build` | `npm run clean && npm run pack && npm run copy-skills` | Recreates deployment output. |
| `clean` | `rm -rf dist` | Removes prior output. |
| `pack` | `mkdir -p dist && npm pack --pack-destination dist` | Creates `dist/my-skills-X.Y.Z.tgz`. |
| `copy-skills` | `mkdir -p dist/skills && cp -R skills/. dist/skills/ && cp skills.json dist/skills.json` | Copies manifest and legacy local skills. |
| `deploy` | `npm run build` | Builds only. |
| `deploy:open` | `npm run build && open dist` | Builds and opens Finder on macOS. |
| `dev` | `bun run src/plugin.ts` | Executes the plugin module. |

The current tarball contains `package.json`, `README.md`, `skills.json`, `src/`, and legacy `skills/` files.

### `wrangler.toml`

| Key | Value | Purpose |
|---|---|---|
| `name` | `my-skills` | Pages project name. |
| `pages_build_output_dir` | `dist` | Published directory. |
| `compatibility_date` | `2024-01-01` | Cloudflare runtime compatibility date. |
| `build.command` | `npm run build` | Pages build command. |

### `skills.json`

```json
{
  "skills": [
    {
      "name": "frontend-design",
      "url": "https://github.com/anthropics/skills/tree/main/skills/frontend-design",
      "files": ["SKILL.md", "LICENSE.txt"]
    }
  ]
}
```

| Field | Type | Required | Runtime use |
|---|---|---|---|
| `skills` | array | yes | Entries processed sequentially. |
| `name` | string | yes | Target directory and state filename. |
| `url` | string URL | yes | Input to `parseSource()`. |
| `files` | string array | yes | Exact filenames fetched and written. |

The manifest comes from `${SKILLS_BASE}/skills.json`. Invalid top-level data returns `null`; invalid entries are logged and skipped. Only `name`, `url`, and `files` are consumed by `syncSkill()`.

### `src/lib.ts`

```ts
export const SKILLS_BASE =
  process.env.MY_SKILLS_BASE_URL || "https://my-skills-atd.pages.dev"
```

| Export | Purpose |
|---|---|
| `readManifest()` | Fetches `${SKILLS_BASE}/skills.json` with `cache: "no-store"`. |
| `parseSource(url)` | Classifies GitHub URLs or static-host bases. |
| `buildFileURL(source, name, file)` | Builds one file URL. |
| `isSafePath(path)` | Validates names and filenames. |
| `contentHash(files)` | Computes SHA-256 for fetched files. |

`matchGlob()` and `filterFiles()` exist but `src/plugin.ts` does not call them.

### Options and environment precedence

```text
refresh_ms -> MY_SKILLS_REFRESH_MS -> 3600000
disabled   -> MY_SKILLS_DISABLED === "1" -> false
MY_SKILLS_BASE_URL -> https://my-skills-atd.pages.dev
```

Options use nullish precedence, so explicit `0` and `false` are preserved.

### Other repository config

- `tsconfig.json`: ES2022, ES modules, bundler resolution, strict checks, Bun types, and `src/**/*.ts` only. Used by `npx tsc --noEmit`; TypeScript source ships directly.
- `package-lock.json`: locks the npm dependency graph. `npm version patch` updates its root version with `package.json`.
- `.gitignore`: excludes `node_modules/`, `dist/`, `.DS_Store`, `._*`, `.env`, `.env.local`, `*.log`, and `.wrangler/`.

---

## 6. Technical reference

### File layout

```text
Repository                         Cloudflare Pages
my-skills/                         https://my-skills-atd.pages.dev/
├── package.json                   ├── my-skills-1.0.1.tgz
├── package-lock.json              ├── skills.json
├── skills.json                    └── skills/<name>/<file>  legacy
├── tsconfig.json
├── wrangler.toml                  Consumer
├── src/                           ~/.config/kilo/
│   ├── plugin.ts                  ├── kilo.jsonc
│   └── lib.ts                     ├── skills/<name>/<file>
├── scripts/                       └── .skill-state/<name>.hash
│   ├── integration-test.ts
│   └── parse-source-test.ts
├── skills/  legacy local copies
└── dist/    generated output
```

The tarball wraps files under `package/` and includes `package.json`, `README.md`, `skills.json`, `src/`, and `skills/`. The plugin uses `homedir()` and fixed `.config/kilo` paths for synchronized files and state.

### Plugin lifecycle

`MySkills(_ctx, options)` computes `refreshMs` and `disabled`, then returns `session.created` and `session.idle` hooks. Both call the same debounced `run()`.

```text
hook -> run()
  -> disabled / refresh window / in-flight guard
  -> readManifest()
  -> for each entry: syncSkill()
       -> validate name and files
       -> parseSource(url)
       -> build and fetch each file URL, no-store
       -> hash successful fetches
       -> compare state hash
       -> replace changed skill directory and hash
  -> prune state names absent from manifest
  -> record lastRefresh
```

Entries and files are sequential. A failed manifest does not advance `lastRefresh`. File failures are logged. If all files fail, the existing entry remains; if some succeed, that subset can replace the target directory.

### Content hashing

`contentHash()` sorts filenames, then concatenates each UTF-8 filename directly with its bytes and computes SHA-256:

```text
SHA-256(filename-1 || content-1 || filename-2 || content-2 || ...)
```

| State | Action |
|---|---|
| Hash missing or different | Remove target directory, write fetched files, save lowercase hex hash. |
| Hash equal | Skip filesystem writes. |
| State name absent from manifest | Delete its hash and skill directory. |

### `parseSource()` and `buildFileURL()`

| Hostname | Kind | Behavior |
|---|---|---|
| `github.com` | `github` | Parse owner, repo, ref, and path from tree, blob, or ref-style URL. |
| `raw.githubusercontent.com` | `github` | Parse owner, repo, ref, and remaining path. |
| Any other hostname | `cf` | Keep the URL as a base and remove one trailing slash. |

GitHub example:

```text
https://github.com/anthropics/skills/tree/main/skills/frontend-design
  -> https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md
```

If a GitHub blob/raw path ends in the requested filename, that segment is removed before appending the filename. Prefer folder URLs for entries with multiple files.

Static-host example:

```text
https://my-skills-atd.pages.dev + frontend-design + SKILL.md
  -> https://my-skills-atd.pages.dev/skills/frontend-design/SKILL.md
```

Non-root bases are preserved: `https://example.com/registry` becomes `https://example.com/registry/skills/<name>/<file>`.

### Cloudflare Pages deploy model

```text
npm run build
  -> clean: rm -rf dist
  -> pack: npm pack --pack-destination dist
       -> dist/my-skills-X.Y.Z.tgz
  -> copy-skills
       -> dist/skills.json
       -> dist/skills/<name>/<file>
```

Pages publishes `dist/`. Wrangler, dashboard upload, and Git integration deploy the same artifact model. The copied skill tree remains legacy output because current manifest URLs point to GitHub.

### Cache layers

| Layer | Cached object | Update rule |
|---|---|---|
| Kilo/Bun install | Plugin tarball and dependencies | Full plugin specifier, including tarball URL. |
| Runtime sync | Manifest and source responses | `cache: "no-store"`, `refresh_ms`, and per-skill hash. |

Content changes need no tarball update. Code changes need a new tarball filename and consumer URL.

### Security model

- The current GitHub origin is public. The Pages deployment is public.
- The architecture can use a private registry repository if Cloudflare Git integration can read it, but that is not the current repository visibility.
- Manifest source URLs must be anonymously fetchable; the runtime has no source-host credential setting.
- The tarball contains only the `npm pack` whitelist. `.env` files are not packed.
- Never place secrets in `README.md`, `skills.json`, `src/`, or `skills/`; Pages makes packed and copied output downloadable.

### Troubleshooting

#### Skills do not load

1. Confirm the consumer tarball URL and deployed manifest.
2. Check `disabled`, `MY_SKILLS_DISABLED`, and the one-hour default refresh window.
3. Inspect `~/.config/kilo/skills/` and `~/.config/kilo/.skill-state/`.
4. Start a session and ask which skills are available.

```bash
curl -fsS https://my-skills-atd.pages.dev/skills.json
```

If a hash exists but its skill directory was manually removed, delete that skill's hash before syncing; an equal hash skips writes.

#### Source parsing or fetch fails

Use `https://github.com/<owner>/<repo>/tree/<ref>/<folder>` for GitHub folders. Confirm every computed raw URL, or every static `<base>/skills/<name>/<file>` URL, returns success. Filenames are case-sensitive.

A partial fetch is important: if one file succeeds, the successful subset can replace the local directory.

#### Git integration does not build

1. Confirm the Pages project is connected to the Git provider and `main` is the production branch.
2. Confirm root `wrangler.toml` has `command = "npm run build"` and `pages_build_output_dir = "dist"`.
3. Run `npm run deploy` locally.
4. Inspect the Cloudflare build log for the failing install, build, or upload step.

#### Deployed content is stale

Compare production `/skills.json` with local `dist/skills.json`. Runtime requests use `cache: "no-store"`; remaining delay comes from `refresh_ms`, source failure, or publishing the wrong `dist/`.

### Maintainer checklist

#### Skill or manifest change

- [ ] Add or update `name`, `url`, and `files` in `skills.json`.
- [ ] Confirm each computed source URL.
- [ ] Run `npm run deploy` and inspect `dist/skills.json`.
- [ ] Deploy through Wrangler, drag-and-drop, or Git push.
- [ ] Verify production with `curl` and a Kilo session.
- [ ] Do not bump the plugin version or change consumer config.

#### Plugin-code change

- [ ] Edit the required `src/*.ts` files.
- [ ] Run `bun run scripts/parse-source-test.ts` and `npx tsc --noEmit`.
- [ ] Commit source edits, then run `npm version patch`.
- [ ] Run `npm run deploy` and confirm the new tarball filename.
- [ ] Deploy, verify the tarball URL, and update consumer configs.

#### Release hygiene

- [ ] Keep `wrangler.toml`, `package.json`, `skills.json`, and this README consistent.
- [ ] Keep secrets outside packed and copied paths.
- [ ] Keep `dist/`, local environment files, and Wrangler state untracked.
- [ ] Preserve upstream license files in `files` when required.
