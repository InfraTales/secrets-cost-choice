# Runbook

## Rotate the secret by hand

The secret stands in for an API key from a company that isn't a Secrets Manager integration partner. Only that company can issue a new key, so there's no automatic rotation. If your issuer is an integration partner, use a [managed external secret](https://docs.aws.amazon.com/secretsmanager/latest/userguide/managed-external-secrets.html) instead: Secrets Manager rotates it with no Lambda function in your account.

1. Get the new key from the issuer.
2. Store it as a new version: `aws secretsmanager put-secret-value --secret-id secrets-cost-choice/partner-api-key --secret-string file://new-key.txt`. Secrets Manager moves the `AWSCURRENT` label to the new version and `AWSPREVIOUS` to the old one.
3. Wait at least 5 minutes. Both caches keep the old value for up to 300 seconds per execution environment.
4. Ask the issuer to revoke the old key.

Step 3 is the part people skip. If the issuer revokes the old key first, calls fail until every cache has expired.

## Change the parameter

Run `npm run put-parameter` again. It writes a new version with a new random value. The same 5-minute delay applies.

Parameter Store keeps 100 versions. If the oldest version has a label, a new write fails instead of dropping it, so remove old labels you no longer need.

## Common errors

| Error | Likely cause |
|---|---|
| `ParameterNotFound` from either reader | `npm run put-parameter` hasn't run yet |
| `AccessDeniedException` mentioning KMS | The parameter was written with a different key, so the encryption context or key doesn't match the role's grant. Rewrite it with `npm run put-parameter` |
| `must be a SecureString, found String` | Someone stored the value as a plain String. Delete it and run `npm run put-parameter` |
| `ThrottlingException` from Parameter Store | More than 40 reads per second across the account and Region. Check that the cache works before you turn on higher throughput |
| `answered 401` from the extension reader | The session token header didn't match. See the SnapStart note in [security.md](security.md) |
