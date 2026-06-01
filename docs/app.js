(() => {
  const OWNER = 'sunpotflower4460-cpu';
  const REPO = 'Orchestra-merger';
  const API_BASE = 'https://api.github.com';
  const PAT_STORAGE_KEY = 'orchestra_merger_pat';

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
    }
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
      throw new Error(buildGithubErrorMessage(response.status, payload, rateLimitRemaining));
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

  async function loadQueue() {
    const refreshButton = document.getElementById('refresh-queue-button');
    const listEl = document.getElementById('queue-list');
    const prevContent = listEl ? listEl.innerHTML : null;

    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = '読み込み中...';
    }

    try {
      const issues = await fetchQueuedIssues();
      queuedIssues = issues;
      renderQueuedIssues(issues);
      appendLog(`queued Issue を取得しました: ${issues.length} 件`, 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`queued Issue の取得に失敗しました: ${message}`, 'error');
      if (listEl && prevContent !== null) {
        listEl.innerHTML = prevContent;
      }
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = '更新';
      }
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
      await loadQueue();
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

    await loadQueue();
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
        clearPat();
        setStatus('auth-status', '未設定', 'info');
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
        loadQueue().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          appendLog(`予期しないエラー: ${message}`, 'error');
        });
      });
    }
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
  };

  window.appState = {
    get queuedIssues() {
      return queuedIssues;
    },
  };

  if (appLog) {
    appLog.textContent = '';
  }
  appendLog(`対象リポジトリ: ${OWNER}/${REPO}`, 'info');
  bindEvents();
  restoreAuthStateOnLoad().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('auth-status', `認証失敗: ${message}`, 'error');
    appendLog(`初期化エラー: ${message}`, 'error');
  });
  registerServiceWorker();
})();
