/**
 * /api/emails — scheduling and retrieval.
 *
 * EVERY route here is behind `requireAuth`: there is no unauthenticated access to
 * email data. Ownership is then enforced again inside the services (every query
 * filters on userId), so a bug in one layer cannot expose another user's email.
 *
 * ROUTE ORDER NOTE: `/search` is declared before `/:id` on purpose. Express
 * matches in declaration order, so `/:id` declared first would capture `/search`
 * and try to use the literal string "search" as a UUID.
 */
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import {
  emailIdParamSchema,
  listEmailsQuerySchema,
  scheduleEmailSchema,
  searchEmailsQuerySchema,
} from '../validation/email.schema';
import {
  handleCancelEmail,
  handleEmailStats,
  handleGetEmail,
  handleListScheduled,
  handleListSent,
  handleParseRecipients,
  handleScheduleEmails,
  handleSearchEmails,
} from '../controllers/email.controller';

/**
 * File upload for lead lists (features 21-26 of the brief).
 *
 * Kept in memory rather than on disk: the content is parsed immediately and never
 * stored, so there is nothing to clean up and no path-traversal surface.
 *
 * Hard limits (part of the security requirements):
 *  - 2 MB per file
 *  - one file only
 *  - .csv / .txt only, decided by extension AND mimetype
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowedExtensions = ['.csv', '.txt'];
    const allowedMimeTypes = [
      'text/csv',
      'text/plain',
      'application/csv',
      'application/vnd.ms-excel',
      'application/octet-stream', // some browsers send this for .csv
    ];
    const extension = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      callback(new Error('Only .csv and .txt files are accepted'));
      return;
    }
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(new Error(`Unsupported file type: ${file.mimetype}`));
      return;
    }
    callback(null, true);
  },
});

const router = Router();

// Every email route requires an authenticated user.
router.use(requireAuth);

router.post('/schedule', validate(scheduleEmailSchema, 'body'), handleScheduleEmails);

router.get('/scheduled', validate(listEmailsQuerySchema, 'query'), handleListScheduled);

router.get('/sent', validate(listEmailsQuerySchema, 'query'), handleListSent);

// Must come before '/:id'.
router.get('/search', validate(searchEmailsQuerySchema, 'query'), handleSearchEmails);

router.get('/stats', handleEmailStats);

/** Validates an uploaded leads file without storing anything. */
router.post('/parse-recipients', upload.single('file'), handleParseRecipients);

router.get('/:id', validate(emailIdParamSchema, 'params'), handleGetEmail);

router.post('/:id/cancel', validate(emailIdParamSchema, 'params'), handleCancelEmail);

export default router;
