# Security policy

## Reporting a problem

Please don't report security problems in public GitHub issues. Use GitHub's private vulnerability reporting on this repository (Security tab, then "Report a vulnerability").

It helps to include the file and line or the commit, the steps to reproduce, and what an attacker could do with it.

## How this stack protects itself

[docs/security.md](docs/security.md) has the details and the reasons. In short:

- No secret value appears in the CloudFormation template, the function settings, a response or a log line.
- Each function's role can read one secret and one parameter, and nothing else.
- The role may use the KMS key only through Secrets Manager or Parameter Store, and only for that secret or parameter.
- The readers refuse a parameter stored as a plain String instead of a SecureString.
