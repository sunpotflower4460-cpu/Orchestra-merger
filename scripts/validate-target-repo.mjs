/**
 * validate-target-repo.mjs
 *
 * Validates whether a given repository slug is present in the target
 * repository registry (config/target-repos.yml) and has `enabled: true`.
 *
 * Usage:
 *   node scripts/validate-target-repo.mjs --repo owner/repo
 *   TARGET_REPO=owner/repo node scripts/validate-target-repo.mjs
 *
 * Exit codes:
 *   0 — repository is in the registry and enabled
 *   1 — repository is not in the registry, is disabled, or the registry
 *       could not be parsed
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.join(__dirname, '..', 'config', 'target-repos.yml');

// ---------------------------------------------------------------------------
// Minimal YAML parser
//
// The registry format is intentionally simple (scalar values only, no nested
// mappings beyond one level, no anchors). A full YAML library is not added as
// a dependency to keep the project dependency-free. This parser covers exactly
// the subset used by config/target-repos.yml.
// ---------------------------------------------------------------------------

/**
 * Parse the simple YAML subset used in config/target-repos.yml.
 *
 * Returns an object of shape: { targets: Array<TargetEntry> }
 *
 * @param {string} text - raw YAML content
 * @returns {{ targets: Array<{ repo: string, enabled: boolean, default_branch: string, mode: string, auto_merge: string }> }}
 */
function parseRegistryYaml(text) {
  const lines = text.split('\n');
  const targets = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // New list item under `targets:`
    const repoItemMatch = /^\s*-\s+repo:\s*(.+)/.exec(line);
    if (repoItemMatch) {
      if (current) targets.push(current);
      current = { repo: '', enabled: false, default_branch: '', mode: '', auto_merge: '' };
      current.repo = repoItemMatch[1].trim();
      continue;
    }

    if (!current) continue;

    // Scalar fields within a list item
    const fieldMatch = /^\s+(\w+):\s*(.+)/.exec(line);
    if (fieldMatch) {
      const [, key, val] = fieldMatch;
      const trimmed = val.trim();
      if (key === 'enabled') {
        current.enabled = trimmed === 'true';
      } else if (key in current) {
        current[key] = trimmed;
      }
    }
  }

  if (current) targets.push(current);

  return { targets };
}

// ---------------------------------------------------------------------------
// Resolve the requested repo slug
// ---------------------------------------------------------------------------

function resolveRequestedRepo() {
  // --repo flag
  const flagIdx = process.argv.indexOf('--repo');
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return process.argv[flagIdx + 1];
  }

  // Environment variable
  if (process.env.TARGET_REPO) {
    return process.env.TARGET_REPO;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const requestedRepo = resolveRequestedRepo();

  if (!requestedRepo) {
    console.error('❌ No target repository specified.');
    console.error('   Use --repo owner/repo or set TARGET_REPO=owner/repo');
    process.exitCode = 1;
    return;
  }

  // Normalise both sides to lower-case. GitHub owner names are case-insensitive
  // at the API level (e.g. "Owner/Repo" and "owner/repo" resolve to the same
  // resource), so a case-insensitive comparison is the correct behaviour here.
  const requestedLower = requestedRepo.toLowerCase();

  let registryText;
  try {
    registryText = readFileSync(REGISTRY_PATH, 'utf8');
  } catch (err) {
    console.error(`❌ Could not read registry at ${REGISTRY_PATH}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let registry;
  try {
    registry = parseRegistryYaml(registryText);
  } catch (err) {
    console.error(`❌ Could not parse registry: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!Array.isArray(registry.targets) || registry.targets.length === 0) {
    console.error('❌ Registry contains no targets.');
    process.exitCode = 1;
    return;
  }

  const entry = registry.targets.find((t) => t.repo.toLowerCase() === requestedLower);

  if (!entry) {
    console.error(`❌ "${requestedRepo}" is not in the target repository registry.`);
    console.error(`   Add it to config/target-repos.yml to allowlist it.`);
    process.exitCode = 1;
    return;
  }

  if (!entry.enabled) {
    console.error(`❌ "${requestedRepo}" is listed in the registry but is disabled (enabled: false).`);
    console.error(`   Set enabled: true in config/target-repos.yml to allow this repository.`);
    process.exitCode = 1;
    return;
  }

  console.log(`✅ "${requestedRepo}" is in the registry and enabled.`);
  console.log(`   default_branch : ${entry.default_branch}`);
  console.log(`   mode           : ${entry.mode}`);
  console.log(`   auto_merge     : ${entry.auto_merge}`);
}

main();
