## 1. Source layout migration

- [ ] 1.1 Create `skills/` directory at repo root
- [ ] 1.2 Create `skills/frontend-design/SKILL.md` with proper frontmatter (name + description)
- [ ] 1.3 Create `skills/frontend-design/LICENSE.txt` (verbatim from upstream anthropics/skills)
- [ ] 1.4 Create `skills/web-design-guidelines/SKILL.md` with proper frontmatter
- [ ] 1.5 Create `skills/animation-vocabulary/SKILL.md` with proper frontmatter
- [ ] 1.6 Create `skills.json` at repo root with `{ "skills": [ ... ] }` manifest listing all three skills
- [ ] 1.7 Delete `skills_list.json` (replaced by `skills.json` + `skills/`)

## 2. Plugin source rewrite (TDD)

- [ ] 2.1 Write failing integration test `scripts/integration-test.ts` that starts a local Bun HTTP server mocking the skills URL, invokes the plugin, asserts the skills appear at the correct disk paths
- [ ] 2.2 Verify the test fails (RED): assert it errors out because the new plugin code doesn't exist yet
- [ ] 2.3 Rewrite `src/plugin.ts` to fetch `skills.json` from `SKILLS_BASE`, iterate skills, fetch each file, write to disk
- [ ] 2.4 Rewrite `src/lib.ts`: remove `parseGitHub`, `deriveName`, `listGitHubDir`; keep `contentHash`, `isSafePath`, `matchGlob`, `filterFiles`; add new `SKILLS_BASE` constant + `readManifest` helper
- [ ] 2.5 Update `package.json` `files` whitelist to `["src", "skills", "skills.json", "README.md"]`
- [ ] 2.6 Verify the integration test passes (GREEN)

## 3. Build pipeline

- [ ] 3.1 Update `package.json` build script: `npm run clean && npm run pack && npm run copy-skills`
- [ ] 3.2 Add `copy-skills` step that copies `skills/` → `dist/skills/` and `skills.json` → `dist/skills.json`
- [ ] 3.3 Run `npm run build` and verify `dist/` contains: tarball, `skills.json`, `skills/<name>/*`
- [ ] 3.4 Inspect tarball contents to confirm only `package/{package.json,src/,skills/,skills.json,README.md}` are bundled

## 4. End-to-end verification

- [ ] 4.1 Direct-deploy `dist/` to CF Pages: `wrangler pages deploy dist --project-name my-skills`
- [ ] 4.2 Verify deployed `skills.json` matches local
- [ ] 4.3 Download a deployed skill file and confirm byte-identical to local
- [ ] 4.4 Re-run integration test pointing at the deployed CF Pages URL (real network) — confirms the plugin works against the real CDN
- [ ] 4.5 Confirm all three skills appear at `~/.config/kilo/skills/<name>/SKILL.md`

## 5. Documentation

- [ ] 5.1 Update README to reflect new architecture: source layout, build/deploy workflow, plugin behavior
- [ ] 5.2 Remove references to `skills_list_path`, GitHub tokens, GitHub rate limits
- [ ] 5.3 Add a "How to add a skill" section with the simplified drag-and-drop flow

## 6. Commit + push branch

- [ ] 6.1 Stage all changes (`git add -A`)
- [ ] 6.2 Commit with message matching repo style: `feat: switch plugin to remote skills.json fetch`
- [ ] 6.3 Push branch to origin (`git push origin feat/method-b-skills-url`)
- [ ] 6.4 Verify CF Pages auto-build (if GH integration is configured) OR document manual deploy steps