/**
 * /api/auth — session inspection and sign-out.
 *
 * The Google OAuth *flow* itself lives on `/auth/google` (mounted in app.ts)
 * rather than under `/api`, matching the URL that is registered as the authorised
 * redirect URI in the Google Cloud console — a mismatch there is the single most
 * common OAuth setup error, so the paths are kept identical on purpose.
 */
import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.middleware';
import { handleLogout, handleMe } from '../controllers/auth.controller';

const router = Router();

router.get('/me', optionalAuth, handleMe);
router.post('/logout', handleLogout);

export default router;
