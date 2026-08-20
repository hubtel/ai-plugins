# Hubtel Project Detection

Detection rules, in priority order. Treat the workspace as a Hubtel project if **any** of the following signals match.

## Positive signals

1. **Git remote points to Hubtel's Azure DevOps org.** Run `git config --get remote.origin.url` (or `git remote -v`) and match against:
   - `dev.azure.com/hubtel/` (HTTPS)
   - `hubtel@vs-ssh.visualstudio.com` or `hubtel.visualstudio.com` (legacy)
   - `ssh.dev.azure.com:v3/hubtel/` (SSH)
2. **Repo name contains `hubtel`** (case-insensitive). Check the basename of the toplevel git directory: `basename "$(git rev-parse --show-toplevel)"`.
3. **Workspace path contains `/Hubtel/`** as a path segment (case-insensitive match on `[/\\][Hh]ubtel[/\\]`). Use this only as a tiebreaker — many engineers nest unrelated projects under a `Hubtel/` work folder, so combine with signal 1 or 2 when possible.
4. **Manifest hints** (secondary): `package.json` with a `@hubtel/*` dependency or `name` starting with `@hubtel/`; `*.csproj` referencing `Hubtel.*` packages.

## Negative signals — do NOT activate

- No git repo, or remote points to a non-Hubtel org (GitHub personal, third-party Azure org, GitLab, Bitbucket).
- A directory whose only Hubtel association is being opened as a sibling — check the active workspace root, not parent directories beyond the git toplevel.

## Caching

Make the detection call once per session and remember the result. Re-evaluate only if the user changes workspaces.

## Explicit override

When the user says "check the Hubtel docs", "what does dev-docs say…", or names the MCP directly, treat as Hubtel-scoped regardless of detection result.
