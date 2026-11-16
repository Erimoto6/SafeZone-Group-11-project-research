const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../auth');
const { wrap } = require('../http');
const simulation = require('../simulation');
router.get('/', requireAuth, require('../poll-limit'), wrap(async (req, res) => res.json(await simulation.read())));
router.get('/history', requireAuth, wrap(async (req,res)=>res.json(await require('../simulation-history').read(req.query))));
router.post('/', requireAdmin, wrap(async (req, res) => res.json(await simulation.control(req.body || {}))));
module.exports = router;
