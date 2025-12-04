const express = require('express');
const { getPatientProfile } = require('../controllers/patientController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/profile', protect, getPatientProfile);

module.exports = router;
