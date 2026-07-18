## Context

The current my-skills plugin bundles a `skills_list.json` manifest in the tarball. When the user adds or modifies skills, they must:
1. Edit `skills_list.json`
2. `npm version patch` (to change the tarball URL)
3. `npm run build`
4. `wrangler pages deploy`
5. Update `kilo.jsonc` URL on every consumer machine

Step 5 is the friction point: every consumer must touch their config to receive updates. The user wants to add skills without touching any consumer's `kilo.jsonc`. They also want this to work on both Kilo Code and OpenCode.

The "Method B" architecture (chosen after comparison with Method A) addresses this by:
- Hosting skill files directly on CF Pages alongside the plugin tarball
- Having the plugin fetch `skills.json` + skill files from a stable URL at runtime
- Decoupling skill content updates from plugin code changes

## Goals / Non-Goals

**Goals:**
- Content updates deploy with zero URL changes in any consumer config
- Plugin works on both OpenCode and Kilo Code (no Kilo-only features)
- Each skill update ships independently without rebuilding the plugin tarball
- Drag-and-drop OR GitHub-push deploys both work
- Tarball URL stays at `my-skills-1.0.0.tgz` forever (only re-versioned if plugin code itself changes)

**Non-Goals:**
- Per-skill authorization or access control (anyone with the URL gets all skills)
- Hot-reloading skills mid-session without a session restart (the user accepts that `/reload` or a new session is required to pick up new skills)
- Removing the plugin entirely (Option A was rejected because OpenCode doesn't support `skills.urls`)
- Maintaining backward compatibility with the old plugin tarball that uses GitHub API

## Decisions

### Decision 1: Two distinct URLs in CF Pages, one in kilo.jsonc

The plugin tarball lives at `my-skills-1.0.0.tgz` (set in `kilo.jsonc`). The skills content lives at `<SKILLS_BASE>/skills.json` and `<SKILLS_BASE>/skills/<name>/<file>` (encoded in the plugin source).

**Why**: the tarball URL is the only thing consumers must pin. Once it's correct, skill content can change freely without any consumer config update.

**Alternatives considered**:
- *Single URL serving both tarball and skills* — would require consumers to know about both, defeating the purpose
- *Plugin fetches its own tarball at runtime (Method A)* — works but requires tarball extraction code (~30 lines + fflate dep). Less clean than separate URLs.

### Decision 2: Plugin fetches at runtime, not via Bun's install path

The plugin uses `fetch()` (standard HTTP) rather than reading from the tarball it was installed from.

**Why**: Bun's tarball install caches by URL. To get fresh content, the plugin must use a code path that respects HTTP cache headers. `fetch()` does; Bun's install cache does not.

**Implementation**: `fetch(SKILLS_BASE + '/skills.json')` with `cache: 'no-store'` ensures every session reads fresh.

### Decision 3: `skills.json` manifest format

```json
{
  "skills": [
    { "name": "frontend-design", "files": ["SKILL.md", "LICENSE.txt"] },
    { "name": "web-design-guidelines", "files": ["SKILL.md"] }
  ]
}
```

**Why**: simpler than the old `skills_list.json` which supported include/exclude globs and GitHub tree URLs. We no longer need URL parsing, deriveName, or GitHub-specific code paths because everything is on CF Pages now.

**Trade-off**: lost the ability to reference skills from public GitHub repos (the old plugin used `https://github.com/anthropics/skills/tree/main/skills/frontend-design` and called GitHub's API). Users who want to ship skills from public repos must copy the files into their own `skills/` directory.

### Decision 4: Plugin keeps small, well-bounded helpers

The new `src/plugin.ts` is ~150 lines: the manifest fetch + the per-skill fetch loop + the state-management calls. `src/lib.ts` keeps `contentHash`, `isSafePath`, `matchGlob`, `filterFiles` for reuse but drops `parseGitHub`, `deriveName`, `listGitHubDir`.

**Why**: smaller files are easier to reason about; each helper has one clear purpose. The removed functions have a single caller each (the sync loop), so inlining is fine.

### Decision 5: Build script adds a copy step

```json
{
  "scripts": {
    "build": "npm run clean && npm run pack && npm run copy-skills",
    "pack": "mkdir -p dist && npm pack --pack-destination dist",
    "copy-skills": "mkdir -p dist/skills && cp -R skills/. dist/skills/ && cp skills.json dist/skills.json",
    "clean": "rm -rf dist"
  }
}
```

**Why**: `dist/` becomes a complete deployable unit — `wrangler pages deploy dist` ships everything (plugin tarball + skills content) in one go. No separate deploy steps.

## Risks / Trade-offs

- **CDN edge cache might serve stale `skills.json`** → Mitigation: CF Pages invalidates the edge on each deployment, but if stale content is observed, force-refresh via the dashboard's "Purge cache" button.

- **`SKILLS_BASE` is hardcoded in the plugin source** → Mitigation: read from `MY_SKILLS_BASE_URL` env var or `base_url` plugin option. Default to `https://my-skills-atd.pages.dev`. If the domain ever changes, consumers need to bump the plugin version (rare).

- **Per-session network fetches add latency** → Mitigation: CF Pages edge is typically <100ms. The `skills.json` payload is <1KB. Total sync time stays well under 1 second for typical skill counts.

- **Plugin becomes useless if the skills URL goes offline** → Mitigation: graceful failure (logged warning, no crash). Consumer can still use other plugins and skills.

- **Lost feature: skills can no longer reference public GitHub repos directly** → Mitigation: skill authors can copy files into their own repo. This is a feature regression for some users but acceptable given the simpler model.

## Migration Plan

1. Merge `feat/method-b-skills-url` to main.
2. Deploy via `wrangler pages deploy dist --project-name my-skills` (or fix the CF Pages GitHub integration to auto-deploy).
3. Existing consumers continue to work with no config change — the plugin tarball URL stays the same; new code transparently fetches from the new `skills.json` URL.
4. Old `skills_list.json` is removed; any consumer who needs the old behavior must downgrade to a pinned version (`my-skills-1.0.1.tgz`).

Rollback: if the new architecture fails for some users, they can pin their kilo.jsonc URL to `my-skills-1.0.1.tgz` (the last old-style version) and skip upgrades. The old tarball stays live at that URL.

## Open Questions

- Should we add a `force_refresh` env var to bust the state hash and force a re-write even when content is unchanged? Useful for debugging. Currently out of scope.
- Should `skills.json` support `include_glob` / `exclude` filters for advanced users? Lost in the simplification. Can be added back later if needed.