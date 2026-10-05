// errors.test.ts
import { friendlyError } from '../errors';
const apiErr = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('friendlyError', () => {
  it('maps auth failures', () => {
    expect(friendlyError(apiErr(401, 'unauthorized'), 'signin')).toBe('Wrong email or password');
    expect(friendlyError(apiErr(409, 'conflict: email already registered'), 'signup')).toBe('An account with this email already exists');
  });
  it('maps network and server failures', () => {
    expect(friendlyError(new TypeError('Network request failed'), 'generic')).toBe("Can't reach Homesy. Check your connection.");
    expect(friendlyError(apiErr(503, 'database unavailable'), 'generic')).toBe('Something went wrong on our side. Try again.');
  });
  it('passes through validation messages and falls back', () => {
    expect(friendlyError(apiErr(400, 'title required'), 'generic')).toBe('title required');
    expect(friendlyError('weird', 'generic')).toBe('Something went wrong.');
  });
});
