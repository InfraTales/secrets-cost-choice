# Contributing

Thanks for helping. This repo compares two AWS services on cost and behaviour, so every change has to keep the numbers and the tests honest.

## Setup

You need Node.js 24 and npm.

```bash
npm ci
npm run check   # type check, lint, bundle, all tests, synth with cdk-nag
```

## Layout

| Path | What's there |
|---|---|
| `app/src/ttl-cache.ts` | The in-process cache |
| `app/src/cached-reader.ts` | Lambda handler that reads through the SDK and the cache |
| `app/src/extension-reader.ts` | Lambda handler that reads through the Parameters and Secrets extension |
| `infra/lib/secrets-stack.ts` | The CDK stack, IAM policies and key |
| `test/unit`, `test/flow`, `test/infra` | Cache tests, handler tests, template and bundle tests |
| `scripts/` | Bundling, creating the parameter, and the smoke test |

## What a change needs

- A test that fails without it. For a bug, write the failing test first.
- For a safeguard, break it once on purpose and check that a test fails.
- No secret values in responses, logs or error messages.
- A written reason for any cdk-nag acknowledgement, scoped to the construct it's about.
- A source for any price or limit you add to the docs: the AWS Price List API or an AWS docs page.

## Pull requests

Branch from `main`, keep each pull request to one change, and explain why in the description. CI must pass before merge.

Found a security problem? Don't open a public issue. [SECURITY.md](SECURITY.md) says where to send it.
