/**
 * Reads one Secrets Manager secret and one SecureString parameter with the AWS SDK,
 * through an in-process cache. One cache per execution environment, created at init.
 */
import { SSMClient } from '@aws-sdk/client-ssm';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { readSecret, readSecureParameter, type ReadValue } from './aws-readers';
import { requireEnv, intEnv } from './config';
import { fingerprint } from './fingerprint';
import { TtlCache, type CacheStats } from './ttl-cache';

export interface ReaderResult {
  reader: 'in-process-cache' | 'lambda-extension';
  secret: { fingerprint: string; version: string };
  parameter: { fingerprint: string; version: string };
  cache?: CacheStats;
}

export interface CachedReaderDeps {
  secretId: string;
  parameterName: string;
  ttlSeconds: number;
  secrets: SecretsManagerClient;
  ssm: SSMClient;
  now?: () => number;
}

export function createCachedReader(deps: CachedReaderDeps): () => Promise<ReaderResult> {
  const cache = new TtlCache<ReadValue>({ ttlMs: deps.ttlSeconds * 1000, now: deps.now });
  return async () => {
    const [secret, parameter] = await Promise.all([
      cache.get(`secret:${deps.secretId}`, () => readSecret(deps.secrets, deps.secretId)),
      cache.get(`parameter:${deps.parameterName}`, () => readSecureParameter(deps.ssm, deps.parameterName)),
    ]);
    return {
      reader: 'in-process-cache',
      secret: { fingerprint: fingerprint(secret.value), version: secret.version },
      parameter: { fingerprint: fingerprint(parameter.value), version: parameter.version },
      cache: cache.stats(),
    };
  };
}

// Config is read at init. A missing variable fails the cold start, not the hundredth request.
const read = createCachedReader({
  secretId: requireEnv('SECRET_ID'),
  parameterName: requireEnv('PARAMETER_NAME'),
  ttlSeconds: intEnv('CACHE_TTL_SECONDS', 300, [0, 3600]),
  secrets: new SecretsManagerClient({}),
  ssm: new SSMClient({}),
});

export const handler = (): Promise<ReaderResult> => read();
