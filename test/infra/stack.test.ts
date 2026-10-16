import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { EXTENSION_LAYER_PARAMETER, PARAMETER_NAME, SecretsStack } from '../../infra/lib/secrets-stack';

const env = { account: '123456789012', region: 'us-east-1' };
const stack = new SecretsStack(new cdk.App(), 'Test', { env });
const template = Template.fromStack(stack);
const json = template.toJSON();
const resources = Object.entries<any>(json.Resources);
const ofType = (type: string) => resources.filter(([, r]) => r.Type === type);
// The partition stays a token so the same template works in every partition.
const PARAMETER_ARN = {
  'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, `:ssm:us-east-1:123456789012:parameter${PARAMETER_NAME}`]],
};

const functions = ofType('AWS::Lambda::Function');
const policies = ofType('AWS::IAM::Policy');
const statementsOf = (fnId: string) => {
  const roleId = functions.find(([id]) => id === fnId)![1].Properties.Role['Fn::GetAtt'][0];
  return policies
    .filter(([, p]) => p.Properties.Roles.some((r: any) => r.Ref === roleId))
    .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
};
const allStatements = policies.flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
const actionsOf = (s: any): string[] => [s.Action].flat();
const keyId = ofType('AWS::KMS::Key')[0]![0];
const secretId = ofType('AWS::SecretsManager::Secret')[0]![0];

describe('no plaintext secrets in the template', () => {
  test('Secrets Manager generates the value; the template carries no SecretString', () => {
    const [, secret] = ofType('AWS::SecretsManager::Secret')[0]!;
    expect(secret.Properties.SecretString).toBeUndefined();
    expect(secret.Properties.GenerateSecretString).toEqual(expect.objectContaining({ PasswordLength: 40 }));
    expect(secret.Properties.KmsKeyId).toEqual({ 'Fn::GetAtt': [keyId, 'Arn'] });
  });

  test('the stack creates no SSM parameters at all (CloudFormation cannot create a SecureString)', () => {
    expect(ofType('AWS::SSM::Parameter')).toHaveLength(0);
  });

  test('function environments hold names and ARNs, never values', () => {
    expect(functions).toHaveLength(2);
    for (const [, fn] of functions) {
      const vars = fn.Properties.Environment.Variables;
      expect(vars.SECRET_ID).toEqual({ Ref: secretId });
      expect(vars.PARAMETER_NAME).toBe(PARAMETER_NAME);
      for (const [name, value] of Object.entries<any>(vars)) {
        if (['SECRET_ID', 'PARAMETER_NAME'].includes(name)) continue;
        // Everything else is a number, a boolean flag, or a log level.
        expect(String(value)).toMatch(/^(\d+|true|false|warn)$/);
      }
    }
  });

  test('nothing in the template looks like a dynamic reference to a secret value', () => {
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/resolve:secretsmanager/);
    expect(text).not.toMatch(/resolve:ssm-secure/);
  });
});

describe('least privilege', () => {
  test('every kms:Decrypt is pinned to one service and one secret or parameter', () => {
    const decrypts = allStatements.filter((s) => actionsOf(s).some((a) => a.startsWith('kms:')));
    expect(decrypts).toHaveLength(4); // two per function
    for (const s of decrypts) {
      expect(actionsOf(s)).toEqual(['kms:Decrypt']);
      expect(s.Resource).toEqual({ 'Fn::GetAtt': [keyId, 'Arn'] });
      const cond = s.Condition.StringEquals;
      expect(Object.keys(s.Condition)).toEqual(['StringEquals']);
      expect(['secretsmanager.us-east-1.amazonaws.com', 'ssm.us-east-1.amazonaws.com']).toContain(cond['kms:ViaService']);
      if (cond['kms:ViaService'].startsWith('secretsmanager.')) {
        expect(cond['kms:EncryptionContext:SecretARN']).toEqual({ Ref: secretId });
      } else {
        expect(cond['kms:EncryptionContext:PARAMETER_ARN']).toEqual(PARAMETER_ARN);
      }
    }
  });

  test.each(functions.map(([id]) => [id]))('%s can read exactly one secret and one parameter', (fnId) => {
    const statements = statementsOf(fnId);
    const actions = statements.flatMap(actionsOf).sort();
    expect(actions).toEqual([
      'kms:Decrypt',
      'kms:Decrypt',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'secretsmanager:GetSecretValue',
      'ssm:GetParameter',
    ]);
    const find = (action: string) => statements.find((s) => actionsOf(s).includes(action));
    expect(find('secretsmanager:GetSecretValue').Resource).toEqual({ Ref: secretId });
    expect(find('ssm:GetParameter').Resource).toEqual(PARAMETER_ARN);
  });

  test('no statement uses a wildcard action or resource', () => {
    for (const s of allStatements) {
      for (const a of actionsOf(s)) expect(a).not.toContain('*');
      expect(JSON.stringify(s.Resource)).not.toMatch(/"\*"|:\*"|\/\*"/);
    }
  });

  test('roles have no managed policies', () => {
    for (const [, role] of ofType('AWS::IAM::Role')) expect(role.Properties.ManagedPolicyArns).toBeUndefined();
  });
});

