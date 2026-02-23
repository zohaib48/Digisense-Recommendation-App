import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSessionInstance, validateSession } from './sessionUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SESSION_FILE = path.join(__dirname, '..', '..', '.session-dev.json');

/**
 * Resolve a valid Shopify session.
 * 1) Prefer in-memory active session.
 * 2) Fallback to persisted dev session file.
 */
export async function resolveSessionValidation() {
  const activeValidation = validateSession(global.activeSession);
  if (activeValidation.valid) {
    return activeValidation;
  }

  try {
    const raw = await fs.readFile(SESSION_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const session = ensureSessionInstance(parsed);
    const fileValidation = validateSession(session);

    if (fileValidation.valid) {
      global.activeSession = fileValidation.session;
      return fileValidation;
    }

    return fileValidation;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Failed to read persisted session file:', error.message);
    }
    return activeValidation;
  }
}

