/**
 * A client for the AWS Parameters and Secrets Lambda Extension. The extension runs a
 * small HTTP server inside the execution environment on localhost, keeps its own cache,
 * and calls Secrets Manager or Parameter Store on a miss.
 */
import type { ReadValue } from './aws-readers';

export interface ExtensionClientOptions {
  /** PARAMETERS_SECRETS_EXTENSION_HTTP_PORT, 2773 by default. */
  port: number;
  /** The extension only answers requests that carry the function's session token. */
  sessionToken: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class ExtensionClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ExtensionClientOptions) {
    this.base = `http://localhost:${options.port}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async secret(secretId: string): Promise<ReadValue> {
    const body = await this.get(`/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`);
    const out = body as { SecretString?: string; VersionId?: string };
    if (typeof out.SecretString !== 'string' || typeof out.VersionId !== 'string') {
      throw new Error(`Extension returned no SecretString for ${secretId}`);
    }
    return { value: out.SecretString, version: out.VersionId };
  }

  async secureParameter(name: string): Promise<ReadValue> {
    const body = await this.get(`/systemsmanager/parameters/get?name=${encodeURIComponent(name)}&withDecryption=true`);
    const p = (body as { Parameter?: { Value?: string; Version?: number; Type?: string } }).Parameter;
    if (typeof p?.Value !== 'string' || typeof p.Version !== 'number') {
      throw new Error(`Extension returned no value for ${name}`);
    }
    if (p.Type !== 'SecureString') {
      throw new Error(`Parameter ${name} must be a SecureString, found ${p.Type}`);
    }
    return { value: p.Value, version: String(p.Version) };
  }

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      headers: { 'X-Aws-Parameters-Secrets-Token': this.options.sessionToken },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 3000),
    });
    if (!res.ok) {
      // Don't echo the body: on some errors it can include the request details.
      throw new Error(`Parameters and Secrets extension answered ${res.status} for ${path.split('?')[0]}`);
    }
    return res.json();
  }
}
