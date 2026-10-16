/**
 * Creates or replaces the SecureString parameter. CloudFormation can't create SecureString
 * parameters, so this runs once after `npm run deploy`.
 *
 *   npm run put-parameter            # generates a random 32-byte value
 *
 * The value is never printed. It is encrypted with the stack's customer managed key.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

interface Outputs {
  SecretsCostChoice: { ParameterName: string; KeyArn: string };
}

async function main(): Promise<void> {
  const outputs = (JSON.parse(readFileSync('cdk-outputs.json', 'utf8')) as Outputs).SecretsCostChoice;
  const value = randomBytes(32).toString('base64url');
  const out = await new SSMClient({}).send(
    new PutParameterCommand({
      Name: outputs.ParameterName,
      Type: 'SecureString',
      KeyId: outputs.KeyArn,
      Value: value,
      Tier: 'Standard', // free to store; advanced would add a monthly charge per parameter
      Overwrite: true,
      Description: 'Demo value for secrets-cost-choice. Safe to delete.',
    }),
  );
  console.log(`${outputs.ParameterName} is now version ${out.Version} (${out.Tier}), encrypted with ${outputs.KeyArn}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
