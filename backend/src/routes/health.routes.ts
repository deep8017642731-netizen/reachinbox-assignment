/**
 * /api/health — is the system able to do its job right now?
 *
 * Public (no auth) because monitoring tools and the Docker healthcheck need it,
 * and it exposes no user data — only connectivity states and queue counters.
 *
 *   GET /api/health              fast checks: PostgreSQL, Redis, Elasticsearch
 *   GET /api/health?deep=true    also opens a real SMTP connection
 *
 * 200 = healthy or degraded (search unavailable), 503 = core dependency down.
 */
import { Router } from 'express';
import { buildHealthReport } from '../services/health.service';

const router = Router();

router.get('/', async (req, res) => {
  const deep = req.query.deep === 'true';
  const { httpStatus, report } = await buildHealthReport(deep);
  res.status(httpStatus).json(report);
});

export default router;
