'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

function createTradeRouters(service) {
  const publicRouter = express.Router(), privateRouter = express.Router();
  const limit = (max, windowMs) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many trade requests. Please try again later.' } });
  publicRouter.use(limit(120, 60000));
  publicRouter.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  privateRouter.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.via_api_key) return res.status(403).json({ error: 'Trade settings and inbox require a login session' });
    next();
  });
  const handle = work => async (req, res) => {
    try { await work(req, res); }
    catch (error) {
      if (!error.status) console.error('Trade portal request failed', error.code || 'INTERNAL_ERROR');
      res.status(error.status || 500).json({ error: error.status ? error.message : 'Could not process trade request' });
    }
  };
  publicRouter.get('/:token', handle(async (req, res) => res.json(await service.listing(req.params.token))));
  publicRouter.post('/:token/quote', limit(30, 60000), handle(async (req, res) => res.json(await service.quote(req.params.token, req.body || {}))));
  const portalSubmissions = rateLimit({ windowMs: 3600000, max: 50, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => req.params.token,
    message: { error: 'This trade page has received too many requests. Please try again later.' } });
  publicRouter.post('/:token/requests', limit(5, 3600000), portalSubmissions, handle(async (req, res) => {
    const saved = await service.submit(req.params.token, req.body || {});
    res.status(saved.replayed ? 200 : 201).json(saved);
  }));
  privateRouter.get('/settings', handle(async (req, res) => res.json(await service.settings(req.user.id))));
  privateRouter.put('/settings', handle(async (req, res) => res.json(await service.update(req.user.id, req.body || {}))));
  privateRouter.post('/rotate', handle(async (req, res) => res.json(await service.rotate(req.user.id))));
  privateRouter.get('/requests', handle(async (req, res) => res.json(await service.inbox(req.user.id, req.query.before == null ? null : Number(req.query.before)))));
  privateRouter.post('/requests/:id/notify', limit(10, 60000), handle(async (req, res) => res.json({ notification: await service.retry(req.user.id, req.params.id) })));
  privateRouter.delete('/requests/:id', handle(async (req, res) => {
    await service.remove(req.user.id, req.params.id); res.json({ ok: true });
  }));
  return { publicRouter, privateRouter };
}

module.exports = { createTradeRouters };