describe('the key', () => {
  test('rotates yearly and is scheduled for deletion with the stack after 7 days', () => {
    template.hasResource('AWS::KMS::Key', {
      Properties: Match.objectLike({ EnableKeyRotation: true, PendingWindowInDays: 7 }),
      DeletionPolicy: 'Delete',
    });
    template.hasResourceProperties('AWS::KMS::Alias', { AliasName: 'alias/secrets-cost-choice' });
  });
});

describe('the readers', () => {
  test('both run Node.js 24 on arm64 with their own log group', () => {
    for (const [, fn] of functions) {
      expect(fn.Properties).toMatchObject({ Runtime: 'nodejs24.x', Architectures: ['arm64'], Handler: 'index.handler', Timeout: 10 });
      expect(fn.Properties.LoggingConfig.LogGroup.Ref).toMatch(/logs/);
    }
  });

  test('only the extension reader gets the layer, read from the public parameter at deploy time', () => {
    const withLayer = functions.filter(([, fn]) => fn.Properties.Layers);
    expect(withLayer.map(([id]) => id)).toEqual([expect.stringMatching(/^extensionreader/)]);
    const ref = withLayer[0]![1].Properties.Layers[0].Ref;
    expect(json.Parameters[ref]).toEqual({ Type: 'AWS::SSM::Parameter::Value<String>', Default: EXTENSION_LAYER_PARAMETER });
  });

  test('the extension caches for 300 s and gives up on a slow API after 2 s', () => {
    const [, fn] = functions.find(([id]) => id.startsWith('extensionreader'))!;
    expect(fn.Properties.Environment.Variables).toMatchObject({
      SECRETS_MANAGER_TTL: '300',
      SSM_PARAMETER_STORE_TTL: '300',
      SECRETS_MANAGER_TIMEOUT_MILLIS: '2000',
      SSM_PARAMETER_STORE_TIMEOUT_MILLIS: '2000',
      PARAMETERS_SECRETS_EXTENSION_HTTP_PORT: '2773',
    });
  });

  test('the in-process cache uses the same TTL', () => {
    const [, fn] = functions.find(([id]) => id.startsWith('cachedreader'))!;
    expect(fn.Properties.Environment.Variables.CACHE_TTL_SECONDS).toBe('300');
  });

  test('rejects a TTL the extension would refuse', () => {
    expect(() => new SecretsStack(new cdk.App(), 'Bad', { env, cacheTtlSeconds: 301 })).toThrow(/0-300/);
  });
});

test('cdk-nag AWS Solutions finds nothing unacknowledged', () => {
  const app = new cdk.App({ outdir: fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-nag-')) });
  new SecretsStack(app, 'Nag', { env });
  cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  const assembly = app.synth();
  const report = JSON.parse(fs.readFileSync(path.join(assembly.directory, 'validation-report.json'), 'utf8'));
  for (const plugin of report.pluginReports) expect(plugin.violations).toEqual([]);
  const acknowledged = report.pluginReports.flatMap((p: any) => p.suppressedViolations.map((v: any) => v.ruleName));
  expect(acknowledged).toEqual(['AwsSolutions-SMG4']);
});
