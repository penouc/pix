import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mainEntry = path.join(root, 'apps/desktop/dist-electron/main/index.js');

export default function globalSetup() {
  if (!existsSync(mainEntry)) {
    throw new Error(
      `Electron main entry not found at ${mainEntry}.\n` +
        'Run `pnpm build` before running E2E tests.',
    );
  }
}
