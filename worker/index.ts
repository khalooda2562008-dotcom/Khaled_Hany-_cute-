import { createApp } from './app';

/**
 * Entry point used by `wrangler deploy` (see wrangler.toml).
 * Authentication is Cloudflare Access (verify: worker/auth.ts).
 */
export default createApp();
