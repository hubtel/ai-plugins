# Abuse and logic bugs

Review reachable code from the perspective of unauthenticated users, ordinary users, cross-tenant users, privileged operators, and service identities. For each sensitive action, establish who should be allowed to act, which resources they may affect, and which invariant the system must preserve.

- **Entry-point consistency**. Compare equivalent operations in the browser BFF, direct APIs, legacy routes, bulk operations, admin tools, and workers. Inspect guard ordering, missing checks on alternate branches, and trusted identity propagation.
- **Fail-open behavior**. Inspect missing values, permissive defaults, exception handlers, timeouts, stale caches, and unavailable dependencies. Check how each path handles failed authentication, failed authorization, and uncertain payment status.
- **Business logic**. Inspect state transitions, bounds and precision, resource ownership changes, ambiguous identifiers, and validation mismatches across layers. Check whether existing limits, approvals, and entitlements still apply after retries, edits, or role changes.
- **Timing and partial failure**. Check for stale state between validation and write, concurrent updates, duplicate events, out-of-order processing, and partial commits. Identify the database, workflow, or provider guarantee that preserves the invariant.
- **Compounding weaknesses**. Check whether one control implicitly depends on another service or entry point to enforce it. For example, examine whether an upstream service independently checks merchant ownership when the BFF and a background worker can both call it. Report combined impact only when the relevant connections and prerequisites are supported by evidence.

For each issue, cite the entry point, broken control, and affected resource or outcome. Describe uncertainty and the safe evidence needed to resolve it. Keep examples at the level of expected security properties and corrective controls.
