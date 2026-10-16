/** The real extension-reader handler against a fake extension on localhost. */
import type { ReaderResult } from '../../app/src/cached-reader';
import { fingerprint } from '../../app/src/fingerprint';
import { PARAMETER_NAME, PARAMETER_VALUE, SECRET_ARN, SECRET_VALUE, loadHandler } from '../support/env';
import { startFakeExtension, type FakeExtension } from '../support/fake-extension';

const TOKEN = 'session-token-for-tests';
let ext: FakeExtension;

beforeEach(async () => {
  ext = await startFakeExtension({
    token: TOKEN,
    secrets: { [SECRET_ARN]: SECRET_VALUE },
    parameters: { [PARAMETER_NAME]: { value: PARAMETER_VALUE, type: 'SecureString' } },
  });
});
afterEach(() => ext.close());

const load = (env: Record<string, string> = {}) =>
  loadHandler<{ handler: () => Promise<ReaderResult> }>('../../app/src/extension-reader', {
    SECRET_ID: SECRET_ARN,
    PARAMETER_NAME,
    PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: String(ext.port),
    ...env,
  }).mod.handler;

/** The handler reads AWS_SESSION_TOKEN per call, as Lambda sets it for each invocation. */
async function invoke(handler: () => Promise<ReaderResult>, token: string | null = TOKEN) {
  const saved = process.env.AWS_SESSION_TOKEN;
  if (token === null) delete process.env.AWS_SESSION_TOKEN;
  else process.env.AWS_SESSION_TOKEN = token;
  try {
    return await handler();
  } finally {
    if (saved === undefined) delete process.env.AWS_SESSION_TOKEN;
    else process.env.AWS_SESSION_TOKEN = saved;
  }
}

test('reads both values through the extension and returns only fingerprints', async () => {
  const result = await invoke(load());
  expect(result).toEqual({
    reader: 'lambda-extension',
    secret: { fingerprint: fingerprint(SECRET_VALUE), version: 'v-1' },
    parameter: { fingerprint: fingerprint(PARAMETER_VALUE), version: '7' },
  });
  expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
});

test('sends the session token, encodes names, and asks for decryption', async () => {
  await invoke(load());
  expect(ext.requests.map((r) => r.token)).toEqual([TOKEN, TOKEN]);
  expect(ext.requests.map((r) => r.path).sort()).toEqual([
    `/secretsmanager/get?secretId=${encodeURIComponent(SECRET_ARN)}`,
    `/systemsmanager/parameters/get?name=${encodeURIComponent(PARAMETER_NAME)}&withDecryption=true`,
  ]);
});

test('fails without the session token', async () => {
  await expect(invoke(load(), null)).rejects.toThrow('Missing required environment variable AWS_SESSION_TOKEN');
  await expect(invoke(load(), 'someone-else')).rejects.toThrow(/answered 401/);
});

test('an extension error names the path but never echoes the response body', async () => {
  ext.failNext(500, 2);
  const err = (await invoke(load()).catch((e: unknown) => e)) as Error;
  expect(err.message).toMatch(/answered 500 for \/(secretsmanager|systemsmanager)/);
  expect(err.message).not.toContain('secret detail');
  expect(err.message).not.toContain('?');
});

test('refuses a parameter stored as a plain String', async () => {
  await ext.close();
  ext = await startFakeExtension({
    token: TOKEN,
    secrets: { [SECRET_ARN]: SECRET_VALUE },
    parameters: { [PARAMETER_NAME]: { value: PARAMETER_VALUE, type: 'String' } },
  });
  await expect(invoke(load())).rejects.toThrow('must be a SecureString, found String');
});

test('a bad port setting fails at init', () => {
  expect(() => load({ PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: '70000' })).toThrow(/PARAMETERS_SECRETS_EXTENSION_HTTP_PORT/);
});
