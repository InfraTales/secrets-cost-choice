/**
 * Each function ships as one self-contained index.js. Check the bundle, then load it in a
 * separate Node.js process the way the Lambda runtime does.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { builtinModules } from 'node:module';
import * as path from 'node:path';
import { BUILD_DIR, READERS } from '../../infra/lib/secrets-stack';

describe.each(READERS.map((name) => [name]))('%s', (name) => {
  const dir = path.join(BUILD_DIR, name);

  test('index.js sits at the package root, with only its source map beside it', () => {
    expect(fs.readdirSync(dir).sort()).toEqual(['index.js', 'index.js.map']);
  });

  test('the bundle imports nothing outside Node.js itself', () => {
    // esbuild's metafile lists every import it left unbundled. Only Node built-ins may remain.
    const meta = JSON.parse(fs.readFileSync(path.join(BUILD_DIR, `${name}.meta.json`), 'utf8')) as {
      outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
    };
    const builtins = new Set(builtinModules);
    const external = Object.values(meta.outputs)
      .flatMap((o) => o.imports)
      .filter((i) => i.external)
      .map((i) => i.path.replace(/^node:/, ''))
      .filter((p) => !builtins.has(p));
    expect([...new Set(external)]).toEqual([]);
  });

  const run = (env: Record<string, string>) =>
    spawnSync(
      process.execPath,
      [
        '-e',
        // Print only the message: Node's default report quotes the minified source line.
        `try { const m = require(${JSON.stringify(path.join(dir, 'index.js'))}); console.log(typeof m.handler); }
         catch (e) { console.error(e.message); process.exit(1); }`,
      ],
      {
      env: { PATH: process.env.PATH, AWS_REGION: 'us-east-1', ...env },
      encoding: 'utf8',
      timeout: 15_000,
      },
    );

  test('loads in a clean process and exports a handler', () => {
    const out = run({ SECRET_ID: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:x', PARAMETER_NAME: '/x' });
    expect(out.stderr).toBe('');
    expect(out.stdout.trim()).toBe('function');
  });

  test('fails at load when its settings are missing', () => {
    const out = run({});
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain('Missing required environment variable SECRET_ID');
  });
});
