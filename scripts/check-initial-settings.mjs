const owner = process.env.GITHUB_OWNER || 'sunpotflower4460-cpu';
const repo = process.env.GITHUB_REPO || 'Orchestra-merger';
const repoSlug = `${owner}/${repo}`;
const pat = process.env.ORCHESTRA_PAT || '';

const results = [];

function record(status, title, detail, { blocking = false } = {}) {
  const icon = status === 'ok' ? '✅' : status === 'warning' ? '⚠️' : '❌';
  const suffix = detail ? `: ${detail}` : '';
  console.log(`${icon} ${title}${suffix}`);
  results.push({ status, blocking });
}

function buildHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(pat ? { Authorization: 'Bearer ' + pat } : {}),
  };
}

async function githubRequest(apiPath, { allow404 = false } = {}) {
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: buildHeaders(),
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

    throw new Error(`GitHub API GET ${apiPath} failed (${response.status}): ${details}`);
  }

  return { status: response.status, data };
}

async function checkRepository() {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}`);
    record('ok', 'Repository access', repoSlug);
    return response.data;
  } catch (error) {
    record('error', 'Repository access', error.message, { blocking: true });
    return null;
  }
}

async function checkLabel(name) {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {
      allow404: true,
    });

    if (response.status === 404) {
      record('error', `Label "${name}"`, 'missing', { blocking: true });
      return false;
    }

    record('ok', `Label "${name}"`, 'present');
    return true;
  } catch (error) {
    record('error', `Label "${name}"`, error.message, { blocking: true });
    return false;
  }
}

async function checkPages() {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/pages`, { allow404: true });

    if (response.status === 404) {
      record('warning', 'GitHub Pages', 'not configured yet');
      return false;
    }

    const branch = response.data?.source?.branch || '(unknown branch)';
    const pagePath = response.data?.source?.path || '(unknown path)';
    record('ok', 'GitHub Pages', `${branch} ${pagePath}`);
    return true;
  } catch (error) {
    record('warning', 'GitHub Pages', error.message);
    return false;
  }
}

async function checkBranchProtection() {
  try {
    const branchResponse = await githubRequest(`/repos/${owner}/${repo}/branches/main`, { allow404: true });

    if (branchResponse.status === 404) {
      record('warning', 'main branch', 'not found');
      return false;
    }

    const protectionResponse = await githubRequest(`/repos/${owner}/${repo}/branches/main/protection`, {
      allow404: true,
    });

    if (protectionResponse.status === 404) {
      record('warning', 'main branch protection', 'not configured yet');
      return false;
    }

    record('ok', 'main branch protection', 'configured');
    return true;
  } catch (error) {
    record('warning', 'main branch protection', error.message);
    return false;
  }
}

async function checkSecret(name) {
  try {
    const response = await githubRequest(`/repos/${owner}/${repo}/actions/secrets/${name}`, {
      allow404: true,
    });

    if (response.status === 404) {
      record('error', `Secret ${name}`, 'missing or not visible to this token', { blocking: true });
      return false;
    }

    record('ok', `Secret ${name}`, 'registered');
    return true;
  } catch (error) {
    record('error', `Secret ${name}`, error.message, { blocking: true });
    return false;
  }
}

async function main() {
  console.log(`Repository: ${repoSlug}`);

  if (!pat) {
    record('error', 'ORCHESTRA_PAT', 'environment variable is required for diagnostic checks', {
      blocking: true,
    });
    console.log('');
    console.log('NEEDS_MANUAL_ACTION');
    process.exitCode = 1;
    return;
  }

  const repository = await checkRepository();

  if (repository) {
    if (repository.allow_auto_merge) {
      record('ok', 'Allow auto-merge', 'enabled');
    } else {
      record('error', 'Allow auto-merge', 'disabled', { blocking: true });
    }
  }

  await checkLabel('draft');
  await checkLabel('needs-polish');
  await checkLabel('ready-for-launch');
  await checkLabel('queued');
  await checkLabel('in-progress');
  await checkLabel('failed-assignment');
  await checkPages();
  await checkBranchProtection();
  await checkSecret('ORCHESTRA_PAT');
  await checkSecret('NTFY_TOPIC');

  record(
    'warning',
    'Copilot Cloud agent',
    'API では確認困難です。Repository access が有効か手動確認してください。',
  );
  record(
    'warning',
    'ntfy app subscription',
    '端末側で NTFY_TOPIC を購読しているか手動確認してください。',
  );

  const hasBlockingIssue = results.some((result) => result.blocking && result.status === 'error');

  console.log('');
  console.log(hasBlockingIssue ? 'NEEDS_MANUAL_ACTION' : 'READY_FOR_ISSUE_1');
  process.exitCode = hasBlockingIssue ? 1 : 0;
}

main().catch((error) => {
  record('error', 'Diagnostic script', error instanceof Error ? error.message : String(error), {
    blocking: true,
  });
  console.log('');
  console.log('NEEDS_MANUAL_ACTION');
  process.exitCode = 1;
});
