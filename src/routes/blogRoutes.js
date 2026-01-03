const express = require('express');
const multer = require('multer');
const {
  getBlogs,
  searchBlogs,
  getBlogsByCategory,
  getBlogById,
  likeBlog,
  shareBlog,
  createBlog,
  updateBlog,
  deleteBlog,
  addComment,
} = require('../controllers/blogController');
const {
  getCategories,
  createCategory,
  getSubcategories,
  createSubcategory,
} = require('../controllers/blogCategoryController');
const debounceSearch = require('../middleware/debounceSearch');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });
const blogUploads = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'adminPhoto', maxCount: 1 },
  { name: 'blogImage', maxCount: 2 },
]);

router.get('/', getBlogs);
router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.get('/categories/:categoryId/subcategories', getSubcategories);
router.post('/categories/:categoryId/subcategories', createSubcategory);
router.get('/search', debounceSearch, searchBlogs);
router.get('/category/:category', getBlogsByCategory);
router.get('/:id', getBlogById);
router.post('/:id/like', likeBlog);
router.post('/:id/share', shareBlog);
router.post('/', blogUploads, createBlog);
router.put('/:id', blogUploads, updateBlog);
router.delete('/:id', deleteBlog);
router.post('/:id/comments', addComment);

module.exports = router;
