// server/routes/ccas.js
const express = require('express');
const router = express.Router();
const CCA = require('../models/CCA');

// @route   GET /api/ccas
// @desc    Get all CCAs
router.get('/', async (req, res) => {
  try {
    const phase = Number(req.query.phase);
    const filter = phase === 1
      ? { phase1Eligible: true }
      : phase === 2
        ? { phase2Eligible: true }
        : {};
    const ccas = await CCA.find(filter).sort({ name: 1 });
    res.json(ccas);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

module.exports = router;
