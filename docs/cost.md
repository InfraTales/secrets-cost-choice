# Cost

Prices are for us-east-1, from the AWS Price List API offer files (Secrets Manager and KMS published 2026-09-11, Systems Manager 2026-10-08), checked 2026-10-15. Check them again before you rely on them.

## Price list

| Item | Price |
|---|---|
| Secrets Manager secret | $0.40 per secret per month, prorated by the hour. Each replica counts as a separate secret |
| Secrets Manager API calls | $0.05 per 10,000 |
| Parameter Store standard parameter | No charge to store |
| Parameter Store standard parameter, API calls at standard throughput | No charge |
| Parameter Store API calls with higher throughput turned on | $0.05 per 10,000 |
| Parameter Store advanced parameter | $0.05 per parameter per month, prorated by the hour, and $0.05 per 10,000 API calls |
| KMS customer managed key | $1 per month, prorated by the hour. The first and second rotations each add $1 a month, then it stops growing |
| KMS requests | $0.03 per 10,000, after 20,000 free requests a month across all Regions |
| AWS managed keys (`aws/ssm`, `aws/secretsmanager`) | No charge to store. The KMS pricing page says you pay for requests to them |

A Parameter Store API call counts once per parameter: a `GetParameters` call that returns ten parameters counts as ten.

## This stack

| Item | Monthly |
|---|---|
| KMS key | $1.00 |
| One secret | $0.40 |
| API calls, Lambda, logs | A few cents at most, inside the free allowances |
| **Total** | **About $1.40** |

## A busier function

Say one function handles 10 million invocations a month and reads two values on each.

Without a cache, that's 20 million reads. In Secrets Manager they cost $100 a month. In Parameter Store, the default limit is 40 reads per second, shared by `GetParameter`, `GetParameters` and `GetParametersByPath`. Bursts above that get throttled, and turning on higher throughput makes every call cost the same $0.05 per 10,000, so $100 again. With a customer managed key, each SecureString read is also a KMS Decrypt call: 20 million of them cost about $60.

With a 5-minute cache, each execution environment reads each value at most 12 times an hour, which is 8,640 times in a 30-day month. Ten environments that stay warm all month make 172,800 reads of two values. In Secrets Manager that's $0.86, and the same number of KMS Decrypt calls cost about $0.46 after the free 20,000.
