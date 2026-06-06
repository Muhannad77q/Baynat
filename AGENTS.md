# AGENTS.md

Guidance for AI agents working in this repository.

## Repository status

**Baynat** is currently an empty scaffold repository. It contains only `README.md` with a project title. There is no application source code, dependency manifests, Docker configuration, CI workflows, or environment variable templates.

## Cursor Cloud specific instructions

### Services

No services are defined. There is nothing to build, lint, test, or run until application code and tooling are added to the repository.

### Environment setup

- No package manager lockfile or manifest exists (`package.json`, `pyproject.toml`, `go.mod`, etc.).
- No Docker or database setup is required.
- The VM update script is a no-op (`true`) because there are no dependencies to refresh on startup.

### When application code is added

Update this section and the VM update script when the project gains real tooling. Typical next steps for a new app:

1. Add a dependency manifest and lockfile for the chosen stack.
2. Document install, dev server, lint, and test commands in `README.md`.
3. Add `.env.example` if external services or secrets are required.
4. Replace the no-op update script with the appropriate install/sync command (e.g. `npm install`, `pnpm install`, `uv sync`).

### Standard commands

| Task | Command |
|------|---------|
| Verify repo | `git status` |
| List files | `ls -la` |

No lint, test, or dev-server commands exist yet.
