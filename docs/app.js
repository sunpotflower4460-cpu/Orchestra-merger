(() => {
  const OWNER = 'sunpotflower4460-cpu';
  const REPO = 'Orchestra-merger';
  const API_BASE = 'https://api.github.com';
  const PAT_STORAGE_KEY = 'orchestra_merger_pat';
  // NOTE: GitHub 側の仕様変更で bot login 名が変わる可能性があるため、差し替えはこの定数で行う。
  const COPILOT_AGENT_LOGIN = 'copilot-swe-agent[bot]';
  const COPILOT_TARGET_REPO = `${OWNER}/${REPO}`;
  const COPILOT_BASE_BRANCH = 'main';
  const POLL_INTERVAL_MS = 30000;

  const STATUS_CLASS_MAP = {
    info: 'muted',
    success: 'status-success',
    warning: 'status-warning',
    error: 'status-error',
  };

  const appLog = document.getElementById('app-log');
  const patSection = document.getElementById('pat-section');
  const patInput = document.getElementById('pat-input');
  const savePatButton = document.getElementById('save-pat-button');
  const clearPatButton = document.getElementById('clear-pat-button');

  let queuedIssues = [];
  let isStartingIssue = false;
  let pollingTimerId = null;
  let isPolling = false;
  let isRefreshingProgress = false;
  let lastProgressSnapshot = null;

  function setStatus(elementId, message, type = 'info') {
    const element = document.getElementById(elementId);
    if (!element) {
      return;
    }

    element.textContent = message;
    element.classList.remove('muted', 'status-success', 'status-warning', 'status-error');
    element.classList.add(STATUS_CLASS_MAP[type] || STATUS_CLASS_MAP.info);
  }

  function appendLog(message, type = 'info') {
    if (!appLog) {
      return;
    }

    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const level = type.toUpperCase();
    const line = `[${timestamp}] [${level}] ${message}`;
    appLog.textContent = appLog.textContent ? `${appLog.textContent}\n${line}` : line;
  }

  function getPat() {
    const token = localStorage.getItem(PAT_STORAGE_KEY);
    if (!token) {
      return '';
    }

    return token.trim();
  }

  function updateAuthUi() {
    const hasPat = Boolean(getPat());

    if (patInput) {
      patInput.hidden = hasPat;
      if (!hasPat) {
        patInput.value = '';
      }
    }

    if (savePatButton) {
      savePatButton.hidden = hasPat;
    }

    if (clearPatButton) {
      clearPatButton.textContent = hasPat ? 'PAT を削除' : '入力をクリア';
    }

    if (patSection) {
      patSection.dataset.state = hasPat ? 'saved' : 'empty';
    }

    if (!hasPat) {
      setStatus('auth-status', '未設定', 'info');
      stopProgressPolling();
    }

    updateStartButtonState();
  }

  function savePat(token) {
    const normalized = String(token || '').trim();
    if (!normalized) {
      throw new Error('PAT を入力してください。');
    }
    if (/\s/.test(normalized)) {
      throw new Error('PAT に空白文字は使用できません。');
    }

    localStorage.setItem(PAT_STORAGE_KEY, normalized);
    updateAuthUi();
    return normalized;
  }

  function clearPat() {
    localStorage.removeItem(PAT_STORAGE_KEY);
    updateAuthUi();
    if (patInput) {
      patInput.focus();
    }
  }

  function buildGithubErrorMessage(status, payload, rateLimitRemaining) {
    const detail =
      payload && typeof payload.message === 'string'
        ? payload.message
        : payload && typeof payload.raw === 'string'
          ? payload.raw
          : '';

    if (status === 401) {
      return `認証に失敗しました。PAT を確認してください。${detail ? ` (${detail})` : ''}`;
    }

    if (status === 403) {
      if ((detail && detail.toLowerCase().includes('rate limit')) || (rateLimitRemaining !== null && rateLimitRemaining <= 0)) {
        return `GitHub API のレート制限に達しました。しばらく待ってから再試行してください。${detail ? ` (${detail})` : ''}`;
      }
      return `アクセスが拒否されました。PAT の権限を確認してください。${detail ? ` (${detail})` : ''}`;
    }

    if (status === 404) {
      return `対象が見つかりませんでした。パスやアクセス権を確認してください。${detail ? ` (${detail})` : ''}`;
    }

    return `GitHub API エラー (${status})${detail ? `: ${detail}` : ''}`;
  }

  async function ghFetch(path, options = {}) {
    const token = getPat();
    if (!token) {
      throw new Error('PAT が未設定です。先に PAT を保存してください。');
    }

    const pathValue = String(path || '');
    const normalizedPath = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
    const url = `${API_BASE}${normalizedPath}`;
    const hasBody = options.body !== undefined && options.body !== null;
    const body = hasBody && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body;

    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
      ...(hasBody ? { body } : {}),
    });

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    const payload = text ? safeJsonParse(text) ?? { raw: text } : null;
    const rateLimitHeader = response.headers.get('x-ratelimit-remaining');
    let rateLimitRemaining = null;
    if (rateLimitHeader !== null) {
      const parsed = Number.parseInt(rateLimitHeader, 10);
      rateLimitRemaining = Number.isNaN(parsed) ? null : parsed;
    }

    if (!response.ok) {
      const apiError = new Error(buildGithubErrorMessage(response.status, payload, rateLimitRemaining));
      apiError.githubStatus = response.status;
      apiError.githubPayload = payload;
      throw apiError;
    }

    if (!text) {
      return null;
    }

    return payload ?? text;
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function fetchQueuedIssues() {
    const allIssues = [];
    let page = 1;

    // TODO: このループは per_page=100 ずつページを送り全件取得を試みるが、
    // GitHub API の Link ヘッダは ghFetch() 経由では参照できないため
    // ページ末尾が 100 件未満になった時点で終端と判断する簡易実装です。
    while (true) {
      const path = `/repos/${OWNER}/${REPO}/issues?labels=queued&state=open&sort=created&direction=asc&per_page=100&page=${page}`;
      const batch = await ghFetch(path);

      if (!Array.isArray(batch) || batch.length === 0) {
        break;
      }

      allIssues.push(...batch);

      if (batch.length < 100) {
        break;
      }

      page++;
    }

    const issues = allIssues.filter((item) => !item.pull_request);
    issues.sort((a, b) => a.number - b.number);
    return issues;
  }

  function renderQueuedIssues(issues) {
    const countEl = document.getElementById('queue-count');
    const listEl = document.getElementById('queue-list');

    if (countEl) {
      countEl.textContent = `残り ${issues.length} 件`;
    }

    if (!listEl) {
      return;
    }

    if (issues.length === 0) {
      listEl.innerHTML = '<li class="muted">キューは空です</li>';
      return;
    }

    listEl.innerHTML = issues
      .map((issue) => {
        const number = issue.number;
        const title = escapeHtml(issue.title || '');
        const url = issue.html_url || `https://github.com/${OWNER}/${REPO}/issues/${number}`;
        return (
          `<li class="queue-item">` +
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="queue-issue-link">` +
          `<span class="queue-issue-number">#${number}</span>` +
          `<span class="queue-issue-title">${title}</span>` +
          `</a></li>`
        );
      })
      .join('');
  }

  function renderInProgressIssues(issues) {
    const listEl = document.getElementById('in-progress-list');
    if (!listEl) {
      return;
    }

    if (!Array.isArray(issues) || issues.length === 0) {
      listEl.innerHTML = '<li class="muted">処理中の Issue はありません</li>';
      return;
    }

    listEl.innerHTML = issues
      .map((issue) => {
        const number = issue.number;
        const title = escapeHtml(issue.title || '');
        const url = issue.html_url || `https://github.com/${OWNER}/${REPO}/issues/${number}`;
        return (
          `<li class="queue-item">` +
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="queue-issue-link">` +
          `<span class="queue-issue-number">#${number}</span>` +
          `<span class="queue-issue-title">${title}</span>` +
          `</a></li>`
        );
      })
      .join('');
  }

  function renderOpenPullRequests(pulls) {
    const listEl = document.getElementById('open-pr-list');
    if (!listEl) {
      return;
    }

    if (!Array.isArray(pulls) || pulls.length === 0) {
      listEl.innerHTML = '<li class="muted">オープン PR はありません</li>';
      return;
    }

    listEl.innerHTML = pulls
      .map((pr) => {
        const number = pr.number;
        const title = escapeHtml(pr.title || '');
        const url = pr.html_url || `https://github.com/${OWNER}/${REPO}/pull/${number}`;
        const login = pr.user && typeof pr.user.login === 'string' ? pr.user.login : 'unknown';
        const draftLabel = pr.draft ? ' / Draft' : '';
        const copilotLabel = login === COPILOT_AGENT_LOGIN ? ' / Copilot' : '';
        return (
          `<li class="queue-item">` +
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="queue-issue-link">` +
          `<span class="queue-issue-number">#${number}</span>` +
          `<span class="queue-issue-title">${title}</span>` +
          `</a>` +
          `<span class="muted"> by ${escapeHtml(login)}${draftLabel}${copilotLabel}</span>` +
          `</li>`
        );
      })
      .join('');
  }

  function formatDateTime(value) {
    if (!value) {
      return '-';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '-';
    }
    return date.toLocaleString('ja-JP', { hour12: false });
  }

  function renderRecentMerges(pulls) {
    const listEl = document.getElementById('recent-merge-list');
    if (!listEl) {
      return;
    }

    if (!Array.isArray(pulls) || pulls.length === 0) {
      listEl.innerHTML = '<li class="muted">最近のマージはまだありません</li>';
      return;
    }

    listEl.innerHTML = pulls
      .map((pr) => {
        const number = pr.number;
        const title = escapeHtml(pr.title || '');
        const url = pr.html_url || `https://github.com/${OWNER}/${REPO}/pull/${number}`;
        const mergedAt = formatDateTime(pr.merged_at);
        return (
          `<li class="queue-item">` +
          `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="queue-issue-link">` +
          `<span class="queue-issue-number">#${number}</span>` +
          `<span class="queue-issue-title">${title}</span>` +
          `</a>` +
          `<span class="muted"> (merged: ${escapeHtml(mergedAt)})</span>` +
          `</li>`
        );
      })
      .join('');
  }

  async function fetchInProgressIssues() {
    const path =
      `/repos/${OWNER}/${REPO}/issues?labels=in-progress&state=open&sort=created` +
      `&direction=asc&per_page=100`;
    const result = await ghFetch(path);
    const issues = Array.isArray(result) ? result.filter((item) => !item.pull_request) : [];
    issues.sort((a, b) => a.number - b.number);
    return issues;
  }

  async function fetchOpenPullRequests() {
    const path = `/repos/${OWNER}/${REPO}/pulls?state=open&sort=created&direction=desc&per_page=20`;
    const result = await ghFetch(path);
    return Array.isArray(result) ? result : [];
  }

  async function fetchRecentMergedPullRequests() {
    const path = `/repos/${OWNER}/${REPO}/pulls?state=closed&sort=updated&direction=desc&per_page=20`;
    const result = await ghFetch(path);
    const merged = Array.isArray(result) ? result.filter((item) => item && item.merged_at) : [];
    merged.sort((a, b) => {
      const timeA = new Date(a.merged_at || 0).getTime();
      const timeB = new Date(b.merged_at || 0).getTime();
      return timeB - timeA;
    });
    return merged.slice(0, 5);
  }

  function setProgressLastUpdated(message) {
    const el = document.getElementById('progress-last-updated');
    if (!el) {
      return;
    }
    el.textContent = message;
  }

  function stopProgressPolling() {
    if (pollingTimerId !== null) {
      clearInterval(pollingTimerId);
      pollingTimerId = null;
    }
    isPolling = false;
  }

  function startProgressPolling() {
    if (isPolling || pollingTimerId !== null) {
      return;
    }
    if (!getPat() || document.visibilityState !== 'visible') {
      return;
    }

    isPolling = true;
    pollingTimerId = window.setInterval(() => {
      refreshProgress().catch((error) => {
        appendLog(`進捗更新で予期しないエラーが発生しました: ${getErrorMessage(error)}`, 'error');
      });
    }, POLL_INTERVAL_MS);
  }

  async function refreshProgress(options = {}) {
    if (isRefreshingProgress) {
      return;
    }

    const withButtonState = Boolean(options.withButtonState);
    const refreshButton = document.getElementById('refresh-queue-button');
    if (withButtonState && refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = '読み込み中...';
    }

    if (!getPat()) {
      stopProgressPolling();
      if (withButtonState && refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = '更新';
      }
      return;
    }

    isRefreshingProgress = true;
    let authFailureDetected = false;

    try {
      try {
        const issues = await fetchQueuedIssues();
        queuedIssues = issues;
        renderQueuedIssues(issues);
      } catch (error) {
        appendLog(`queued Issue の取得に失敗しました: ${getErrorMessage(error)}`, 'error');
        authFailureDetected = authFailureDetected || isAuthFailure(error);
      }

      if (!authFailureDetected) {
        try {
          const inProgressIssues = await fetchInProgressIssues();
          renderInProgressIssues(inProgressIssues);
        } catch (error) {
          appendLog(`in-progress Issue の取得に失敗しました: ${getErrorMessage(error)}`, 'error');
          authFailureDetected = authFailureDetected || isAuthFailure(error);
        }
      }

      if (!authFailureDetected) {
        try {
          const openPullRequests = await fetchOpenPullRequests();
          renderOpenPullRequests(openPullRequests);
        } catch (error) {
          appendLog(`オープン PR の取得に失敗しました: ${getErrorMessage(error)}`, 'error');
          authFailureDetected = authFailureDetected || isAuthFailure(error);
        }
      }

      if (!authFailureDetected) {
        try {
          const recentMergedPullRequests = await fetchRecentMergedPullRequests();
          renderRecentMerges(recentMergedPullRequests);
          const now = new Date();
          lastProgressSnapshot = {
            queuedCount: queuedIssues.length,
            inProgressCount: document.querySelectorAll('#in-progress-list .queue-item').length,
            openPrCount: document.querySelectorAll('#open-pr-list .queue-item').length,
            recentMergeCount: recentMergedPullRequests.length,
            updatedAt: now.toISOString(),
          };
          setProgressLastUpdated(`最終更新: ${now.toLocaleTimeString('ja-JP', { hour12: false })}`);
        } catch (error) {
          appendLog(`最近のマージ情報の取得に失敗しました: ${getErrorMessage(error)}`, 'error');
          authFailureDetected = authFailureDetected || isAuthFailure(error);
        }
      }

      if (authFailureDetected) {
        stopProgressPolling();
      }
    } finally {
      isRefreshingProgress = false;
      updateStartButtonState();
      if (withButtonState && refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = '更新';
      }
    }
  }

  async function loadQueue() {
    await refreshProgress({ withButtonState: true });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      if (!getPat()) {
        return;
      }
      refreshProgress().catch((error) => {
        appendLog(`再表示時の更新に失敗しました: ${getErrorMessage(error)}`, 'error');
      });
      startProgressPolling();
      return;
    }

    stopProgressPolling();
  }

  function getLastProgressSnapshot() {
    return lastProgressSnapshot;
  }

  function getIsPolling() {
    return isPolling;
  }

  function getPollingIntervalMs() {
    return POLL_INTERVAL_MS;
  }

  function getPollingTimerId() {
    return pollingTimerId;
  }

  function getIsRefreshingProgress() {
    return isRefreshingProgress;
  }

  function updateStartButtonState() {
    const startButton = document.getElementById('start-button');
    if (!startButton) {
      return;
    }

    const canStart = Boolean(getPat()) && queuedIssues.length > 0 && !isStartingIssue;
    startButton.disabled = !canStart;
    startButton.textContent = isStartingIssue ? '開始中...' : '次の Issue を開始';
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function isAuthFailure(error) {
    const status = error && typeof error === 'object' ? error.githubStatus : null;
    return status === 401 || status === 403;
  }

  function renderInProgressIssue(issue) {
    const listEl = document.getElementById('in-progress-list');
    if (!listEl || !issue) {
      return;
    }

    const title = escapeHtml(issue.title || '');
    const number = issue.number;
    const url = issue.html_url || `https://github.com/${OWNER}/${REPO}/issues/${number}`;
    const itemHtml =
      `<li class="queue-item">` +
      `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="queue-issue-link">` +
      `<span class="queue-issue-number">#${number}</span>` +
      `<span class="queue-issue-title">${title}</span>` +
      `</a></li>`;

    const onlyPlaceholder = listEl.children.length === 1 && listEl.children[0].classList.contains('muted');
    if (onlyPlaceholder) {
      listEl.innerHTML = itemHtml;
      return;
    }
    listEl.insertAdjacentHTML('afterbegin', itemHtml);
  }

  async function assignIssueToCopilot(issue) {
    const path = `/repos/${OWNER}/${REPO}/issues/${issue.number}/assignees`;
    await ghFetch(path, {
      method: 'POST',
      body: {
        assignees: [COPILOT_AGENT_LOGIN],
        agent_assignment: {
          target_repo: COPILOT_TARGET_REPO,
          base_branch: COPILOT_BASE_BRANCH,
          // 要件どおり空文字を送って custom_* / model は Copilot 側デフォルトに委ねる。
          custom_instructions: '',
          custom_agent: '',
          model: '',
        },
      },
    });
  }

  async function addInProgressLabel(issue) {
    const path = `/repos/${OWNER}/${REPO}/issues/${issue.number}/labels`;
    await ghFetch(path, {
      method: 'POST',
      body: {
        labels: ['in-progress'],
      },
    });
  }

  async function removeQueuedLabel(issue) {
    const path = `/repos/${OWNER}/${REPO}/issues/${issue.number}/labels/queued`;
    try {
      await ghFetch(path, { method: 'DELETE' });
      return { removed: true };
    } catch (error) {
      if (error && typeof error === 'object' && error.githubStatus === 404) {
        appendLog(`Issue #${issue.number}: queued ラベルはすでに外れています (404)。`, 'warning');
        return { removed: false };
      }
      throw error;
    }
  }

  async function handleStartNextIssue() {
    if (isStartingIssue) {
      return;
    }
    if (!getPat()) {
      setStatus('start-status', '開始できません: PAT が未設定です', 'warning');
      appendLog('開始処理を中止しました: PAT が未設定です。', 'warning');
      return;
    }

    isStartingIssue = true;
    updateStartButtonState();
    setStatus('start-status', 'queued Issue を確認中...', 'info');

    try {
      const issues = await fetchQueuedIssues();
      queuedIssues = issues;
      renderQueuedIssues(issues);
      updateStartButtonState();

      if (issues.length === 0) {
        setStatus('start-status', '開始できる queued Issue はありません', 'warning');
        appendLog('開始対象の queued Issue がないため処理を終了しました。', 'warning');
        return;
      }

      // fetchQueuedIssues() が番号昇順で返すため先頭を開始対象にする。
      const targetIssue = issues[0];
      appendLog(`開始対象 Issue を選択しました: #${targetIssue.number} ${targetIssue.title || ''}`, 'info');

      setStatus('start-status', `Issue #${targetIssue.number} を Copilot に割り当て中...`, 'info');
      try {
        await assignIssueToCopilot(targetIssue);
        appendLog(`Issue #${targetIssue.number} を ${COPILOT_AGENT_LOGIN} に割り当てました。`, 'success');
      } catch (error) {
        const message = getErrorMessage(error);
        if (isAuthFailure(error)) {
          setStatus('start-status', `開始できません: 認証に失敗しました (${message})`, 'error');
          appendLog(`開始処理を中断しました: 認証エラー (${message})`, 'error');
          return;
        }
        appendLog(`Copilot 割り当てに失敗しました (#${targetIssue.number}): ${message}`, 'error');
        setStatus('start-status', `Copilot 割り当て失敗: ${message}`, 'error');
        return;
      }

      setStatus('start-status', `Issue #${targetIssue.number} に in-progress ラベルを追加中...`, 'info');
      try {
        await addInProgressLabel(targetIssue);
        appendLog(`Issue #${targetIssue.number} に in-progress ラベルを追加しました。`, 'success');
      } catch (error) {
        const message = getErrorMessage(error);
        appendLog(`in-progress ラベル追加に失敗しました (#${targetIssue.number}): ${message}`, 'error');
        appendLog(`Issue #${targetIssue.number} は割り当て済みですがラベル更新が途中で停止しました。`, 'warning');
        setStatus('start-status', `in-progress ラベル追加失敗: ${message}`, 'error');
        return;
      }

      setStatus('start-status', `Issue #${targetIssue.number} の queued ラベルを削除中...`, 'info');
      try {
        const result = await removeQueuedLabel(targetIssue);
        // removed === false は 404 を警告扱いにして継続したケース。
        if (result.removed === false) {
          appendLog(`Issue #${targetIssue.number}: queued ラベル削除はスキップしました (すでに削除済みの可能性)。`, 'warning');
        } else {
          appendLog(`Issue #${targetIssue.number} から queued ラベルを削除しました。`, 'success');
        }
      } catch (error) {
        const message = getErrorMessage(error);
        appendLog(`queued ラベル削除に失敗しました (#${targetIssue.number}): ${message}`, 'error');
        appendLog(`Issue #${targetIssue.number} は割り当て済み・in-progress 追加済みですが queued 削除で停止しました。`, 'warning');
        setStatus('start-status', `queued ラベル削除失敗: ${message}`, 'error');
        return;
      }

      renderInProgressIssue(targetIssue);
      setStatus('start-status', `開始しました: #${targetIssue.number} ${targetIssue.title || ''}`, 'success');
      appendLog(`開始処理が完了しました: #${targetIssue.number} ${targetIssue.title || ''}`, 'success');
      await loadQueue();
    } catch (error) {
      const message = getErrorMessage(error);
      if (isAuthFailure(error)) {
        setStatus('start-status', `開始できません: 認証に失敗しました (${message})`, 'error');
      } else {
        setStatus('start-status', `開始処理に失敗しました: ${message}`, 'error');
      }
      appendLog(`開始処理エラー: ${message}`, 'error');
    } finally {
      isStartingIssue = false;
      updateStartButtonState();
    }
  }

  function getQueuedIssues() {
    return queuedIssues;
  }

  async function verifyPatAndUpdateStatus() {
    setStatus('auth-status', '確認中', 'info');

    try {
      const user = await ghFetch('/user');
      const login = user && typeof user.login === 'string' ? user.login : 'unknown';
      setStatus('auth-status', `認証成功 (${login})`, 'success');
      appendLog(`GitHub 認証に成功しました: ${login}`, 'success');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('auth-status', `認証失敗: ${message}`, 'error');
      appendLog(`GitHub 認証に失敗しました: ${message}`, 'error');
      stopProgressPolling();
      return false;
    }
  }

  async function handleSavePat() {
    try {
      const inputValue = patInput ? patInput.value : '';
      savePat(inputValue);
      appendLog('PAT を保存しました。認証を確認します。', 'info');
      const isVerified = await verifyPatAndUpdateStatus();
      if (!isVerified) {
        clearPat();
        setStatus('auth-status', '認証失敗: PAT を削除しました。再設定してください。', 'error');
        // 認証失敗時はキューを読み込まない
        return;
      }
      await refreshProgress({ withButtonState: true });
      startProgressPolling();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('auth-status', message, 'warning');
      appendLog(message, 'warning');
    }
  }

  async function restoreAuthStateOnLoad() {
    updateAuthUi();

    if (!getPat()) {
      appendLog('PAT は未設定です。', 'info');
      return;
    }

    appendLog('保存済み PAT の認証状態を確認します。', 'info');
    const isVerified = await verifyPatAndUpdateStatus();
    if (!isVerified) {
      clearPat();
      setStatus('auth-status', '認証失敗: 保存済み PAT を削除しました。再設定してください。', 'error');
      // 認証失敗時はキューを読み込まない
      return;
    }

    await refreshProgress({ withButtonState: true });
    startProgressPolling();
  }

  function bindEvents() {
    if (savePatButton) {
      savePatButton.addEventListener('click', () => {
        handleSavePat().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setStatus('auth-status', `認証失敗: ${message}`, 'error');
          appendLog(`予期しないエラー: ${message}`, 'error');
        });
      });
    }

    if (clearPatButton) {
      clearPatButton.addEventListener('click', () => {
        stopProgressPolling();
        clearPat();
        setStatus('auth-status', '未設定', 'info');
        setProgressLastUpdated('最終更新: 未実行');
        appendLog('PAT を削除しました。', 'warning');
      });
    }

    const refreshQueueButton = document.getElementById('refresh-queue-button');
    if (refreshQueueButton) {
      refreshQueueButton.addEventListener('click', () => {
        if (!getPat()) {
          appendLog('PAT が未設定です。先に PAT を保存してください。', 'warning');
          return;
        }
        refreshProgress({ withButtonState: true }).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          appendLog(`予期しないエラー: ${message}`, 'error');
        });
      });
    }

    const startButton = document.getElementById('start-button');
    if (startButton) {
      startButton.addEventListener('click', () => {
        handleStartNextIssue();
      });
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => {
          appendLog('Service Worker の登録に成功しました。', 'success');
        })
        .catch(() => {
          appendLog('Service Worker の登録に失敗しました。', 'error');
        });
    });
  }

  window.OrchestraApp = {
    OWNER,
    REPO,
    API_BASE,
    PAT_STORAGE_KEY,
    getPat,
    savePat,
    clearPat,
    ghFetch,
    setStatus,
    appendLog,
    getQueuedIssues,
    handleStartNextIssue,
    refreshProgress,
    startProgressPolling,
    stopProgressPolling,
    getLastProgressSnapshot,
    getIsPolling,
    getPollingIntervalMs,
    getPollingTimerId,
    getIsRefreshingProgress,
  };

  window.appState = {
    get queuedIssues() {
      return queuedIssues;
    },
  };

  if (appLog) {
    appLog.textContent = '';
  }
  setProgressLastUpdated('最終更新: 未実行');
  appendLog(`対象リポジトリ: ${OWNER}/${REPO}`, 'info');
  bindEvents();
  restoreAuthStateOnLoad().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('auth-status', `認証失敗: ${message}`, 'error');
    appendLog(`初期化エラー: ${message}`, 'error');
  });
  registerServiceWorker();
})();
