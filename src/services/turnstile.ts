interface TurnstileApi {
  render: (container: HTMLElement, options: {
    sitekey: string;
    size?: 'normal' | 'compact' | 'flexible';
    appearance?: 'always' | 'execute' | 'interaction-only';
    callback?: (token: string) => void;
    'error-callback'?: () => void;
    'timeout-callback'?: () => void;
    'expired-callback'?: () => void;
  }) => string;
  execute: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile needs a browser.'));
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Could not load Cloudflare Turnstile.'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Optional bot protection. Returns a Turnstile token for the upload request, or
 * null when Turnstile is not configured. The challenge is rendered off-screen
 * so it does not disturb the editing UI.
 */
export async function getTurnstileToken(siteKey: string | null | undefined, timeoutMs = 25_000): Promise<string | null> {
  if (!siteKey) return null;
  await loadTurnstile();
  const api = window.turnstile;
  if (!api) return null;

  return new Promise<string | null>(resolve => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:300px;height:80px;';
    document.body.appendChild(container);
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try { api.remove(widgetId); } catch { /* widget already gone */ }
      container.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const widgetId = api.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      callback: token => finish(token),
      'error-callback': () => finish(null),
      'timeout-callback': () => finish(null),
      'expired-callback': () => finish(null),
    });
    api.execute(widgetId);
  });
}
