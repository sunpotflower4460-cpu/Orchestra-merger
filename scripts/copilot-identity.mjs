import { readFileSync } from 'node:fs';

const policyPath = new URL('../docs/config/copilot-identities.json', import.meta.url);
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const normalizePrefixes = Array.isArray(policy.normalize_prefixes) ? policy.normalize_prefixes : [];
const normalizedIdentities = Array.isArray(policy.identities)
  ? policy.identities.map((login) => normalizeLogin(login, normalizePrefixes))
  : [];
const identitySet = new Set(normalizedIdentities);

function normalizeLogin(login, prefixes = normalizePrefixes) {
  const raw = typeof login === 'string' ? login.trim() : '';
  const lower = raw.toLowerCase();
  for (const prefix of prefixes) {
    if (typeof prefix === 'string' && lower.startsWith(prefix.toLowerCase())) {
      return lower.slice(prefix.length);
    }
  }
  return lower;
}

function isCopilotIdentity(login) {
  return identitySet.has(normalizeLogin(login));
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

  process.stderr.write('Usage: node scripts/copilot-identity.mjs <normalize|is-copilot|identities-json> [login]\n');
  process.exitCode = 1;
}

main();
