import { intEnv, requireEnv } from '../../app/src/config';
import { fingerprint } from '../../app/src/fingerprint';

test('requireEnv returns the value or names the missing variable', () => {
  expect(requireEnv('A', { A: 'x' })).toBe('x');
  expect(() => requireEnv('A', {})).toThrow('Missing required environment variable A');
  expect(() => requireEnv('A', { A: '' })).toThrow(/A/);
});

test('intEnv falls back, accepts whole numbers in range, and rejects the rest', () => {
  expect(intEnv('T', 300, [0, 3600], {})).toBe(300);
  expect(intEnv('T', 300, [0, 3600], { T: '0' })).toBe(0);
  expect(intEnv('T', 300, [0, 3600], { T: '60' })).toBe(60);
  for (const bad of ['-1', '3601', '1.5', 'ten']) {
    expect(() => intEnv('T', 300, [0, 3600], { T: bad })).toThrow(/T must be a whole number from 0 to 3600/);
  }
});

test('fingerprint is short, stable, and different for different values', () => {
  expect(fingerprint('a')).toMatch(/^[0-9a-f]{12}$/);
  expect(fingerprint('a')).toBe(fingerprint('a'));
  expect(fingerprint('a')).not.toBe(fingerprint('b'));
});
