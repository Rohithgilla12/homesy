import { inviteLink, joinCodeFrom, postAuthTarget } from '../links';

describe('invite links', () => {
  it('builds a join link from an invite code', () => {
    expect(inviteLink('az8m7x')).toBe('homesy://join/AZ8M7X');
  });
  it('accepts only valid 6-character codes', () => {
    expect(joinCodeFrom('az8m7x')).toBe('AZ8M7X');
    expect(joinCodeFrom('AZ8M7')).toBeNull();
    expect(joinCodeFrom('AZ8M7O')).toBeNull(); // O and 0, I and 1 are never issued
    expect(joinCodeFrom(undefined)).toBeNull();
  });
});

describe('postAuthTarget', () => {
  it('keeps app paths and drops auth or unknown ones', () => {
    expect(postAuthTarget('/join/AZ8M7X')).toBe('/join/AZ8M7X');
    expect(postAuthTarget('/lists/abc')).toBe('/lists/abc');
    expect(postAuthTarget('/login')).toBeNull();
    expect(postAuthTarget('/')).toBeNull();
    expect(postAuthTarget('https://evil.example/x')).toBeNull();
  });
});
