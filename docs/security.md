# Security notes

## No values in the template

Secrets Manager generates the secret at deploy time (`GenerateSecretString`), so the template only holds the rules for making it. CloudFormation can't create SecureString parameters, so `scripts/put-parameter.ts` creates the parameter after the deploy, from a random value it doesn't print. The functions get the secret ARN and the parameter name as settings, not the values. A template test checks each of these.

## Access to the values

Each function has its own role with no managed policies:

| Statement | Resource | Condition |
|---|---|---|
| `secretsmanager:GetSecretValue` | The one secret | none |
| `ssm:GetParameter` | The one parameter | none |
| `kms:Decrypt` | The stack's key | `kms:ViaService` is Secrets Manager, and `kms:EncryptionContext:SecretARN` is the secret's ARN |
| `kms:Decrypt` | The stack's key | `kms:ViaService` is Parameter Store, and `kms:EncryptionContext:PARAMETER_ARN` is the parameter's ARN |
| `logs:CreateLogStream`, `logs:PutLogEvents` | The function's own log group | none |

The two KMS conditions each close a gap:

- `kms:ViaService` means the role can't call KMS itself to decrypt something. Only Secrets Manager or Parameter Store can use the key for it.
- The encryption context pins each grant to one secret or one parameter. Parameter Store sends `PARAMETER_ARN`, and Secrets Manager sends `SecretARN` and `SecretVersionId`. Without this condition, the role could decrypt any other secret or parameter that uses the same key, as long as it also had read access to it.

## The extension's token

The Parameters and Secrets Lambda Extension only answers requests that carry the `X-Aws-Parameters-Secrets-Token` header set to the function's session token. The extension reader reads `AWS_SESSION_TOKEN` on each call. Lambda doesn't set that variable in every initialization mode. With SnapStart, for example, the function gets credentials from a container endpoint instead, and this reader would need changing.

## The readers refuse plain String parameters

A secret stored by mistake as a String parameter sits in Parameter Store unencrypted. Both readers check the parameter type and fail if it isn't SecureString.

## Accepted cdk-nag finding

The stack acknowledges `AwsSolutions-SMG4` (no automatic rotation) on the secret. It stands in for a third-party API key from a company that isn't a Secrets Manager integration partner, so only the issuer can rotate it. If the issuer is an integration partner, a [managed external secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/managed-external-secrets.html) rotates the key with no Lambda function in your account. [runbook.md](runbook.md) has the manual steps.
