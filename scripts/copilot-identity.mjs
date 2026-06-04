import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const policyPath = new URL('../docs/config/copilot-identities.json', import.meta.url);
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const normalizePrefixes = Array.isArray(policy.normalize_prefixes) ? policy.normalize_prefixes : [];
const normalizedIdentities = Array.isArray(policy.identities)
  ? policy.identities.map((login) => normalizeLogin(login, normalizePrefixes))
  : [];
const identitySet = new Set(normalizedIdentities);

function normalizeLogin(login, prefixList = normalizePrefixes) {
  const raw = typeof login === 'string' ? login.trim() : '';
  const lower = raw.toLowerCase();
  for (const prefix of prefixList) {
    if (typeof prefix === 'string' && lower.startsWith(prefix.toLowerCase())) {
      return lower.slice(prefix.length);
    }
  }
  return lower;
}

function isCopilotIdentity(login) {
  return identitySet.has(normalizeLogin(login));
}

function toJqNormalizeFilter() {
  const escapedPrefixes = normalizePrefixes.map((prefix) =>
    prefix
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\//g, '\\/'),
  );
  return escapedPrefixes.reduce((expression, prefix) => `${expression} | sub("^${prefix}"; "")`, 'ascii_downcase');
}

function main() {
  const [command = '', value = ''] = process.argv.slice(2);

  if (command === 'normalize') {
    process.stdout.write(normalizeLogin(value));
    return;
  }
  if (command === 'is-copilot') {
    process.stdout.write(isCopilotIdentity(value) ? 'true' : 'false');
    return;
  }
  if (command === 'identities-json') {
    process.stdout.write(JSON.stringify(normalizedIdentities));
    return;
  }
  if (command === 'jq-normalize-filter') {
    process.stdout.write(toJqNormalizeFilter());
    return;
  }

  process.stderr.write('Usage: node scripts/copilot-identity.mjs <normalize|is-copilot|identities-json|jq-normalize-filter> [login]\n');
  process.exitCode = 1;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}

export { normalizeLogin, isCopilotIdentity, normalizedIdentities, toJqNormalizeFilter };
