/**
 * /api/slack — connection management for the authenticated user.
 *
 * NOTE: the OAuth *callback* is NOT here. It lives at /auth/slack/callback
 * (mounted in app.ts) so the path matches SLACK_REDIRECT_URI exactly — a mismatch
 * between the registered redirect URL and the actual route is the most common
 * cause of "invalid_redirect_uri" during setup.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  handleSlackConnect,
  handleSlackDisconnect,
  handleSlackStatus,
  handleSlackTest,
} from '../controllers/slack.controller';

const router = Router();

router.use(requireAuth);

router.get('/status', handleSlackStatus);
router.get('/connect', handleSlackConnect);
router.post('/disconnect', handleSlackDisconnect);
router.post('/test', handleSlackTest);

export default router;
