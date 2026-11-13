import { createApp } from './app';

/**
 * Local-only harness for `wrangler dev -c wrangler.dev.toml`.
 * It is never deployed: the production entry point is worker/index.ts and it
 * always verifies a real Cloudflare Access JWT.
 */
export default createApp({
  identify: async () => ({ sub: 'local-development-user', email: 'local@localhost' }),
});
