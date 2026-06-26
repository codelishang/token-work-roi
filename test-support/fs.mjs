import { rmSync } from 'node:fs';

const WINDOWS_RETRYABLE_RM_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);

export async function removeTempDir(path, { retries = process.platform === 'win32' ? 10 : 0, delayMs = 100 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt >= retries || !WINDOWS_RETRYABLE_RM_CODES.has(error?.code)) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
