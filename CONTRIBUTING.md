# Contributing

Foldergram accepts contributions, but it is an opinionated project with clear product and architecture boundaries. Not every technically correct change fits the direction of the project.

Read [AGENTS.md](AGENTS.md) for repository-specific coding conventions, verification requirements, commit messages, and guidance for LLM-assisted contributions.

## What You Can Usually Submit Directly

Small, clearly aligned pull requests are welcome without prior approval:

- bug fixes
- documentation improvements
- test coverage
- focused performance or accessibility fixes
- small UI polish that does not change core behavior

## What Must Be Discussed First

Open an issue or discussion before writing code for changes that:

- add a major feature or new workflow
- change the folder model, routing structure, or feed behavior
- change scanning, indexing, derivative generation, or storage layout
- change auth, access modes, delete or trash behavior, or other core app flows
- introduce cloud services, external APIs, sync, uploads, SaaS behavior, or multi-user concepts
- replace major stack choices or add heavy infrastructure dependencies such as an ORM

Pull requests for major features or architecture changes that were not discussed first will not be accepted. Maintainers may close them even if the implementation is high quality.

If you are unsure whether a change is "small" or "major", open an issue first.

## Project Rules

- Keep Foldergram local-first and self-hosted.
- Keep runtime reads database-driven. Do not move request handling back to live filesystem scanning.
- Preserve stable sort behavior, soft deletes, and file reactivation semantics unless a design discussion approves a change.
- Keep filesystem access sanitized. Do not add arbitrary file serving.
- Prefer the existing stack and patterns unless a maintainer has agreed to a change first.
- Use `pnpm` for workspace commands.

## Local Setup

1. Fork and clone the repository.
2. Copy `.env.example` to `.env`.
3. Install dependencies with `pnpm install`.
4. Start the workspace with `pnpm dev`.
5. Run tests with `pnpm test`.

Optional checks:

- `pnpm build`
- verify the feature in the browser against a realistic local gallery

## Branches

Use short descriptive branch names such as:

- `fix/...`
- `docs/...`
- `feat/...`
- `refactor/...`
- `test/...`

Keep each branch and pull request focused on one concern.

## Pull Requests

- Link the related issue or discussion when one exists.
- Explain the user-visible behavior change clearly.
- Include screenshots or short recordings for UI changes.
- Add or update tests when behavior changes.
- Update docs when setup, configuration, scripts, or product behavior changes.
- Avoid unrelated refactors in the same pull request.

Submitting a pull request proposes a change for review; it does not guarantee merge. Changes that do not fit the project direction may be declined.
