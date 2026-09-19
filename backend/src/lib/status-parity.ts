/**
 * Compile-time parity check between the Prisma `EmailStatus` enum and the
 * TypeScript `EmailStatus` union declared in `src/types/index.ts`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Prisma generates its own enum type; the API layer declares a hand-written
 * union. If someone adds a status to `schema.prisma` and forgets the TypeScript
 * side (or vice versa), the worker could legally write a status the API layer
 * does not understand — a bug that only shows up in production.
 *
 * HOW IT WORKS
 * ------------
 * `Exact<A, B>` resolves to the literal type `true` only when A and B are the
 * same union in BOTH directions (so adding a member to either side breaks it).
 * Assigning `true` to an `Exact<...>` that resolved to `false` is a type error,
 * which fails `npm run typecheck` and `npm run build` — before anything ships.
 *
 * Cost: one boolean in memory. No I/O, no side effects.
 */
import type { EmailStatus as PrismaEmailStatus } from '@prisma/client';
import type { EmailStatus } from '../types';

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Must be `true`. If the Prisma enum and the TypeScript union ever drift apart,
 * this line fails to compile:
 *   error TS2322: Type 'true' is not assignable to type 'false'.
 */
export const EMAIL_STATUS_ENUM_PARITY: Exact<PrismaEmailStatus, EmailStatus> = true;
