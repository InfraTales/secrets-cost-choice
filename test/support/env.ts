export const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:secrets-cost-choice/partner-api-key-AbCdEf';
export const PARAMETER_NAME = '/secrets-cost-choice/db-password';
export const SECRET_VALUE = 'demo-secret-value-not-real-0000000000000';
export const PARAMETER_VALUE = 'demo-parameter-value-not-real-111111111';

/**
 * Loads a handler module fresh, with its own module-level state, under the given env,
 * the way a new execution environment would. `before` runs inside the same isolated
 * module registry, so mocks applied there patch the copy of the SDK the handler uses.
 */
export function loadHandler<T, B = undefined>(
  modulePath: string,
  env: Record<string, string>,
  before?: () => B,
): { mod: T; extra: B } {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    let mod!: T;
    let extra!: B;
    jest.isolateModules(() => {
      extra = (before ? before() : undefined) as B;
      mod = require(modulePath) as T;
    });
    return { mod, extra };
  } finally {
    process.env = saved;
  }
}
