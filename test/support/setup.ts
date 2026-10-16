// SDK clients resolve their Region on the first send(). Nothing in the tests may reach AWS:
// every endpoint points at a closed local port, so a client that a test forgot to mock
// fails at once with ECONNREFUSED instead of calling the real service.
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = 'test-only-not-a-real-secret';
process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:9';
process.env.AWS_MAX_ATTEMPTS = '1';
