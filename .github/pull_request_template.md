## Problem

<!-- What user, contributor, or contract problem does this solve? Link the issue. -->

Closes #

## Approach

<!-- Explain the smallest coherent solution and important alternatives rejected. -->

## Architecture and scale

<!-- Which boundaries, contracts, security properties, or production-gap entries change? Write "None" when genuinely none. -->

## Verification

<!-- List exact commands and outcomes. Add screenshots/recordings for visible UI changes. -->

```text
./bin/test
```

## Checklist

- [ ] The change stays within the documented public scope, or the proposal was discussed first.
- [ ] Tests name the regression or invariant they protect.
- [ ] Tenant scoping, authentication, redaction, and concurrency were considered where relevant.
- [ ] Generated artifacts were regenerated from their source rather than edited by hand.
- [ ] User-facing behavior, contributor workflow, architecture notes, and ADRs were updated where relevant.
- [ ] The production gap register still describes the implementation honestly.
- [ ] No credentials, cookies, provider keys, distinct IDs, or person data are included.
- [ ] I understand and can explain every submitted change, including AI-assisted work.
