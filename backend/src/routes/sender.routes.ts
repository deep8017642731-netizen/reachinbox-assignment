/**
 * /api/senders — managing the From-addresses a user may send as.
 *
 * Senders are the unit of rate limiting, so this is also where the dashboard reads
 * current hourly usage from.
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { createSenderSchema } from '../validation/sender.schema';
import { senderIdParamSchema } from '../validation/email.schema';
import {
  handleCreateSender,
  handleDeleteSender,
  handleListSenders,
} from '../controllers/sender.controller';

const router = Router();

router.use(requireAuth);

router.get('/', handleListSenders);
router.post('/', validate(createSenderSchema, 'body'), handleCreateSender);
router.delete('/:id', validate(senderIdParamSchema, 'params'), handleDeleteSender);

export default router;
