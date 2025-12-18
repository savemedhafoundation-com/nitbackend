const { extractReportText, explainReport, cleanText } = require('../services/reportService');

const uploadReport = async (req, res, next) => {
  try {
    const { text, metadata } = await extractReportText(req.file);

    return res.status(200).json({
      rawText: cleanText(text),
      metadata: {
        ...metadata,
        mimetype: req.file?.mimetype,
        size: req.file?.size,
        filename: req.file?.originalname,
      },
    });
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    return next(error);
  }
};

const generateExplanation = async (req, res, next) => {
  try {
    const rawText = req.body?.rawText;
    if (!rawText || !String(rawText).trim()) {
      return res.status(400).json({ message: 'rawText is required' });
    }

    const patient = {
      age: req.body?.age ?? req.body?.patient?.age ?? null,
      gender: req.body?.gender ?? req.body?.patient?.gender ?? req.body?.patient?.sex ?? null,
    };

    const report = await explainReport({ rawText, patient });
    return res.status(200).json(report);
  } catch (error) {
    if (error.statusCode) {
      res.status(error.statusCode);
    }
    return next(error);
  }
};

module.exports = {
  uploadReport,
  generateExplanation,
};
