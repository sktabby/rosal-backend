import { randomInt } from 'crypto';

// Excludes visually ambiguous characters (0/O, 1/l/I) since this is meant to
// be read off a screen by an admin and retyped or read aloud to a user.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A random temporary password, shown once to the admin and emailed to the user. */
export function generateTemporaryPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CHARSET[randomInt(CHARSET.length)];
  }
  return out;
}
