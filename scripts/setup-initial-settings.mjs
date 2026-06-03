import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const owner = process.env.GITHUB_OWNER || 'sunpotflower4460-cpu';
const repo = process.env.GITHUB_REPO || 'Orchestra-merger';
const repoSlug = `${owner}/${repo}`;
const pat = process.env.ORCHESTRA_PAT || '';
const dryRun = /^true$/i.test(process.env.DRY_RUN || '');
const providedTopic = process.env.NTFY_TOPIC || '';
const generatedTopic = `orchestra-merger-${randomBytes(24).toString('hex')}`;
const ntfyTopic = providedTopic || generatedTopic;
const docsExists = existsSync(path.join(process.cwd(), 'docs'));

const labels = [
  {
    name: 'draft',
    color: '6e7781',
    description: 'Initial issue draft; not executable',
  },
  {
    name: 'needs-polish',
    color: 'fbca04',
    description: 'Needs clarification before launch review',
  },
  {
    name: 'ready-for-launch',
    color: '0e8a16',
    description: 'Approved for launch; waiting to be queued',
  },
  {
    name: 'queued',
    color: '1f6feb',
    description: 'Executable by Copilot orchestration',
  },
  {
    name: 'in-progress',
    color: 'd29922',
    description: 'Currently assigned to Copilot coding agent',
  },
  {
    name: 'failed-assignment',
    color: 'b60205',
    description: 'Copilot assignment failed; issue is queued for retry',
  },
];

function log(message = '') {
  console.log(message);
}

function info(message) {
  log(`ℹ️ ${message}`);
}

function ok(message) {
  log(`✅ ${message}`);
}

function warn(message) {
  log(`⚠️ ${message}`);
}

function fail(message) {
  log(`❌ ${message}`);
}

function maskTopicNotice() {
  if (providedTopic) {
    ok('NTFY_TOPIC is set via environment variable (value hidden).');
    return;
  }

  ok(`Generated NTFY_TOPIC candidate: ${generatedTopic}`);
  info('Copy this generated topic and register it as the NTFY_TOPIC GitHub Actions secret.');
}

function buildHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(pat ? { Authorization: 'Bearer ' + pat } : {}),
  };
}

async function githubRequest(apiPath, { method = 'GET', body, allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: buildHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let data = null;

  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = rawText;
    }
  }

  if (!response.ok) {
    if (allow404 && response.status === 404) {
      return { status: response.status, data };
    }

    const details =
      typeof data === 'object' && data && 'message' in data
        ? data.message
        : rawText || response.statusText;

    throw new Error(`GitHub API ${method} ${apiPath} failed (${response.status}): ${details}`);
  }

  return { status: response.status, data };
}

async function ensureLabel(label) {
  const labelPath = `/repos/${owner}/${repo}/labels/${encodeURIComponent(label.name)}`;
  const current = await githubRequest(labelPath, { allow404: true });

  if (current.status === 404) {
    if (dryRun) {
      info(`[dry-run] Would create label "${label.name}".`);
      return;
    }

    await githubRequest(`/repos/${owner}/${repo}/labels`, {
      method: 'POST',
      body: label,
    });
    ok(`Created label "${label.name}".`);
    return;
  }

  const currentLabel = current.data;
  const needsUpdate =
    currentLabel.color?.toLowerCase() !== label.color.toLowerCase() ||
    (currentLabel.description || '') !== label.description;

  if (!needsUpdate) {
    ok(`Label "${label.name}" already matches the expected configuration.`);
    return;
  }

  if (dryRun) {
    info(`[dry-run] Would update label "${label.name}" to the expected color/description.`);
    return;
  }

  await githubRequest(labelPath, {
    method: 'PATCH',
    body: {
      new_name: label.name,
      color: label.color,
      description: label.description,
    },
  });
  ok(`Updated label "${label.name}" to the expected configuration.`);
}

async function ensureAutoMerge() {
  const repoResponse = await githubRequest(`/repos/${owner}/${repo}`);
  const allowAutoMerge = Boolean(repoResponse.data?.allow_auto_merge);

  if (allowAutoMerge) {
    ok('Allow auto-merge is already enabled.');
    return;
  }

  if (dryRun) {
    info('[dry-run] Would enable Allow auto-merge.');
    return;
  }

  try {
    await githubRequest(`/repos/${owner}/${repo}`, {
      method: 'PATCH',
      body: { allow_auto_merge: true },
    });
    ok('Enabled Allow auto-merge.');
  } catch (error) {
    warn(String(error.message));
    warn('Manual fallback: Settings → General → Pull Requests → Allow auto-merge をオンにしてください。');
  }
}

