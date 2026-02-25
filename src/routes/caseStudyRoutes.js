const express = require('express');
const multer = require('multer');
const {
  getCaseStudies,
  getCaseStudyById,
  createCaseStudy,
  updateCaseStudy,
  deleteCaseStudy,
} = require('../controllers/caseStudyController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const caseStudyUploads = upload.fields([{ name: 'resultImages', maxCount: 20 }]);

router.get('/', getCaseStudies);
router.get('/:id', getCaseStudyById);
router.post('/', caseStudyUploads, createCaseStudy);
router.put('/:id', caseStudyUploads, updateCaseStudy);
router.delete('/:id', deleteCaseStudy);

module.exports = router;
