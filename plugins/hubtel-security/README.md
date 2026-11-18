# Hubtel Security

Plugin for security skills that audit and remediate Hubtel applications. Each skill covers specific security
controls, applies changes only with your approval, and tells you what to test afterwards. Skills work on a
Hubtel feature branch (`users/<username>/feature/<short-desc>`) with one local commit per stage. They never push
or open PRs unless you ask.

> **Status: pilot.** The `security` skill pack is `readyForGeneralUse: false`. Start with each skill's
> read-only modes and review its plan before approving any change.

## Contents

| Kind | Name | Pack | Covers |
|------|------|------|--------|
| Skill | `hbtl-frontend-security` | `security` | C1 Sign-in & sessions · C2 Browser request integrity · Exposure (routes, secrets) |
| MCP server | `hubtel-engineering` (`npx -y @hubtel/engineering-mcp@latest`) | — | `audit_packages`, used before any dependency install |

## Install

```shell
aqua add-plugin --plugin hubtel-security --agent cursor claude-code codex \
  --source /absolute/path/to/Hubtel-Agent-Repo
```

After the marketplace is published, omit `--source` to install from the org catalog.

## Runtime dependencies

- Node.js and git in the target app.
- Optional: the Snyk MCP for code scans of changed files. Skills use it when it's available.

---

## Skill: `hbtl-frontend-security`

Moves Next.js and Nuxt frontends to a BFF session model. The browser holds only an `httpOnly` session cookie,
and a same-origin server layer owns sign-in, credential renewal, sign-out, and proxying to backend services.

- **C1 Sign-in & sessions:** Auth.js (NextAuth) / nuxt-auth-utils, server-side Turnstile validation,
  server-side credential renewal, session invalidation at sign-out, and BFFs that proxy requests to backends.
- **C2 Browser request integrity:** origin verification on sensitive requests (including sign-out),
  restricted cross-origin access, and CSP and framing limits.
- **Exposure:** every server entry point declares and enforces its access level (public, session, or role), the
  BFF forwards only the backend paths the app uses, and hardcoded credentials move to server-only env, with
  rotation listed for the secret's owner.

It's an opinionated remediation skill, not a general scanner. It audits the app, records the decisions its
backend dictates, plans staged fixes, applies each stage only after approval, and lists the user flows to test
after every stage.

```text
/hbtl-frontend-security --audit   # read-only: facts sheet + findings
/hbtl-frontend-security --plan    # read-only: decisions + staged plan
/hbtl-frontend-security           # full run; each stage waits for approval
/hbtl-frontend-security --resume  # continue an in-progress plan
/hbtl-frontend-security --verify  # re-run invariant tests
```

**Triggers (examples):** move tokens out of localStorage, audit frontend session handling, add a BFF,
secure sign-in / OTP / sign-out, NextAuth migration, nuxt-auth-utils migration, add Turnstile server
validation, add origin checks / CSRF protection, add CSP and anti-framing headers, find unauthenticated
endpoints, find hardcoded credentials.

**Output in the target app:**
- `.hbtl/frontend-security/audit.md`: facts sheet, invariant status, findings.
- `.hbtl/frontend-security/plan.md`: branch, decisions, component map, Mermaid diagrams (stage flow,
  target architecture, S2 checkpoints), and stages with evidence and commit SHAs.
- The changes themselves: on `users/<username>/feature/<short-desc>`, one commit per stage, not pushed.

---

## Adding a skill to this plugin

Put the skill in `skill-packs/security/skills/<skill>/`, add its name to this plugin's `skills.json`, add a
row to the Contents table and a section above, bump the plugin `version` in `hubtel-marketplace.json`, and run
`node marketplace/scripts/validate-marketplace.mjs`.
