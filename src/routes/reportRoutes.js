const express = require('express');
const multer = require('multer');
const { uploadReport, generateExplanation } = require('../controllers/reportController');

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
  },
});

router.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, err => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large. Max size is 8MB.'
          : 'Unsupported file type. Please upload PDF, JPG, or PNG.';
      return res.status(400).json({ message });
    }
    if (err) {
      return next(err);
    }
    return uploadReport(req, res, next);
  });
});

router.post('/explain', generateExplanation);

module.exports = router;
