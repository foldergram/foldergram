# Hosted demo and documentation deployments

This guide is for maintainers publishing Foldergram’s own demo and documentation
site. For self-hosting, see [Installation](../docs/installation.md).

## Tagged releases

`.github/workflows/publish-ghcr.yml` runs on version tags matching `v*.*.*`.
It verifies the release, publishes the Docker images, and asks the VPS to build
and deploy that tagged application and its documentation.

The SSH deployment key uses `scripts/deploy-vps.sh` as a forced command. The
handler accepts `check`, `deploy <version-tag> <commit-sha>`, and
`deploy-docs <commit-sha>`. It verifies the requested tag or main commit against
the server’s Git remote before building.

## Publish documentation between releases

Use this for documentation or community-link updates that should be public
before the next application release. Merge the changes into `main` first,
without promoting unreleased application changes from `develop`.

Run **Actions → Deploy docs → Run workflow**, select `main`, or use:

```bash
gh workflow run deploy-docs.yml --ref main
```

The manual workflow in `.github/workflows/deploy-docs.yml` only accepts `main`.
Ordinary pushes do not trigger it. It checks the docs build and deployment
recovery fixtures before asking the VPS to build and publish the same commit.
If `main` advances before the VPS verifies the commit, rerun the workflow.

Both manual and tagged deployments replace the existing docs site; they do not
create separate versioned sites. The badge comes from the root `package.json`.
Manual publication does not bump that version, create a tag or release, publish
Docker images, or restart the demo. A later tagged release publishes its own
docs as usual. Merge docs-only commits on `main` back into `develop` so those
updates remain in the next release.

### One-time VPS setup

Install the current `scripts/deploy-vps.sh` at the SSH forced-command path
already configured for the CI deployment key. The installed handler must accept
`deploy-docs <commit-sha>` as well as the tagged `deploy` command. Merging the
workflow alone does not update the installed handler; an older copy rejects
the new command.

The manual workflow reuses these repository Actions settings:

- Variables: `VPS_HOST`, `VPS_PORT`, `VPS_USER`, and `VPS_KNOWN_HOSTS`.
- Secret: `VPS_SSH_KEY`.

It uses the same GitHub Actions concurrency group and VPS deployment lock as
releases. The running demo, its checkout, database, and release rollback backup
remain in place. The previous docs are saved under `<deploy-root>/docs-backup`
and restored if a copy fails or deployment is interrupted. If restoration fails,
the deployment log identifies the backup for manual recovery.

Verify changes to the deployment handler with the disposable fixtures:

```bash
bash scripts/test-deploy-vps.sh
```
