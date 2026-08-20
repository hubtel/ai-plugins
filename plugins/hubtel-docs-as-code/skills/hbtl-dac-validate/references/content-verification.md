# Content Verification Utility

## Purpose

Guidelines for verifying documentation content against source materials to prevent hallucination. Used by all documentation generation and update tasks.

## Core Principle

**⚠️ CRITICAL: If content cannot be verified, DO NOT generate it. Use placeholders instead.**

## Verification Workflow

### Step 1: Identify What CAN Be Verified

Before generating any content, analyze available sources:

**Code Sources:**

_❌ STRICTLY EXCLUDE: Any file listed in `.gitignore`, `.env` files (except `.env.example`), certificates, or keys._

- Source code files (logic, patterns, structure)
- Configuration files (appsettings.json, config.yaml, .env.example)
- Package manifests (package.json, requirements.txt, \*.csproj)
- Docker/deployment files (Dockerfile, docker-compose.yml, k8s manifests)
- Database migrations and schemas
- Test files (reveal expected behavior)
- API route definitions

**External Sources (User-Provided):**

- OneDrive briefs and documents
- Architecture diagrams (draw.io, Lucidchart)
- Sprint recordings/transcripts
- Meeting notes

### Step 2: Categorize Information

Sort all information into categories:

```yaml
verified:
  # Content directly from code/config
  - technology_stack: 'From package.json, *.csproj'
  - api_endpoints: 'From route definitions'
  - database_type: 'From docker-compose.yml'
  - dependencies: 'From package manifest'

inferred:
  # Reasonable inference, flag for review
  - architectural_pattern: 'Appears to be MVC based on folder structure'
  - authentication_method: 'JWT detected in middleware, needs confirmation'

unknown:
  # Cannot be determined - ASK USER
  - business_context: 'Why does this system exist?'
  - target_users: 'Who uses this?'
  - external_integrations_purpose: 'What do these services do?'
```

### Step 3: Use Appropriate Markers

**For VERIFIED content (from code/config):**

```markdown
**Database:** PostgreSQL  
_Source: `docker-compose.yml` line 12_

**Framework:** ASP.NET Core 8.0  
_Source: `Hubtel.Api.csproj`_
```

**For INFERRED content (reasonable guess, needs review):**

```markdown
**Architecture Pattern:** Repository Pattern  
_⚠️ INFERRED from folder structure - verify with team_
```

**For UNKNOWN content (cannot determine):**

```markdown
**Business Context:**  
[NEEDS_INPUT: Please describe why this system exists and what business problem it solves]

**Key Integrations:**  
Found 3 external API clients but cannot determine their purpose:

- `PaymentGatewayClient.cs` - [TODO: Describe payment integration purpose]
- `SmsServiceClient.cs` - [TODO: Describe SMS service purpose]
- `NotificationClient.cs` - [TODO: Describe notification service purpose]
```

## Placeholder Format Standards

### [NEEDS_INPUT: description]

Use when information must come from user:

```markdown
[NEEDS_INPUT: Business context - why does this system exist?]
[NEEDS_INPUT: Target users - who uses this system?]
[NEEDS_INPUT: Service tier - Critical/High/Medium/Low]
```

### [VERIFY_WITH_TEAM: assumption]

Use when you made a reasonable assumption that needs confirmation:

```markdown
[VERIFY_WITH_TEAM: Assumed this service handles payment processing based on class names]
[VERIFY_WITH_TEAM: Inferred rate limiting is 100 req/min from RateLimitMiddleware]
```

### [TODO: missing info]

Use for incomplete sections that need research:

```markdown
[TODO: Document failure modes for the message queue consumer]
[TODO: Add monitoring dashboard links]
[TODO: List common operational issues and solutions]
```

## Source Citation Format

Always cite sources for verifiable claims:

### Inline Citations

```markdown
The system uses **Redis** for caching (_Source: `appsettings.json`_) and **PostgreSQL**
for persistent storage (_Source: `docker-compose.yml`_).
```

### Block Citations

```markdown
## Technology Stack

| Component     | Technology | Source               |
| ------------- | ---------- | -------------------- |
| Runtime       | .NET 8.0   | `*.csproj`           |
| Database      | PostgreSQL | `docker-compose.yml` |
| Cache         | Redis      | `appsettings.json`   |
| Message Queue | Kafka      | `KafkaConfig.cs`     |
```

### File Reference Citations

````markdown
Authentication is handled via JWT tokens with the following configuration:

```json
// From: appsettings.json, lines 24-31
{
  "Jwt": {
    "Issuer": "hubtel-api",
    "ExpiryMinutes": 60
  }
}
```
````

```

## User Prompting Guidelines

When information cannot be verified, prompt the user:

### For Business Context

```

I've analyzed the codebase but cannot determine the business context.

Please provide:

1. Why does this system exist? What problem does it solve?
2. Who are the primary users?
3. What's the business impact if this system goes down?

```

### For Unknown Integrations

```

I found the following external service integrations but cannot determine their purpose:

1. `PaymentGatewayClient.cs` - What payment provider is this?
2. `SmsServiceClient.cs` - What does this SMS integration do?
3. `NotificationClient.cs` - What notifications does this send?

Please describe each integration's purpose.

```

### For Architectural Decisions

```

I found several architectural patterns but need context:

1. Why was Redis chosen for caching over alternatives?
2. Why is Kafka used instead of RabbitMQ?
3. Why is the system split into multiple microservices?

If you have ADR documents or meeting notes, please share them.

````

## Verification Checklist

Before generating any documentation section, verify:

- [ ] All technology claims verified from package manifests or config files
- [ ] API endpoints verified from route definitions
- [ ] Database schemas verified from migrations or models
- [ ] External integrations verified from client code
- [ ] Configuration verified from config files
- [ ] Business context provided by user OR marked as [NEEDS_INPUT]
- [ ] All inferences clearly marked with ⚠️ INFERRED
- [ ] Unverifiable claims use appropriate placeholder markers
- [ ] Sources cited for all factual claims

## What NOT To Do

❌ **Never fabricate:**

- Business context you don't know
- Integration purposes you can't verify
- API behavior not in the code
- Configuration values you haven't seen
- Performance metrics not documented
- User flows not evident from code
- Team/ownership information not provided

✅ **Instead:**

- Use placeholders
- Ask the user
- Mark as INFERRED with warning
- Leave section empty with TODO marker
- Cite only what you can verify

## Example: Before and After

### ❌ WRONG (Hallucinated)

```markdown
## Overview

The Quick Commerce system enables fast delivery of groceries and
essential items to customers within 30 minutes. It processes over
10,000 orders daily and integrates with 15 third-party services
including Stripe, Twilio, and SendGrid.
````

### ✅ CORRECT (Verified + Placeholders)

```markdown
## Overview

[NEEDS_INPUT: Please describe the business purpose of this system]

**Technology Stack:** _(Verified from codebase)_

- Runtime: ASP.NET Core 8.0 (_Source: `*.csproj`_)
- Database: PostgreSQL (_Source: `docker-compose.yml`_)

**External Integrations Found:** _(Purpose unverified)_

- Payment integration detected (_Source: `PaymentGatewayClient.cs`_) - [TODO: Confirm provider and purpose]
- SMS service detected (_Source: `SmsServiceClient.cs`_) - [TODO: Describe functionality]

[NEEDS_INPUT: Order volume and performance metrics]
[NEEDS_INPUT: Complete list of third-party integrations with purposes]
```

This utility ensures documentation is accurate, traceable, and never fabricated! 📚
