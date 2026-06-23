import { configuredPaths, expandPath } from '../collector-config.mjs';
import { collectStructuredUsage } from './structured-usage.mjs';

export const CLIENT_KEY = 'kimi';
export const SOURCE_LABEL = 'Kimi / Moonshot Coding CLI';

export function roots() {
  return configuredPaths('kimi', 'roots', ['~/.kimi', '~/.moonshot'])
    .map(expandPath)
    .filter(Boolean);
}

export async function collect(pricingData = null) {
  return collectStructuredUsage({ clientKey: CLIENT_KEY, roots: roots(), pricingData });
}
