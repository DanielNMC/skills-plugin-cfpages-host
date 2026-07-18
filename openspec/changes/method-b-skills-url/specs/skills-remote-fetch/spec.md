## ADDED Requirements

### Requirement: Plugin fetches skill manifest from configurable base URL

The plugin SHALL fetch a JSON manifest from `<SKILLS_BASE>/skills.json` on every session start. The base URL SHALL be configurable via a `MY_SKILLS_BASE_URL` environment variable with a default of `https://my-skills-atd.pages.dev`.

The manifest MUST be a JSON object with shape `{ "skills": [ { "name": string, "files": string[] } ] }`. Each entry's `files` array MUST contain `"SKILL.md"` and MAY contain other files (e.g. `"LICENSE.txt"`).

#### Scenario: Successful manifest fetch
- **WHEN** `session.created` fires
- **THEN** the plugin fetches `<SKILLS_BASE>/skills.json`
- **AND** the plugin parses the response as JSON
- **AND** the plugin iterates over `manifest.skills` and calls `syncSkill()` for each entry

#### Scenario: Manifest fetch fails with HTTP error
- **WHEN** `<SKILLS_BASE>/skills.json` returns a non-2xx status
- **THEN** the plugin logs `[my-skills] failed to fetch manifest: <status>`
- **AND** the plugin exits sync without throwing

#### Scenario: Manifest fetch fails with network error
- **WHEN** `fetch()` throws a network error
- **THEN** the plugin logs `[my-skills] failed to fetch manifest: <error.message>`
- **AND** the plugin exits sync without throwing

### Requirement: Plugin writes each skill file to the Kilo skills directory

For each skill entry, the plugin SHALL fetch every file in `entry.files` from `<SKILLS_BASE>/skills/<name>/<file>` and write it to `~/.config/kilo/skills/<name>/<file>`.

Path traversal MUST be rejected: a `name` or `file` containing `..`, `/`, or a leading non-letter character MUST cause the entry to be skipped with a `[my-skills] [i] <name>: bad path` warning.

#### Scenario: Skill file fetched and written
- **WHEN** the plugin processes an entry with name `frontend-design` and files `["SKILL.md"]`
- **THEN** the plugin fetches `<SKILLS_BASE>/skills/frontend-design/SKILL.md`
- **AND** the plugin writes the response body to `~/.config/kilo/skills/frontend-design/SKILL.md`
- **AND** the directory `~/.config/kilo/skills/frontend-design/` is created if it doesn't exist

#### Scenario: Skill name with path traversal rejected
- **WHEN** the plugin processes an entry with name `../etc/passwd`
- **THEN** the plugin logs `[my-skills] [i] ../etc/passwd: bad path`
- **AND** no file is written outside `~/.config/kilo/skills/`

#### Scenario: Single file fetch fails
- **WHEN** the plugin fetches one file and the response is non-2xx
- **THEN** the plugin logs `[my-skills] [i] <name>: <file> fetch failed: <status>`
- **AND** the plugin continues to the next file (does not abort the whole skill)

### Requirement: Plugin computes content hash and skips unchanged skills

After fetching all files for a skill, the plugin SHALL compute a SHA-256 hash over the sorted `(path, content)` pairs and compare it to `~/.config/kilo/.skill-state/<name>.hash`. If the hashes match, the plugin SHALL skip writing the skill files (the on-disk content is already correct).

#### Scenario: Hash matches existing state
- **WHEN** the computed hash equals the value stored in `.skill-state/<name>.hash`
- **THEN** the plugin does NOT write skill files
- **AND** the plugin does NOT update the state hash (it stays the same)

#### Scenario: Hash differs from existing state
- **WHEN** the computed hash differs from `.skill-state/<name>.hash`
- **THEN** the plugin writes all skill files (overwriting any existing content)
- **AND** the plugin writes the new hash to `.skill-state/<name>.hash`

#### Scenario: No existing state file
- **WHEN** `.skill-state/<name>.hash` does not exist
- **THEN** the plugin writes all skill files
- **AND** the plugin writes the new hash to `.skill-state/<name>.hash`

### Requirement: Plugin removes skills that are no longer in the manifest

After processing all current manifest entries, the plugin SHALL read the existing state directory and remove any `.skill-state/<name>.hash` file whose name is not in the current manifest. It SHALL also remove the corresponding `~/.config/kilo/skills/<name>/` directory.

#### Scenario: Skill removed from manifest
- **WHEN** `web-design-guidelines` is in state but not in the new manifest
- **THEN** the plugin deletes `~/.config/kilo/skills/web-design-guidelines/`
- **AND** the plugin deletes `~/.config/kilo/.skill-state/web-design-guidelines.hash`

### Requirement: Build script produces both tarball and skills directory in dist/

`npm run build` SHALL:
1. Remove any existing `dist/` directory.
2. Run `npm pack --pack-destination dist` to produce the plugin tarball.
3. Create `dist/skills/` and copy every entry under `skills/` (the source tree) into it.
4. Copy `skills.json` to `dist/skills.json`.

The `package.json` `files` whitelist SHALL be `["src", "skills", "skills.json", "README.md"]` so the tarball contains the plugin source AND the skills data (in case a future deploy needs the tarball to be self-sufficient for legacy consumers).

#### Scenario: Build succeeds
- **WHEN** user runs `npm run build`
- **THEN** `dist/my-skills-<version>.tgz` exists
- **AND** `dist/skills.json` exists
- **AND** `dist/skills/<name>/<file>` exists for every skill in `skills.json`

### Requirement: Plugin hooks fire on session events

The plugin SHALL export a `MySkills` function that returns `{ "session.created": handler, "session.idle": handler }`. Each handler SHALL call `sync()`. A `refresh_ms` option (default 3600000) SHALL debounce the sync — if the last successful sync was within `refresh_ms` ms, the handler is a no-op.

#### Scenario: First session after install
- **WHEN** `session.created` fires for the first time
- **THEN** the plugin runs sync unconditionally

#### Scenario: Subsequent session within debounce window
- **WHEN** `session.created` fires 5 minutes after the last successful sync and `refresh_ms` is 3600000
- **THEN** the plugin does NOT run sync

### Requirement: Plugin can be disabled via config or env

The plugin SHALL be a no-op when `disabled: true` is passed in options OR when the `MY_SKILLS_DISABLED=1` environment variable is set.

#### Scenario: Plugin disabled via option
- **WHEN** `MySkills` is invoked with `{ disabled: true }`
- **THEN** the returned hooks do not invoke sync on any session event