import bcrypt from "bcryptjs";

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}
/** Minimum policy: 10+ chars with letters and digits. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}
