---
name: hbtl-project-security-review
description: >-
  Conduct a defensive source and configuration security review of a project,
  service, or pull request. Identify bugs, broken security assumptions, and
  combinations of control gaps that could enable abuse. Use for vulnerability audits, release
  reviews, login and session security, MFA and passkeys, authorization and
  tenant isolation, and software that handles payments, payouts, refunds,
  wallet balances, billing, settlement, or other financial state.
metadata:
  author: "Hubtel Enablement Team"
  version: "1.0.0"
  date_added: 20-11-2026
  last_updated: 20-11-2026
---

# Project Security Review (`/hbtl-project-security-review`)

Review in read-only mode by default. Use source, configuration, migrations, existing tests, and supplied scanner results. Keep verification defensive through code inspection and existing safe local checks with mocks or synthetic data. Avoid exploit development, vulnerability reproduction, offensive automation, live target probing, and real transactions. Redact credentials, personal data, and payment details.

## Review workflow

1. Establish scope from the request and accessible code. Record the revision or PR, services, stack, and environment evidence. For a PR, follow changed logic into shared middleware, persistence, and downstream consumers. For repos with multiple services, inventory them before prioritizing.
2. Map entry points and trust boundaries. Include browser and SSR/BFF code, public and internal APIs, identity providers, workers, schedulers, queues, webhooks, admin tools, data stores, provider integrations, and deployment configuration. Find bypass paths such as direct upstream access, alternate clients, service accounts, manual operations, and background retries.
3. Trace identity and permissions end to end using [application controls](references/application-controls.md). Follow representative paths from session creation and renewal through resource access, sensitive state changes, and revocation. Check each boundary independently.
4. Inventory every path that can change monetary value, destination, entitlement, or financial state. Use [financial controls](references/financial-controls.md). For each path, record the actor, tenant, entry point, server-side authority, persistence, external side effects, retry behavior, and reconciliation. Trace money flows before declaring broad coverage.
5. Review misuse cases using [abuse and logic bugs](references/abuse-and-logic-bugs.md). Compare intended behavior with actual code for unauthorized actors, unusual state, and failure paths. Look for security consequences in routine correctness bugs and for control gaps that compound across services.
6. Verify findings against the real entry point, middleware order, defaults, caller constraints, data model, and runtime dependencies visible in scope. Search for existing controls that could invalidate the finding. Distinguish code-supported findings from hypotheses and gaps that require deployment or provider evidence. Treat scanner output as leads and confirm affected versions and context.
7. Return findings first, ordered by severity and financial or account impact. Group shared root causes and list affected paths. Suggest a specific corrective control and safe acceptance criteria for each item. Make changes only if requested.

## Report

- **Scope and revision** with the services and flows reviewed.
- **Findings** labeled as a code-supported vulnerability, a potential vulnerability needing evidence, or a correctness bug. For security findings, state the actor's starting access, violated security invariant, and plausible business impact at a conceptual level. Describe associated control gaps together when the code supports their interaction. Include severity, confidence, file and line evidence, control failure, prerequisites, impact, and fix. Separate verified source findings from items needing evidence. Describe impact in business terms such as cross-merchant data exposure or duplicate settlement.
- **Coverage** by flow or control with statuses of Reviewed, Partially reviewed, Blocked, or Not applicable. State which remote settings, services, or provider controls were unavailable. If no issues were found, tie that result to inspected scope.
- **Remediation order** with release blockers and subsequent fixes. Use Critical for credible paths to material unauthorized money movement or broad compromise, High for substantial impact such as account takeover or cross-tenant access, Medium for limited impact or meaningful prerequisites, and Low for defense-in-depth gaps. Base priority on reach, prerequisites, scale, and existing controls. Track confidence independently.
