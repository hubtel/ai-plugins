# Software Development Workflow

## Purpose

Bridge the agent to the `@hubtel/engineering-mcp` MCP server. Proactively ground Hubtel-project answers in the docs catalogue, gate npm/NuGet installs against the CCI compliance registry, and stay silent outside Hubtel projects.

## Inputs

| Input | Source |
|-------|--------|
| User request | Active conversation turn |
| Current working directory | Host environment |
| Git remote URL | `git config --get remote.origin.url` |
| Project domain | `package.json` at the project root ⇒ **frontend**; no `package.json` (a `.nuget` file / `.csproj` / `.sln` instead) ⇒ **backend** |
| MCP availability | Whether `hubtel-engineering` tools are registered in the host IDE |

## Workflow Steps

1. **Detect Hubtel project** — apply the rules in [hubtel-project-detection.md](hubtel-project-detection.md). If the workspace is **not** a Hubtel project AND the user did not explicitly invoke Hubtel docs or a package audit, exit the skill silently and answer with general knowledge.

2. **Classify the request** — pick a branch:
  - **(a) Knowledge / "how do we…" question** → docs branch (Steps 3–5).
  - **(b) About to install, upgrade, or pin a package** (any of `npm/yarn/pnpm add`, `dotnet add package`, `nuget install`, `Install-Package`, or any edit to `package.json` / `*.csproj` / lockfiles) → audit branch (Step 6).
  - **(c) Both** (e.g., user asks "how do we use X library at Hubtel?" while also installing it) → run both branches; audit-first if an install is imminent.
  - **(d) Generating new code or modifying existing code** in the Hubtel project (any source file you author or edit) → guidelines branch (Step 6b). This branch is **mandatory** and runs **in addition to** any of the above — e.g. installing a package *and* writing code triggers both the audit and the guidelines branch.
  - **(e) Purely general programming** with no code change in the Hubtel repo (a conceptual answer, throwaway snippet, or work outside the workspace) → do not call the MCP.

3. **Catalogue lookup** — call `get_docs_catalog({ query })` with a natural-language query for the user's intent (or page the full catalogue via `page`/`limit` while `pagination.hasMore` is true when browsing). Rank the returned `entries` by `section`, `title`, and `summary`. Pick 1–3 candidate `id`s. **This is an index only — it holds no doc content. Do not answer from it; it exists solely to choose ids for Step 4.**

4. **Fetch (mandatory follow-through)** — call `get_doc({ id })` for each candidate (sequential is fine; payloads are small). **Never skip this step or return to the user after only Step 3** — the catalogue call is not an answer, `get_doc` is where the real content comes from.

5. **Synthesize + cite** — answer grounded in the fetched content. Always emit each used doc's `citationUrl` as a markdown link.

6. **Audit packages** — call `audit_packages({ packages: [...] })` with **all** packages batched in a single call. For each result:
  - `isTrusted === false` **OR** `isVulnerable === true` **OR** `isSafeVersion === false` → **STOP the install for that package.** Surface `distrustReason`, `recommendedVersion`, and `alternativePackages` to the user and ask how to proceed. Never silently swap or proceed.
  - All-clear → proceed with the install.

