const express = require('express');
const {
  getDiseases,
  getBoosters,
  getBlogPosts,
  getHeroContent,
} = require('../controllers/infoController');

const router = express.Router();

router.get('/diseases', getDiseases);
router.get('/boosters', getBoosters);
router.get('/blog', getBlogPosts);
router.get('/hero', getHeroContent);

module.exports = router;
