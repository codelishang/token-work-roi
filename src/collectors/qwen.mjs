import { configuredPaths, expandPath } from '../collector-config.mjs';
import { collectStructuredUsage } from './structured-usage.mjs';

export const CLIENT_KEY = 'qwen';
export const SOURCE_LABEL = 'Qwen Code';

export function roots() {
  return configuredPaths('qwen', 'roots', ['~/.qwen', '~/.qwen-code'])
    .map(expandPath)
    .filter(Boolean);
}

export async function collect(pricingData = null) {
  return collectStructuredUsage({ clientKey: CLIENT_KEY, roots: roots(), pricingData });
}
