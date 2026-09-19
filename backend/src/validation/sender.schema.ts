/**
 * Sender validation schemas.
 *
 * A "sender" is a From-address the user is allowed to send as. It is also the
 * unit that hourly rate limits are counted against
 * (`sender:<senderId>:hour:<utc-hour>`), which is why the address is validated
 * as strictly as a recipient.
 */
import { z } from 'zod';
import { emailAddressSchema } from './email.schema';

export const createSenderSchema = z.object({
  email: emailAddressSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
});

export type CreateSenderRequest = z.infer<typeof createSenderSchema>;
