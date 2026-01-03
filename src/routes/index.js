const express = require('express');
const authRoutes = require('./authRoutes');
const infoRoutes = require('./infoRoutes');
const patientRoutes = require('./patientRoutes');
const chatRoutes = require('./chatRoutes');
const symptomCheckerRoutes = require('./symptomCheckerRoutes');
const reportRoutes = require('./reportRoutes');
const blogRoutes = require('./blogRoutes');

const router = express.Router();

router.use('/', chatRoutes);
router.use('/auth', authRoutes);
router.use('/content', infoRoutes);
router.use('/patient', patientRoutes);
router.use('/checker', symptomCheckerRoutes);
router.use('/reports', reportRoutes);
router.use('/blogs', blogRoutes);

module.exports = router;
