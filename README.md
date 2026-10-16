# Parameter Store or Secrets Manager: both, side by side

This repo puts AWS Systems Manager Parameter Store and AWS Secrets Manager next to each other in one AWS CDK stack, so you can compare what each one costs and how you read from it in AWS Lambda. It goes with the article "Parameter Store or Secrets Manager: stop paying $0.40 per secret you don't rotate".

## What's in the stack

| Piece | Why it's there |
|---|---|
| A customer managed AWS KMS key | Encrypts both values. It costs $1 a month, and it lets you write a key policy and share the secret with another account later |
| A Secrets Manager secret | Secrets Manager generates the value at deploy time, so it never appears in the template |
| A SecureString parameter | Created by `npm run put-parameter`, because CloudFormation can't create SecureString parameters |
| `cached-reader` function | Reads both values with the AWS SDK through a small in-process cache (TTL, failures not cached, one call per key at a time) |
| `extension-reader` function | Reads both values through the AWS Parameters and Secrets Lambda Extension, which keeps its own cache |

Each function has its own role. It may call `secretsmanager:GetSecretValue` on one secret and `ssm:GetParameter` on one parameter. It may call `kms:Decrypt` only when Secrets Manager or Parameter Store asks on its behalf, for that same secret or parameter. The encryption context and `kms:ViaService` conditions in `infra/lib/secrets-stack.ts` enforce that.

Neither function returns or logs a value. They return the first 12 hex characters of its SHA-256 hash, so you can compare the two readers without exposing anything.

## Run the checks

You need Node.js 24 and npm. This part runs without an AWS account.

```bash
npm ci
npm run check   # type check, lint, bundle, tests, then synth with cdk-nag
```

The tests make no calls to AWS. They mock the SDK clients, and the extension reader runs against a fake extension server on localhost. A setup file points every SDK endpoint at a closed local port, so a client that a test forgot to mock fails at once.

## Deploy

You need a CDK-bootstrapped account. The extension layer ARN comes from AWS's public parameter `/aws/service/aws-parameters-and-secrets-lambda-extension/arm64/latest` at deploy time.

```bash
npm run deploy          # writes cdk-outputs.json
npm run put-parameter   # creates the SecureString with a random value
npm run smoke           # both readers agree, and the cache gets hits
```

## Cost

Running this stack costs about $1.40 a month: $1 for the KMS key and $0.40 for the secret, both prorated by the hour. The Lambda calls fit in the free tier. [docs/cost.md](docs/cost.md) has the full price list and the math for busier functions.

## Clean up

Run `npm run destroy`. The key goes into a 7-day pending deletion window, and the secret into a recovery window. AWS doesn't charge for either while they wait. Delete the parameter yourself:

```bash
aws ssm delete-parameter --name /secrets-cost-choice/db-password
```

## More

- [docs/cost.md](docs/cost.md): prices and worked examples
- [docs/security.md](docs/security.md): the access model and why each condition is there
- [docs/runbook.md](docs/runbook.md): rotating the values and fixing common errors
- [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md)

Licensed MIT-0. Created by Rahul Ladumor / InfraTales.
