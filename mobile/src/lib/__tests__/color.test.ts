// color.test.ts
import { AVATAR_TINTS, avatarTint } from '../color';

describe('avatarTint', () => {
  it('is deterministic per user', () => {
    expect(avatarTint('0199a1b2-aaaa')).toEqual(avatarTint('0199a1b2-aaaa'));
  });
  it('always returns one of the palette pairs', () => {
    for (const id of ['a', 'bb', 'ccc', '0199', 'user-123', 'z']) expect(AVATAR_TINTS).toContainEqual(avatarTint(id));
  });
});
