/**
 * Browser-facing OAuth routes, mounted at the root of the server.
 *
 * WHY NOT UNDER /api: these URLs are typed into provider configuration screens
 * (Google Cloud Console, Slack app settings) as redirect URIs. Keeping them short
 * and stable — `/auth/google/callback`, `/auth/slack/callback` — means the value in
 * `.env.example`, the value in the README and the value registered with the
 * provider all read the same, which removes the single most common OAuth mistake.
 */
import { Router } from 'express';
import { handleGoogleCallback, handleGoogleStart } from '../controllers/google-auth.controller';
import { handleSlackCallback } from '../controllers/slack.controller';

const router = Router();

/** Google login. */
router.get('/google', handleGoogleStart);
router.get('/google/callback', handleGoogleCallback);

/** Slack workspace connection. */
router.get('/slack/callback', handleSlackCallback);

export default router;
