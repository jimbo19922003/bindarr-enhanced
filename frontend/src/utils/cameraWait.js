export function cameraRequestWithDeadline(start, { timeoutMs = 20000, stage = 'camera permission or hardware startup' } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      const error = new Error(`Timed out waiting for ${stage}. Check Chrome site camera permission and operating-system camera access. If using an embedded Codespaces preview, open the forwarded app in its own browser tab. The browser request may still be pending; any late stream will be stopped.`);
      error.name = 'CameraTimeoutError';
      reject(error);
    }, timeoutMs);
    const failed = error => {
      if (finished) return;
      finished = true; clearTimeout(timer); reject(error);
    };
    try {
      Promise.resolve(start()).then(value => {
        if (finished) {
          try { for (const track of value?.getTracks?.() || []) { try { track.stop(); } catch { /* Release every other track too. */ } } } catch { /* Enumeration results are not streams. */ }
          return;
        }
        finished = true; clearTimeout(timer); resolve(value);
      }, failed);
    } catch (error) { failed(error); }
  });
}
