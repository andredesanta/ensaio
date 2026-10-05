# Security policy

## Supported versions

Ensaio is a learning project with no supported production release. The current default branch is the only version considered for security fixes.

Do not deploy Ensaio to protect real users or production traffic. Its development credentials, settings, topology, tenancy model, and missing abuse controls are documented in the [architecture and production gap register](docs/architecture-and-production-gaps.md).

## Report a vulnerability

Do not open a public issue for:

- credential or authentication bypass;
- cross-project data access;
- remote code execution;
- injection;
- exposure of secrets or person data;
- dependency vulnerabilities with a working exploit against Ensaio; or
- another issue whose public details would make exploitation easier.

Use the repository host's private vulnerability-reporting feature when it is available. Otherwise contact the project maintainer privately through the profile that owns the repository. Include:

1. affected revision and component;
2. prerequisites and smallest reproduction;
3. impact and data/capabilities exposed;
4. whether the issue has been exploited or disclosed elsewhere; and
5. a suggested fix, if you have one.

Do not include real credentials, cookies, provider keys, `distinct_id` values, or person properties. Use synthetic fixtures.

You should receive an acknowledgement within seven days. Because this is a maintainer-run learning project rather than an operated service, no remediation SLA is promised. The maintainer will coordinate disclosure after a fix or mitigation is available.

## Safe research

Please:

- test only systems and data you own;
- use the local development environment;
- stop if you access data outside your test project;
- avoid denial-of-service testing, persistence, social engineering, and destructive actions; and
- give the maintainer reasonable time to investigate before disclosure.

Good-faith research following these guidelines is welcome.

## Development credentials are not vulnerabilities

The documented `admin` / `ensaio` bootstrap account, local PostgreSQL password, development Django secret, localhost CORS policy, and absence of production deployment configuration are intentional local defaults. A path that makes those defaults remotely reachable without an explicit unsafe deployment may still be worth reporting.
