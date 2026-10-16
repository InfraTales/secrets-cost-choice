/**
 * Reads the same secret and parameter through the Parameters and Secrets Lambda
 * Extension. The extension owns the cache, so this handler has none of its own.
 */
import { requireEnv, intEnv } from './config';
import type { ReaderResult } from './cached-reader';
import { ExtensionClient } from './extension-client';
import { fingerprint } from './fingerprint';

const secretId = requireEnv('SECRET_ID');
const parameterName = requireEnv('PARAMETER_NAME');
const port = intEnv('PARAMETERS_SECRETS_EXTENSION_HTTP_PORT', 2773, [1, 65535]);

export async function handler(): Promise<ReaderResult> {
  // The extension checks this header against the function's own session token, so a
  // request from anything else in the environment is refused. Read it per call: it's cheap.
  const client = new ExtensionClient({ port, sessionToken: requireEnv('AWS_SESSION_TOKEN') });
  const [secret, parameter] = await Promise.all([client.secret(secretId), client.secureParameter(parameterName)]);
  return {
    reader: 'lambda-extension',
    secret: { fingerprint: fingerprint(secret.value), version: secret.version },
    parameter: { fingerprint: fingerprint(parameter.value), version: parameter.version },
  };
}
