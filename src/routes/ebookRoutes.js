const express = require('express');
const { protect, requireAdmin } = require('../middleware/authMiddleware');
const controller = require('../controllers/ebookController');

const ebookRouter = express.Router();
const adminEbookRouter = express.Router();
const ebookInternalRouter = express.Router();

const noStore = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
ebookRouter.use(noStore);
adminEbookRouter.use(noStore);
ebookInternalRouter.use(noStore);

// The callback has no user JWT; the Blob SDK verifies its signature instead.
// It never authorizes uploads. Only the protected admin route can issue tokens.
ebookRouter.post('/blob-callback', controller.callback);
ebookRouter.get('/', controller.listPublic);
ebookRouter.get('/:id', controller.getPublic);
ebookRouter.use(controller.errorHandler);

adminEbookRouter.use(protect, requireAdmin);
adminEbookRouter.get('/config', controller.config);
adminEbookRouter.get('/', controller.listAdmin);
adminEbookRouter.post('/', controller.create);
adminEbookRouter.get('/:id', controller.getAdmin);
adminEbookRouter.patch('/:id', controller.update);
adminEbookRouter.delete('/:id', controller.remove);
adminEbookRouter.post('/:id/publish', controller.publish);
adminEbookRouter.post('/:id/unpublish', controller.unpublish);
adminEbookRouter.post('/:id/uploads', controller.prepareUpload);
adminEbookRouter.post('/:id/uploads/:uploadId/complete', controller.completeUpload);
adminEbookRouter.post('/:id/uploads/:uploadId/cancel', controller.cancelUpload);
adminEbookRouter.use(controller.errorHandler);

ebookInternalRouter.get('/cleanup', controller.protectCleanup, controller.cleanup);
ebookInternalRouter.use(controller.errorHandler);

module.exports = { ebookRouter, adminEbookRouter, ebookInternalRouter };
