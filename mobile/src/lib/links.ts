/** Invite codes use an alphabet without 0/O/1/I (backend `gen_invite_code`). */
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function joinCodeFrom(raw: string | string[] | undefined): string | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
  return v && CODE.test(v) ? v : null;
}

export const inviteLink = (code: string) => `homesy://join/${code.toUpperCase()}`;

/** Where to send someone after they sign in from a deep link: in-app paths only, never auth screens or other hosts. */
export function postAuthTarget(path: string | null | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  if (path === '/' || path.startsWith('/login') || path.startsWith('/signup')) return null;
  return path;
}
