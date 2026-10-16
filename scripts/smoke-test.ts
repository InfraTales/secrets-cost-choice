/**
 * Checks a deployed stack. Run `npm run deploy` and `npm run put-parameter` first.
 *
 * 1. Both readers return the same fingerprints for the same values.
 * 2. The cached reader's second call in the same environment is a cache hit.
 * 3. Neither response contains anything that looks like the secret.
 */
import { readFileSync } from 'node:fs';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

interface Outputs {
  SecretsCostChoice: { CachedReaderName: string; ExtensionReaderName: string };
}
interface Result {
  reader: string;
  secret: { fingerprint: string; version: string };
  parameter: { fingerprint: string; version: string };
  cache?: { hits: number; loads: number; failures: number };
}

const lambda = new LambdaClient({});

async function invoke(name: string): Promise<Result> {
  const out = await lambda.send(new InvokeCommand({ FunctionName: name }));
  const text = new TextDecoder().decode(out.Payload);
  if (out.FunctionError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as Result;
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`FAIL: ${message}`);
  console.log(`ok: ${message}`);
}

async function main(): Promise<void> {
  const o = (JSON.parse(readFileSync('cdk-outputs.json', 'utf8')) as Outputs).SecretsCostChoice;
  const cachedFirst = await invoke(o.CachedReaderName);
  const cachedSecond = await invoke(o.CachedReaderName);
  const viaExtension = await invoke(o.ExtensionReaderName);

  check(cachedFirst.secret.fingerprint === viaExtension.secret.fingerprint, 'both readers see the same secret');
  check(cachedFirst.parameter.fingerprint === viaExtension.parameter.fingerprint, 'both readers see the same parameter');
  // Lambda may route the second call to a new environment. Then hits stays 0; run again.
  check((cachedSecond.cache?.hits ?? 0) >= 2, 'the second call in a warm environment came from the in-process cache');
  for (const r of [cachedFirst, cachedSecond, viaExtension]) {
    check(/^[0-9a-f]{12}$/.test(r.secret.fingerprint), `${r.reader} returned a fingerprint, not a value`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
