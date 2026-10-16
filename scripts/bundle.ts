/**
 * Builds build/<reader>/index.js for each Lambda function: one file with every dependency
 * inside, including the AWS SDK clients, so the code doesn't depend on the SDK version
 * the Lambda runtime happens to ship.
 */
import { rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { buildSync } from 'esbuild';
import { BUILD_DIR, READERS } from '../infra/lib/secrets-stack';

const root = path.join(__dirname, '..');

for (const name of READERS) {
  const outdir = path.join(BUILD_DIR, name);
  rmSync(outdir, { recursive: true, force: true });
  const result = buildSync({
    entryPoints: [path.join(root, 'app', 'src', `${name}.ts`)],
    outfile: path.join(outdir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: true,
    sourcemap: true,
    legalComments: 'none',
    metafile: true,
  });
  // Kept outside the function folder so it isn't deployed. The bundle test reads it.
  writeFileSync(path.join(BUILD_DIR, `${name}.meta.json`), JSON.stringify(result.metafile));
  const bytes = Object.values(result.metafile.outputs).reduce((sum, o) => sum + o.bytes, 0);
  console.log(`bundled build/${name}/index.js (${(bytes / 1024).toFixed(0)} KiB with source map)`);
}
