import { join } from 'node:path';
import { configuredPaths, expandPath } from '../collector-config.mjs';
import { collectStructuredUsage } from './structured-usage.mjs';

export const CLIENT_KEY = 'copilot';
export const SOURCE_LABEL = 'GitHub Copilot CLI';

export function roots() {
  return configuredPaths('copilot', 'roots', [
    '~/.config/github-copilot',
    '~/.copilot',
    '~/Library/Application Support/github-copilot',
    process.env.APPDATA ? join(process.env.APPDATA, 'GitHub Copilot') : null
  ]).map(expandPath).filter(Boolean);
}

export async function collect(pricingData = null) {
  return collectStructuredUsage({ clientKey: CLIENT_KEY, roots: roots(), pricingData });
}
