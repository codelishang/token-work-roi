import { configuredPaths, expandPath } from '../collector-config.mjs';
import { collectStructuredUsage } from './structured-usage.mjs';

export const CLIENT_KEY = 'goose';
export const SOURCE_LABEL = 'Goose';

export function roots() {
  return configuredPaths('goose', 'roots', ['~/.config/goose', '~/.goose'])
    .map(expandPath)
    .filter(Boolean);
}

export async function collect(pricingData = null) {
  return collectStructuredUsage({ clientKey: CLIENT_KEY, roots: roots(), pricingData });
}