async function ensurePages() {
  if (!docsExists) {
    warn('Local docs directory does not exist yet, so Pages source setup is skipped.');
    warn('Manual fallback: Issue 1 で /docs を作成した後に再実行するか、Settings → Pages で main /docs を設定してください。');
    return;
  }

  const desiredSource = { branch: 'main', path: '/docs' };

  try {
    const current = await githubRequest(`/repos/${owner}/${repo}/pages`, { allow404: true });

    if (current.status === 404) {
      if (dryRun) {
        info('[dry-run] Would create GitHub Pages configuration for main /docs.');
        return;
      }

      await githubRequest(`/repos/${owner}/${repo}/pages`, {
        method: 'POST',
        body: { source: desiredSource },
      });
      ok('Created GitHub Pages configuration for main /docs.');
      return;
    }

    const currentSource = current.data?.source || {};
    if (currentSource.branch === desiredSource.branch && currentSource.path === desiredSource.path) {
      ok('GitHub Pages is already configured for main /docs.');
      return;
    }

    if (dryRun) {
      info('[dry-run] Would update GitHub Pages source to main /docs.');
      return;
    }

    await githubRequest(`/repos/${owner}/${repo}/pages`, {
      method: 'PUT',
      body: { source: desiredSource },
    });
    ok('Updated GitHub Pages source to main /docs.');
  } catch (error) {
    warn(String(error.message));
    warn('Pages 設定は未完了でも致命ではありません。Issue 1 完了後に再実行するか、Settings → Pages で main /docs を設定してください。');
  }
}

async function inspectBranchProtection() {
  const branchResponse = await githubRequest(`/repos/${owner}/${repo}/branches/main`, { allow404: true });

  if (branchResponse.status === 404) {
    warn('main branch was not found. Branch protection guidance is skipped.');
    return;
  }

  const protectionResponse = await githubRequest(`/repos/${owner}/${repo}/branches/main/protection`, { allow404: true });

  if (protectionResponse.status === 404) {
    warn('main branch protection is not configured yet.');
    info('Recommendation: configure branch protection manually after CI workflow names are finalized so that required checks do not block merges unexpectedly.');
    return;
  }

  ok('main branch protection already exists.');
  info('Keep required status checks minimal until workflow names are finalized.');
}

function printSecretGuidance() {
  const ghAvailable = spawnSync('gh', ['--version'], { stdio: 'ignore' }).status === 0;
  const setPatCommand = `printf '%s' "$ORCHESTRA_PAT" | gh secret set ORCHESTRA_PAT --repo ${repoSlug} --body -`;
  const setTopicCommand = `printf '%s' "$NTFY_TOPIC" | gh secret set NTFY_TOPIC --repo ${repoSlug} --body -`;

  log('');
  info('GitHub Actions secret registration guidance:');
  if (!providedTopic) {
    log(`   export NTFY_TOPIC='${ntfyTopic}'`);
  }
  log(`   ${setPatCommand}`);
  log(`   ${setTopicCommand}`);

  if (ghAvailable) {
    ok('gh CLI was detected. The commands above can register the secrets without echoing values in logs.');
  } else {
    warn('gh CLI was not detected. Install GitHub CLI or register ORCHESTRA_PAT / NTFY_TOPIC manually in Settings → Secrets and variables → Actions.');
  }
}

async function main() {
  log(`Repository: ${repoSlug}`);
  log(`Mode: ${dryRun ? 'dry-run' : 'apply'}`);
  maskTopicNotice();
  printSecretGuidance();
  log('');

  if (!pat) {
    fail('ORCHESTRA_PAT is not set. API-based setup steps were skipped.');
    info('Export ORCHESTRA_PAT and rerun this script to create labels, enable auto-merge, and inspect Pages / branch protection.');
    process.exitCode = 1;
    return;
  }

  try {
    await githubRequest(`/repos/${owner}/${repo}`);
    ok('Repository access check succeeded.');
  } catch (error) {
    fail(String(error.message));
    process.exitCode = 1;
    return;
  }

  for (const label of labels) {
    await ensureLabel(label);
  }

  await ensureAutoMerge();
  await ensurePages();
  await inspectBranchProtection();

  log('');
  ok('Initial setup automation finished.');
  info('Run `node scripts/check-initial-settings.mjs` after setup to verify readiness for Issue 1.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
