# Contributing

Foldergram accepts contributions, but it is an opinionated project with clear product and architecture boundaries. Not every technically correct change fits the direction of the project.

Read [AGENTS.md](AGENTS.md) for repository-specific coding conventions, verification requirements, commit messages, and guidance for LLM-assisted contributions.

**Start contribution branches from the latest `develop` and open pull requests against `develop`.** `main` is the default branch for stable releases and their README. Push your commits to your own contribution branch; maintainers merge reviewed PRs into `develop`.

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

1. Fork and clone the repository, then create a contribution branch from upstream `develop` using the instructions below.
2. Copy `.env.example` to `.env`.
3. Install dependencies with `pnpm install`.
4. Start the workspace with `pnpm dev`.
5. Run tests with `pnpm test`.

Optional checks:

- `pnpm build`
- verify the feature in the browser against a realistic local gallery

## Branches

Foldergram uses two long-lived branches:

| Branch | Purpose | Pull requests |
| --- | --- | --- |
| `develop` | Integration for the next release | Normal fixes, features, tests, and documentation |
| `main` | Stable releases and the default repository view | Maintainer-managed releases, coordinated hotfixes, and contributor-guidance updates |

Use short descriptive branch names such as:

- `fix/...`
- `docs/...`
- `feat/...`
- `refactor/...`
- `test/...`

Keep each branch and pull request focused on one concern.

### Start a contribution

In your clone, `origin` should point to your fork. Add the original repository as `upstream` once; skip the first command if that remote already exists:

```bash
git remote add upstream https://github.com/foldergram/foldergram.git
git fetch upstream
git switch --no-track --create fix/your-change upstream/develop
```

After making, testing, and committing your changes, push your contribution branch to your fork:

```bash
git push --set-upstream origin fix/your-change
```

On GitHub, choose `foldergram/foldergram` as the base repository, `develop` as the base branch, and your fork's contribution branch as the head. With GitHub CLI, explicitly set the base:

```bash
gh pr create --repo foldergram/foldergram --base develop
```

GitHub initially selects the default branch, `main`, so explicitly change the PR base to `develop`. The PR template reminds you to check this; it does not change the selected base automatically. Contributions should not be pushed directly to either long-lived branch.

For a browser link with an explicit base, replace `YOUR_USERNAME` and `YOUR_BRANCH` in `https://github.com/foldergram/foldergram/compare/develop...YOUR_USERNAME:YOUR_BRANCH?quick_pull=1` with your fork owner and contribution branch.

### Update an existing PR

From the same contribution branch, merge the latest upstream `develop`, resolve any conflicts, rerun the applicable checks, and push to the same branch:

```bash
git fetch upstream
git merge upstream/develop
git push origin fix/your-change
```

If a PR initially targeted `main`, change its base to `develop` and check the resulting diff and conflicts. Changing the base alone does not update the contribution branch. Keep review fixes on the PR's existing head branch so the same PR receives them.

Maintainers promote reviewed changes from `develop` to `main` for a release. Preserve the shared history with a merge commit when promoting these long-lived branches; do not squash the entire `develop` branch into `main`. Merge release-only or hotfix commits on `main` back into `develop` so the branches stay aligned.

Keep `main` as GitHub's default branch so visitors and normal clones see released features and documentation. The README on `develop` can describe upcoming features; promote those claims to `main` with the corresponding release.

GitHub loads PR templates from the default branch. Maintainers should synchronize contributor guidance and the PR template to `main` through a documentation-only PR, then bring that commit back into `develop`. That update can happen between releases and should contain only community guidance, without promoting unreleased application changes or feature documentation.

## Pull Requests

The public documentation under `docs/` is for people installing and using
Foldergram and for developers preparing contributions. Write around a reader's
task, with steps they can follow and outcomes they can check. Keep
project-hosting procedures and release operations in the
[deployment guide](scripts/DEPLOYMENT.md), and keep experimental validation
reports alongside the relevant code or tests. API and architecture references
can explain implementation details when they help a developer use or change
the system.

- Confirm the base branch is `develop`, unless a maintainer explicitly requested a release, hotfix, or contributor-guidance PR against `main`.
- Link the related issue or discussion when one exists.
- Explain the user-visible behavior change clearly.
- Include screenshots or short recordings for UI changes.
- Add or update tests when behavior changes.
- Update docs when setup, configuration, scripts, or product behavior changes.
- Avoid unrelated refactors in the same pull request.

Submitting a pull request proposes a change for review; it does not guarantee merge. Changes that do not fit the project direction may be declined.
