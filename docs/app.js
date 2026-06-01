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
      }
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
    }
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
