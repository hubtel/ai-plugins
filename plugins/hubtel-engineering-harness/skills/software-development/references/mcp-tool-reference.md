# MCP Tool Reference — `@hubtel/engineering-mcp`

- **Server name:** `hubtel-engineering` (per the MCP config in the project README).
- **Package:** `@hubtel/engineering-mcp`.

## Tools

### `get_docs_catalog({ query?, page?, limit? })`

- **Args (all optional):**
  - `query: string` — natural-language search; returns the top docs ranked by semantic relevance and ignores `page`. **Prefer this** when you know what you're looking for.
  - `page: number` (1-based, default 1) and `limit: number` (1–100, default 50) — browse the full catalogue in chunks. Only used when `query` is omitted.
- **Returns:** `{ entries: Array<{ id: string; title: string; section: string; summary: string }>, pagination: { hasMore: boolean, ... } }`. Entries span backend, frontend, mobile, and DevOps docs. **The catalogue holds no doc bodies** — only metadata to choose ids from.
- **Usage:** issue a `query` for the user's intent (or page while `pagination.hasMore` is true when browsing), rank by `title`/`section`/`summary`, pick the top 1–3 `id`s, **then call `get_doc` for each.** The catalogue call alone answers nothing.

### `get_doc({ id })`

- **Args:** `{ id: string }` — must be an `id` from `get_docs_catalog`.
- **Returns:** `{ title: string; citationUrl: string; content: string }` where `content` is raw Markdown and `citationUrl` is a `https://dev-docs.hubtel.com/...`
  URL.
- **Required follow-through:** this is the only tool that returns real doc content. **Always** call it after `get_docs_catalog` — never synthesize an answer from catalogue summaries alone.
- **Errors:** `Unknown doc id` if the id isn't in the catalogue — re-list and retry rather than guessing.

### `audit_packages({ packages })`

- **Args:** `{ packages: Array<{ packageName: string; packageType: 'npm' | 'nuget'; version: string }> }` (min 1).
- **Returns:** `{ results: AuditResult[] }`. Each result includes at minimum:
  - `isTrusted` (boolean) — overall approval verdict.
  - `isVulnerable` (boolean) — known vulnerabilities.
  - `isSafeVersion` (boolean) — the specific version is acceptable.
  - `distrustReason` — human-readable explanation when not trusted.
  - `recommendedVersion` — version to use instead.
  - `alternativePackages` — drop-in or near-equivalent alternatives.
  - Package health metadata.
- **Decision rule:** any of `isTrusted === false`, `isVulnerable === true`, or `isSafeVersion === false` → halt the install for that package and surface the reason + recommendedVersion + recommendation + alternativePackages. Always batch all packages into one call.

### `get_guidelines_catalog({ query?, domains?, limit? })`

- **Args:** at least one of `query` or `domains` is required.
  - `domains: string[]` (min 1) — e.g. `["backend"]`, `["frontend"]` (and `"mobile"` / `"devops"` where present). Without `query`, lists every guideline in those domains; with `query`, restricts the search to them.
  - `query: string` — natural-language search; returns the guidelines ranked by relevance instead of the full domain listing.
  - `limit: number` (1–100, default 10) — max ranked results when `query` is set.
- **Returns:** a **flat list** of `{ domain, scope, name, description }` (no longer a nested per-scope tree). Group by `scope` yourself to see what each domain offers. **The catalogue holds no guideline text** — only the refs to fetch.
- **Usage:** call this **first** to discover which `{domain, scope, name}` refs exist, then read the full text of the ones you need with `get_guideline`. Cheap; call once per domain per session and cache mentally. **The catalog descriptions are not the guidance — you must fetch the content.**

### `get_guideline({ guidelines })`

- **Args:** `{ guidelines: Array<{ domain: string; scope: string; name: string }> }` (min 1) — each reference uses the `domain`, `scope`, and guideline `name` exactly as returned by `get_guidelines_catalog`.
- **Returns:** per requested guideline, its `domain`, `scope`, guideline `name`, and the full Markdown `content`.
- **Required follow-through:** **always** call this after `get_guidelines_catalog` — it is the only tool that returns the actual rules. **Batch every guideline you need into a single call.** Read the returned guidance and conform the code you write or modify to it — this is the authoritative source, not a suggestion. Never write code off the catalog descriptions alone.
- **Errors:** an unknown `{domain, scope, name}` triple → re-call `get_guidelines_catalog` and correct the reference rather than guessing.

## Error shape: `LOGIN_REQUIRED`

Every tool call may return a structured `LOGIN_REQUIRED` error with a `requiresAction` block. The text content of the error already contains the instruction:

> ACTION REQUIRED: ask the user for permission to run `<command>` in the integrated terminal. When it exits 0, retry this tool call.

Surface the action to the user verbatim; never silently retry or fabricate.

## The catalog → content rule (do not stop at the catalog)

`get_docs_catalog` and `get_guidelines_catalog` are **index lookups**. They return ids/refs and one-line summaries, never the underlying content. A turn that fetches a catalog and then answers the user or edits code — without the follow-up `get_doc` / `get_guideline` — has skipped the authoritative source and is wrong.

**Rule:** in the same turn as the catalog call, choose your ids/refs from its result and immediately issue the matching content call. Do not end the turn, return control, or start editing files on a catalog result alone.

- `get_docs_catalog` is worthless without a following `get_doc`.
- `get_guidelines_catalog` is worthless without a following `get_guideline`.

## Calling patterns

- **Docs:** `get_docs_catalog({ query })` (or page the catalogue) → rank by title/section/summary → **`get_doc` for top 1–3 ids** → quote snippets and include `citationUrl` as a markdown link.
- **Audit:** collect all packages being installed/upgraded → single batched `audit_packages` call → enforce the decision rule above before proceeding.
- **Guidelines:** determine the domain (`frontend` if a `package.json` exists, otherwise `backend`) → `get_guidelines_catalog({ domains: [<domain>] })` once → select the scopes that apply (always `<domain>/general`; `<domain>/logging` only for logging code; plus any stack-specific scope such as `frontend/nextjs`) → **single batched `get_guideline` call for every selected guideline** → conform the code to the returned guidance before/while writing it.

### Guidelines examples

**Backend (no `package.json`; e.g. a `.csproj`/`.nuget` .NET service) — adding a payment handler with logging:**

```jsonc
// 1) discover
get_guidelines_catalog({ domains: ["backend"] })
// 2) read — general always applies; logging because the change emits logs
get_guideline({ guidelines: [
  { domain: "backend", scope: "general", name: "naming-conventions-and-organization" },
  { domain: "backend", scope: "logging", name: "structured-logging" }
] })
```

**Frontend (`package.json` present; e.g. a Next.js app) — building a new screen, no logging touched:**

```jsonc
// 1) discover
get_guidelines_catalog({ domains: ["frontend"] })
// 2) read — general always applies; nextjs because it is a Next.js app; logging skipped (no logging code)
get_guideline({ guidelines: [
  { domain: "frontend", scope: "general", name: "component-structure" },
  { domain: "frontend", scope: "nextjs", name: "app-router-conventions" }
] })
```

> Guideline `name`s above are illustrative — always take the real `name`s from `get_guidelines_catalog` for the active project; do not invent them.

## Failure modes

- **Tool not registered in host IDE** → MCP not installed; fall back to a general answer and tell the user how to wire it (point to the project README).
- **Network / Azure DevOps 5xx** → mention the transient failure; offer to retry.
- **Empty catalogue** → treat as MCP misconfiguration; do not loop.
- **`Unknown doc id` from `get_doc`** → re-call `get_docs_catalog`; don't guess ids.
