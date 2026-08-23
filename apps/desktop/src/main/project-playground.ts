import path from 'node:path';

import { app } from 'electron';

import { canonicalProjectPath } from '@pi-desktop/database';

/** App-owned scratch workspace — not a user project folder. */
export function playgroundDir(): string {
  return path.join(app.getPath('userData'), 'playground');
}

export function isPlaygroundPath(projectPath: string): boolean {
  try {
    return (
      canonicalProjectPath(projectPath) === canonicalProjectPath(playgroundDir())
    );
  } catch {
    return false;
  }
}

export function playgroundDisplayName(name: string): string {
  return name === 'playground' ? 'Scratch playground' : name;
}
