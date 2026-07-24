import path from 'node:path';

/** Basename / segment patterns that elevate risk (plan §9.3). */
const PROTECTED_BASENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials',
  'credentials.json',
  'auth.json',
  'token',
  'token.json',
  '.npmrc',
  '.pypirc',
  'secrets.yaml',
  'secrets.yml',
  'service-account.json',
]);

const PROTECTED_DIR_SEGMENTS = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.gcloud',
  '.kube',
  '.docker',
  'private_keys',
]);

/**
 * Returns true if the absolute path looks like a sensitive credential or secret location.
 */
export function isProtectedPath(absolutePath: string): boolean {
  const normalized = path.normalize(absolutePath);
  const base = path.basename(normalized).toLowerCase();
  if (PROTECTED_BASENAMES.has(base)) return true;
  if (base.startsWith('.env.')) return true;
  if (base.endsWith('.pem') || base.endsWith('.key') || base.endsWith('.p12')) return true;

  const parts = normalized.split(path.sep).map((p) => p.toLowerCase());
  return parts.some((seg) => PROTECTED_DIR_SEGMENTS.has(seg));
}
