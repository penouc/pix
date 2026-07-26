import { execSync } from 'node:child_process';

export function slowOperation() {
  execSync('sleep 30');
  return 'done';
}
