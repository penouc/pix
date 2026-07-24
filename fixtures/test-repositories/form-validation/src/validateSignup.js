export function validateSignup({ email, password }) {
  if (!email.includes('@')) return 'Email is invalid';
  if (!password) return 'Password is required';
  return null;
}
