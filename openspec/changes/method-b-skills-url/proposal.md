## Why

The current my-skills plugin distributes skill files via a Bun tarball URL with version-bumped filenames (`my-skills-1.0.0.tgz`, `my-skills-1.0.1.tgz`, ...). Every content change requires a version bump, which forces every consumer to update their `kilo.jsonc` URL. The user wants to add skills without bumping versions, and wants the same plugin to work on both OpenCode and Kilo Code (OpenCode has no `skills.urls` support, ruling out Option A from earlier analysis).

## What Changes

- **Restructure source layout**: move skill files from `skills_list.json` (manifest + GitHub URLs) into a real `skills/<name>/<file>` tree in the repo, with a top-level `skills.json` manifest.
- **Rewrite plugin fetch logic**: plugin no longer bundles `skills_list.json`. Instead, on each session it fetches `<SKILLS_BASE>/skills.json` then fetches each skill's files from `<SKILLS_BASE>/skills/<name>/<file>`. Plugin code itself is small and rarely changes.
- **Update build script**: `npm run build` produces a tarball containing only the plugin code (no skills data), AND copies the `skills/` directory + `skills.json` into `dist/` so CF Pages serves them at stable URLs.
- **Update deploy workflow**: `wrangler pages deploy dist --project-name my-skills` (or drag-and-drop) ships both the plugin tarball and the skills content in one deploy. The plugin tarball URL stays `my-skills-1.0.0.tgz` forever (only bumped when plugin code itself changes).
- **Remove GitHub Contents API calls**: plugin no longer calls GitHub to list/fetch skill files — it fetches them directly from the user's CF Pages deployment. This eliminates the GitHub rate-limit issue that motivated `GITHUB_TOKEN` and the `files: [...]` explicit list workaround.

**BREAKING**: existing consumers with `kilo.jsonc` pinned to `my-skills@https://my-skills-atd.pages.dev/my-skills-1.0.1.tgz` will need to either upgrade to a new plugin tarball (the URL stays the same; only the plugin code changes) OR continue using the old tarball (which still works but won't get content updates).

## Capabilities

### New Capabilities

- `skills-remote-fetch`: plugin fetches `skills.json` and skill files from a configurable remote base URL on every session, instead of relying on bundled manifest + GitHub API.

### Modified Capabilities

(none — no existing specs in `openspec/specs/`)

## Impact

- **Source layout**: new `skills.json` and `skills/<name>/<file>` directories replace the inline `skills_list.json` (deleted). Each skill's content lives in-repo, not referenced from public GitHub.
- **Plugin code** (`src/plugin.ts`, `src/lib.ts`): `listGitHubDir`, `parseGitHub`, `deriveName` removed. New `fetchManifest()` and `syncSkillFromUrl()` functions added. `contentHash`, `isSafePath`, `matchGlob`, `filterFiles` kept.
- **`package.json`**: `files` whitelist updated from `["src", "skills_list.json", "README.md"]` to `["src", "skills", "skills.json", "README.md"]`. Build script gets a `copy-skills` step that mirrors `skills/` and `skills.json` into `dist/`.
- **CF Pages content**: gains `skills.json` + `skills/<name>/*` paths alongside the plugin tarball.
- **Consumers**: zero change required if they already pin a working plugin URL. The plugin transparently picks up new skills on next session.
- **No new dependencies**: plugin uses `fetch` (already in Bun/Node), `node:fs`, `node:path`, `node:crypto` — all standard library.