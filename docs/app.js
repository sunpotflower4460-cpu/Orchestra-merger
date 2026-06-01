(() => {
  const appLog = document.getElementById('app-log');
  const logToApp = (message) => {
    if (appLog) {
      appLog.textContent = `${appLog.textContent}\n${message}`;
    }
  };

  if (appLog) {
    appLog.textContent = 'UI 骨組みの読み込みが完了しました。';
  }

  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => {
        const message = 'Service Worker の登録に成功しました。';
        console.info(message);
        logToApp(message);
      })
      .catch((error) => {
        const message = 'Service Worker の登録に失敗しました。';
        console.error(message, error);
        logToApp(message);
      });
  });
})();
