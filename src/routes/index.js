const express = require('express');
const authRoutes = require('./authRoutes');
const infoRoutes = require('./infoRoutes');
const patientRoutes = require('./patientRoutes');
const chatRoutes = require('./chatRoutes');
const symptomCheckerRoutes = require('./symptomCheckerRoutes');

const router = express.Router();

router.use('/', chatRoutes);
router.use('/auth', authRoutes);
router.use('/content', infoRoutes);
router.use('/patient', patientRoutes);
router.use('/checker', symptomCheckerRoutes);

module.exports = router;
