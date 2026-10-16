import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

/** What both readers return for one value. The value itself never leaves this module's callers. */
export interface ReadValue {
  value: string;
  /** Secrets Manager version ID, or the Parameter Store version number as text. */
  version: string;
}

export async function readSecret(client: SecretsManagerClient, secretId: string): Promise<ReadValue> {
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (out.SecretString === undefined || out.VersionId === undefined) {
    throw new Error(`Secret ${secretId} has no SecretString`);
  }
  return { value: out.SecretString, version: out.VersionId };
}

export async function readSecureParameter(client: SSMClient, name: string): Promise<ReadValue> {
  // WithDecryption is what makes Parameter Store call KMS Decrypt for a SecureString.
  const out = await client.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  const p = out.Parameter;
  if (p?.Value === undefined || p.Version === undefined) {
    throw new Error(`Parameter ${name} has no value`);
  }
  if (p.Type !== 'SecureString') {
    // A plain String would mean the secret sits unencrypted in Parameter Store.
    throw new Error(`Parameter ${name} must be a SecureString, found ${p.Type}`);
  }
  return { value: p.Value, version: String(p.Version) };
}
