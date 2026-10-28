const express = require('express');
const authRoutes = require('./authRoutes');
const infoRoutes = require('./infoRoutes');
const patientRoutes = require('./patientRoutes');
const chatRoutes = require('./chatRoutes');
const symptomCheckerRoutes = require('./symptomCheckerRoutes');
const reportRoutes = require('./reportRoutes');
const blogRoutes = require('./blogRoutes');
const caseStudyRoutes = require('./caseStudyRoutes');
const { ebookRouter, adminEbookRouter, ebookInternalRouter } = require('./ebookRoutes');

const router = express.Router();

router.use('/', chatRoutes);
router.use('/auth', authRoutes);
router.use('/content', infoRoutes);
router.use('/patient', patientRoutes);
router.use('/clinical', require('./clinicalRoutes'));
router.use('/checker', symptomCheckerRoutes);
router.use('/reports', reportRoutes);
router.use('/blogs', blogRoutes);
router.use('/case-studies', caseStudyRoutes);
router.use('/admin/case-studies', caseStudyRoutes.adminCaseStudyRouter);
router.use('/ebooks', ebookRouter);
router.use('/admin/ebooks', adminEbookRouter);
router.use('/internal/ebooks', ebookInternalRouter);

module.exports = router;
