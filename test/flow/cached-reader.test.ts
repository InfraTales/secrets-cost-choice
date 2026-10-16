/**
 * The real cached-reader handler, with the AWS SDK clients mocked at the send() level.
 * Each test loads the module fresh, the way a new execution environment would.
 */
import type { ReaderResult } from '../../app/src/cached-reader';
import { fingerprint } from '../../app/src/fingerprint';
import { PARAMETER_NAME, PARAMETER_VALUE, SECRET_ARN, SECRET_VALUE, loadHandler } from '../support/env';

type SsmModule = typeof import('@aws-sdk/client-ssm');
type SmModule = typeof import('@aws-sdk/client-secrets-manager');
type MockModule = typeof import('aws-sdk-client-mock');

function load(ttl = '300', env: Record<string, string> = {}) {
  const { mod, extra } = loadHandler<{ handler: () => Promise<ReaderResult> }, ReturnType<typeof mocks>>(
    '../../app/src/cached-reader',
    { SECRET_ID: SECRET_ARN, PARAMETER_NAME, CACHE_TTL_SECONDS: ttl, ...env },
    mocks,
  );
  return { handler: mod.handler, ...extra };
}

function mocks() {
  const { mockClient } = require('aws-sdk-client-mock') as MockModule;
  const SSM = require('@aws-sdk/client-ssm') as SsmModule;
  const SM = require('@aws-sdk/client-secrets-manager') as SmModule;
  const sm = mockClient(SM.SecretsManagerClient);
  const ssm = mockClient(SSM.SSMClient);
  sm.on(SM.GetSecretValueCommand, { SecretId: SECRET_ARN }).resolves({ SecretString: SECRET_VALUE, VersionId: 'v-1' });
  // Only answers when WithDecryption is true. Without it, Parameter Store returns ciphertext.
  ssm
    .on(SSM.GetParameterCommand, { Name: PARAMETER_NAME, WithDecryption: true })
    .resolves({ Parameter: { Name: PARAMETER_NAME, Type: 'SecureString', Value: PARAMETER_VALUE, Version: 3 } });
  return {
    sm,
    ssm,
    secretCalls: () => sm.commandCalls(SM.GetSecretValueCommand).length,
    parameterCalls: () => ssm.commandCalls(SSM.GetParameterCommand).length,
    GetParameterCommand: SSM.GetParameterCommand,
  };
}

afterEach(() => jest.useRealTimers());

test('a cold start with 25 parallel invocations makes one call to each API', async () => {
  const t = load();
  const results = await Promise.all(Array.from({ length: 25 }, () => t.handler()));

  expect(t.secretCalls()).toBe(1);
  expect(t.parameterCalls()).toBe(1);
  for (const r of results) {
    expect(r.secret).toEqual({ fingerprint: fingerprint(SECRET_VALUE), version: 'v-1' });
    expect(r.parameter).toEqual({ fingerprint: fingerprint(PARAMETER_VALUE), version: '3' });
  }
});

test('the response carries fingerprints, never the values', async () => {
  const body = JSON.stringify(await load().handler());
  expect(body).not.toContain(SECRET_VALUE);
  expect(body).not.toContain(PARAMETER_VALUE);
});

test('values are reused for the TTL, then read again', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-15T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const t = load('300');

  await t.handler();
  jest.setSystemTime(new Date('2026-10-15T10:04:59Z'));
  await t.handler();
  expect(t.secretCalls()).toBe(1);

  jest.setSystemTime(new Date('2026-10-15T10:05:00Z'));
  const after = await t.handler();
  expect(t.secretCalls()).toBe(2);
  expect(t.parameterCalls()).toBe(2);
  expect(after.cache).toEqual({ hits: 2, loads: 4, failures: 0 });
});

test('a throttled read fails this invocation only; the next one reads again', async () => {
  const t = load();
  t.ssm
    .on(t.GetParameterCommand, { Name: PARAMETER_NAME, WithDecryption: true })
    .rejectsOnce(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }))
    .resolves({ Parameter: { Name: PARAMETER_NAME, Type: 'SecureString', Value: PARAMETER_VALUE, Version: 3 } });

  await expect(t.handler()).rejects.toThrow('Rate exceeded');
  const ok = await t.handler();
  expect(ok.parameter.fingerprint).toBe(fingerprint(PARAMETER_VALUE));
  expect(t.parameterCalls()).toBe(2);
  // The secret loaded fine the first time and stayed cached.
  expect(t.secretCalls()).toBe(1);
});

test('refuses a parameter stored as a plain String', async () => {
  const t = load();
  t.ssm
    .on(t.GetParameterCommand, { Name: PARAMETER_NAME, WithDecryption: true })
    .resolves({ Parameter: { Name: PARAMETER_NAME, Type: 'String', Value: PARAMETER_VALUE, Version: 1 } });
  await expect(t.handler()).rejects.toThrow('must be a SecureString, found String');
});

test('a missing setting fails at init, before any request', () => {
  expect(() => loadHandler('../../app/src/cached-reader', { SECRET_ID: '', PARAMETER_NAME })).toThrow(
    'Missing required environment variable SECRET_ID',
  );
  expect(() =>
    loadHandler('../../app/src/cached-reader', { SECRET_ID: SECRET_ARN, PARAMETER_NAME, CACHE_TTL_SECONDS: '-5' }),
  ).toThrow(/CACHE_TTL_SECONDS/);
});
