---
name: hbtl-software-development
description: "Bridges general software-engineering work to the Hubtel Engineering MCP (@hubtel/engineering-mcp). Surfaces and proactively calls the MCP's `get_docs_catalog`, `get_doc`, `audit_packages`, `get_guidelines_catalog`, and `get_guideline` tools to (a) ground answers in Hubtel's internal engineering documentation, (b) gate every npm/NuGet package install or manifest edit against Hubtel's CCI compliance registry, and (c) have the agent fetch, read, and adhere to Hubtel's code-quality guidelines for the project's domain before authoring or editing any code — but only when the active workspace is a Hubtel project. Use when working in any repo connected to Hubtel's Azure DevOps org or whose name contains 'Hubtel/hubtel' and the user asks about architecture, conventions, internal services, APIs, integrations, deployment, onboarding, 'how do we do X at Hubtel', is about to install/upgrade a package, or is generating or modifying code. Do NOT invoke outside Hubtel projects unless the user explicitly references Hubtel docs or asks for a package audit specifically by the mcp."
metadata:
  author: "Hubtel Enablement Team"
  version: 1.1
  date_added: 2026-05-26
  last_updated: 2026-07-09
compatibility: Requires the @hubtel/engineering-mcp MCP server to be configured in the host IDE. Designed for Hubtel engineering projects.
---

# Software Development (`/hbtl-software-development`)

Grounds software-engineering assistance in Hubtel's official Dev Docs by routing through the `@hubtel/engineering-mcp` MCP server. Follow the workflow in [references/software-development-workflow.md](references/software-development-workflow.md).

## When to activate

Activate automatically when **both** are true:

1. The active workspace is a **Hubtel project** — see [references/hubtel-project-detection.md](references/hubtel-project-detection.md).
2. The user's request either:
   - touches Hubtel-specific knowledge: internal services, shared libraries, naming conventions, deployment, environments, SSO, payment/CCI integrations, eventing, monitoring, on-call, or any "how do we do X at Hubtel?" question; **or**
   - involves **generating new code or modifying existing code** in the project — in which case fetch and apply the relevant code-quality guidelines before writing (see the guidelines workflow below).

Outside a Hubtel project, **do not call the MCP** unless the user explicitly
asks (e.g., "check the Hubtel docs", "what does dev-docs say about…").

## Invocation

```
/hbtl-software-development        # Manual entry point
```

Most invocations are implicit — the agent activates the skill based on the context rules above, then calls the MCP tools as part of answering.

## MCP tools surfaced

| Tool | Purpose | When to call |
|------|---------|--------------|
| `get_docs_catalog` | Optional `{ query?, page?, limit? }`. Pass a natural-language `query` to get docs ranked by semantic search (best when you know what you need); otherwise page through the full catalogue with `page`/`limit` while `pagination.hasMore` is true. Returns `{ entries: DocEntry[], pagination }` spanning backend, frontend, mobile, and DevOps docs. Entries carry only `id`/`title`/`section`/`summary` — **not** the doc body. | **First** step in any Hubtel-grounded answer. It only tells you which docs exist — you must then call `get_doc`. |
| `get_doc` | `{ id }` → `{ title, citationUrl, content }` for a single doc (raw Markdown + canonical `dev-docs.hubtel.com` URL). | **Always** after `get_docs_catalog`, on the 1–3 best `id`s. This is the step that returns real content — do not answer from the catalogue alone. |
| `audit_packages` | `{ packages: [{ packageName, packageType: 'npm' \| 'nuget', version }] }` → per-package trust/vulnerability data from Hubtel's CCI compliance registry, including `isTrusted`, `isVulnerable`, `isSafeVersion`, `recommendedVersion`, `alternativePackages`, package health. | **Proactively, before any** `npm/yarn/pnpm add`, `dotnet add package`, `nuget install`, `Install-Package`, or edit to `package.json` / `*.csproj` / lockfiles. Batch all packages into one call. |
| `get_guidelines_catalog` | `{ query?, domains?, limit? }` — at least one of `query` or `domains` required. Pass `domains` (e.g. `["backend"]`, `["frontend"]`; also `mobile`/`devops` where present) to list every guideline in those domains, or a natural-language `query` to rank the most relevant guidelines. Returns a **flat list** of `{ domain, scope, name, description }`. | **First** step before writing or editing code. It only lists which guidelines exist — you must then call `get_guideline`. |
| `get_guideline` | `{ guidelines: [{ domain, scope, name }] }` → the full Markdown `content` for each guideline. | **Always** after `get_guidelines_catalog`. **Batch every needed guideline into one call**, read it, and conform the code to it. The catalog descriptions are not the guidance — the content is. |

Full details and error-handling guidance: [references/mcp-tool-reference.md](references/mcp-tool-reference.md).

## Catalog tools are step 1 of 2 — never stop at the catalog

`get_docs_catalog` and `get_guidelines_catalog` return **only an index** — ids, titles, scopes, and one-line descriptions. They contain **none** of the actual doc content or guideline rules. Fetching a catalog and then answering, or writing code, is a failure: you are acting on summaries, not the authoritative source.

Every catalog call **must** be followed, in the same turn, by the matching content call before you produce your answer or touch code:

- `get_docs_catalog` → **pick ids** → `get_doc` (1–3 ids) → then answer with citations.
- `get_guidelines_catalog` → **pick `{domain, scope, name}` refs** → `get_guideline` (batched) → then write/modify code.

Do **not** end your turn, hand back to the user, or start editing files after only the catalog call. Treat the catalog result as an intermediate step whose sole purpose is to choose the arguments for the follow-up `get_doc` / `get_guideline` call.

## Applying code-quality guidelines when writing code

When generating new code or modifying existing code in a Hubtel project, ground every change in the authoritative guidelines **before** writing:

1. **Pick the domain by manifest** — a `package.json` at the project root ⇒ **frontend**; no `package.json` (a `.nuget` file / `.csproj` / `.sln`) ⇒ **backend**. In a monorepo, decide per the directory you are editing.
2. **Discover** — call `get_guidelines_catalog({ domains: [<domain>] })` once. It returns a flat list of `{ domain, scope, name, description }`; group the entries by `scope` yourself to see what's available.
3. **Select scopes** — always include `<domain>/general`; include `<domain>/logging` **only** when the change touches logging code; include any other scope that applies to the domain and the change (e.g. `frontend/nextjs` on a Next.js app).
4. **Read** — **this step is mandatory, not optional.** Call `get_guideline` with every selected `{domain, scope, name}` batched into a single call. Do not begin editing code off the catalog descriptions alone.
5. **Adhere** — write/modify the code to conform; if guidance conflicts with the request, surface it rather than silently breaking either.

Full step-by-step and worked examples for both domains: [references/software-development-workflow.md](references/software-development-workflow.md) (Step 6b) and [references/mcp-tool-reference.md](references/mcp-tool-reference.md).

## Reference files

| File | Purpose |
|------|---------|
| [software-development-workflow.md](references/software-development-workflow.md) | Step-by-step grounding workflow |
| [hubtel-project-detection.md](references/hubtel-project-detection.md) | Rules for deciding "is this a Hubtel project?" |
| [mcp-tool-reference.md](references/mcp-tool-reference.md) | Tool schemas, calling patterns, error handling (`LOGIN_REQUIRED`) |
