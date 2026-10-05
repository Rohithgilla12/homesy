// color.ts
export const AVATAR_TINTS = [
  { bg: '#E9EDFB', fg: '#1F3AA8' },
  { bg: '#E3F6E9', fg: '#11652F' },
  { bg: '#FDF1DC', fg: '#8A4307' },
  { bg: '#F3EEFB', fg: '#5A33A8' },
  { bg: '#FDE7E5', fg: '#7E1910' },
  { bg: '#E2F3F6', fg: '#0F5F6D' },
] as const;

export function avatarTint(userId: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
