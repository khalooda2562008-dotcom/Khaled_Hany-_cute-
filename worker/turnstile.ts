export interface TurnstileResult {
  success: boolean;
  errors: string[];
}

/**
 * Server-side Turnstile verification (https://developers.cloudflare.com/turnstile/).
 * Fails closed: any network/parse problem is treated as a failed challenge.
 */
export async function verifyTurnstileToken(
  token: string | null,
  secret: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!token) return { success: false, errors: ['missing-input-response'] };
  if (!secret) return { success: false, errors: ['missing-secret'] };

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (remoteIp) body.append('remoteip', remoteIp);

  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await response.json()) as { success?: boolean; 'error-codes'?: string[] };
    return {
      success: data.success === true,
      errors: Array.isArray(data['error-codes']) ? data['error-codes'] : [],
    };
  } catch {
    return { success: false, errors: ['internal-error'] };
  }
}