6b. **Apply code-quality guidelines** (mandatory gate before/while writing or modifying code in a Hubtel project):

  1. **Determine the domain** — `package.json` at the project root ⇒ **frontend**; no `package.json` (a `.nuget` file / `.csproj` / `.sln`) ⇒ **backend**. In a monorepo, resolve per the directory you are editing.
  2. **Discover** — call `get_guidelines_catalog({ domains: [<domain>] })` **once** per domain (or add a `query` to narrow by relevance). It returns a **flat list** of `{ domain, scope, name, description }`; group by `scope` yourself (e.g. `general`, `logging`, `nextjs`) to see what's available. **This is an index only — it holds no guideline text. Do not start editing code from it; it exists solely to choose refs for Step 4.**
  3. **Select scopes:**
     - **Always** `<domain>/general` — it applies to any code you write or change.
     - `<domain>/logging` — **only** when the change touches logging code (adding/editing log statements, log configuration, log levels, structured/contextual logging). Skip it otherwise.
     - Any stack-specific scope whose catalog description matches the project (e.g. `frontend/nextjs` on a Next.js app). Match by the scope description, don't assume.
  4. **Read (mandatory follow-through)** — call `get_guideline({ guidelines: [...] })` with **every** selected `{domain, scope, name}` batched into a **single** call. **Never skip this step or begin writing code after only Step 2** — the catalog descriptions are not the rules; `get_guideline` is where the authoritative guidance comes from.
  5. **Adhere** — write or modify the code to conform to the returned guidance. This is a hard requirement, not advisory; if guidance conflicts with the user's request, surface the conflict rather than silently violating either.
  6. **Cache** — reuse the catalogue and fetched guidelines for the rest of the session; only re-fetch if the domain changes or you need a scope you didn't pull.

7. **Handle `LOGIN_REQUIRED`** — if any call returns the structured `LOGIN_REQUIRED` error, surface the `requiresAction` block verbatim (run `npx -y @hubtel/aqua-cli login` in the integrated terminal) and stop. Retry the same tool call only after the command exits 0. Do not fabricate a non-grounded answer, bypass an audit, or write code without the guidelines.

8. **Cache & reuse** — within a single conversation, do not re-call `get_docs_catalog` repeatedly; the catalogue is stable per session. Re-audit only when the package set or versions change.

## Gotchas

- **Never stop at a catalog call.** `get_docs_catalog` and `get_guidelines_catalog` return an index (ids/refs + summaries), not content. Fetching a catalog and then answering the user or editing code — without the follow-up `get_doc` / `get_guideline` in the same turn — is the single most common failure and produces ungrounded work. The catalog result's only job is to choose the arguments for the content call that must immediately follow it.
- Don't proactively call the MCP outside Hubtel projects — wastes tokens, adds latency, may leak unrelated context.
- Don't paste full doc bodies into chat; quote the relevant snippet plus the citation URL.
- `get_docs_catalog` is cheap; `get_doc` is per-doc — keep selections to ≤3.
- **`audit_packages` is a non-optional gate** for installs in a Hubtel project. Skipping it can introduce distrusted or vulnerable dependencies. Always batch — don't loop one-at-a-time.
- **The guidelines branch is a non-optional gate** before authoring or editing code in a Hubtel project. Don't write code first and reconcile later — up front, fetch `<domain>/general` (always), `<domain>/logging` (logging code only), **and any other scope applicable to the domain and the change** (e.g. a stack-specific scope like `frontend/nextjs`), then conform as you write. Batch all `get_guideline` references into one call; don't fetch a scope that doesn't apply (e.g. don't pull `logging` for a pure UI change).
- **Domain is decided by `package.json`, not by language guesses** — `package.json` present ⇒ frontend guidelines; absent (`.nuget`/`.csproj`) ⇒ backend guidelines.
- The MCP server may be unconfigured in the host IDE — if tool calls fail with "tool not found", fall back to a general answer and tell the user how to wire the MCP (point to the project README).
- Do not call the MCP for `/hbtl-dac-*` doc-generation flows; those operate on the active repo, not the dev-docs catalogue.

## Output

- **Docs branch:** answer text with inline citations to `https://dev-docs.hubtel.com/...` URLs.
- **Audit branch:** per-package audit summary table with proceed/stop verdicts, recommended versions, and alternatives.
- **Guidelines branch:** code that conforms to the fetched guidelines, with a brief note of which guidelines were applied, each referenced as `<domain>/<scope>/<guideline>` (e.g. "applied `backend/general/naming-conventions-and-organization` + `backend/logging/structured-logging`").
