const express = require('express');
const multer = require('multer');
const { auditMutation } = require('../middleware/auditMutation');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const {
  getCaseStudies,
  getCaseStudyById,
  createCaseStudy,
  updateCaseStudy,
  deleteCaseStudy,
} = require('../controllers/caseStudyController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 20, fields: 60, fieldSize: 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Result images must be JPEG, PNG or WebP.');
      error.statusCode = 415;
      return callback(error);
    }
    return callback(null, true);
  },
});
const caseStudyUploads = upload.fields([{ name: 'resultImages', maxCount: 20 }]);

router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });

router.get('/', getCaseStudies);
router.get('/:id', getCaseStudyById);
router.post('/', protect, requireAdmin, auditMutation('case-study.create.requested'), caseStudyUploads, createCaseStudy);
router.put('/:id', protect, requireAdmin, auditMutation('case-study.update.requested'), caseStudyUploads, updateCaseStudy);
router.delete('/:id', protect, requireAdmin, auditMutation('case-study.delete.requested'), deleteCaseStudy);

const adminCaseStudyRouter = express.Router();
adminCaseStudyRouter.use(protect, requireAdmin);
adminCaseStudyRouter.use((_req, res, next) => { res.locals.caseStudyAdmin = true; next(); });
adminCaseStudyRouter.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
adminCaseStudyRouter.get('/', getCaseStudies);
adminCaseStudyRouter.get('/:id', getCaseStudyById);
adminCaseStudyRouter.post('/', auditMutation('case-study.create.requested'), caseStudyUploads, createCaseStudy);
adminCaseStudyRouter.put('/:id', auditMutation('case-study.update.requested'), caseStudyUploads, updateCaseStudy);
adminCaseStudyRouter.delete('/:id', auditMutation('case-study.delete.requested'), deleteCaseStudy);

const uploadError = (error, _req, res, next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ message: 'Upload exceeds the allowed image, field or size limit.' });
  if (error.statusCode === 415) return res.status(415).json({ message: error.message });
  return next(error);
};
router.use(uploadError);
adminCaseStudyRouter.use(uploadError);

module.exports = router;
module.exports.adminCaseStudyRouter = adminCaseStudyRouter;
