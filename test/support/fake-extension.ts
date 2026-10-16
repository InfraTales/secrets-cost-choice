/**
 * A stand-in for the Parameters and Secrets Lambda Extension: the same two HTTP paths,
 * the same token check, on a random local port. It records every request.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeExtension {
  port: number;
  requests: { path: string; token: string | undefined }[];
  /** Answer the next requests with this status instead of the value. */
  failNext(status: number, times?: number): void;
  close(): Promise<void>;
}

export async function startFakeExtension(opts: {
  token: string;
  secrets: Record<string, string>;
  parameters: Record<string, { value: string; type: 'SecureString' | 'String' }>;
}): Promise<FakeExtension> {
  const requests: FakeExtension['requests'] = [];
  let failures: { status: number; left: number } | undefined;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const token = req.headers['x-aws-parameters-secrets-token'] as string | undefined;
    requests.push({ path: `${url.pathname}${url.search}`, token });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (token !== opts.token) return send(401, { message: 'missing or wrong X-Aws-Parameters-Secrets-Token' });
    if (failures && failures.left > 0) {
      failures.left -= 1;
      return send(failures.status, { message: 'secret detail that must not be echoed' });
    }
    if (url.pathname === '/secretsmanager/get') {
      const id = url.searchParams.get('secretId') ?? '';
      const value = opts.secrets[id];
      if (value === undefined) return send(400, { message: 'ResourceNotFoundException' });
      return send(200, { ARN: id, SecretString: value, VersionId: 'v-1', VersionStages: ['AWSCURRENT'] });
    }
    if (url.pathname === '/systemsmanager/parameters/get') {
      const name = url.searchParams.get('name') ?? '';
      const p = opts.parameters[name];
      if (p === undefined) return send(400, { message: 'ParameterNotFound' });
      const decrypt = url.searchParams.get('withDecryption') === 'true';
      const value = p.type === 'SecureString' && !decrypt ? 'AQICAH-ciphertext' : p.value;
      return send(200, { Parameter: { Name: name, Type: p.type, Value: value, Version: 7 } });
    }
    return send(404, { message: 'unknown path' });
  });

  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    failNext: (status, times = 1) => (failures = { status, left: times }),
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
