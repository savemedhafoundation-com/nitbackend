const BlogCategory = require('../models/BlogCategory');
const BlogSubCategory = require('../models/BlogSubCategory');

const normalizeName = value => String(value || '').trim().toLowerCase();

const getCategories = async (_req, res, next) => {
  try {
    const categories = await BlogCategory.find().sort({ name: 1 });
    const subcategories = await BlogSubCategory.find().sort({ name: 1 });

    const grouped = subcategories.reduce((acc, sub) => {
      const key = String(sub.category);
      if (!acc[key]) acc[key] = [];
      acc[key].push(sub);
      return acc;
    }, {});

    const data = categories.map(category => ({
      _id: category._id,
      name: category.name,
      subcategories: grouped[String(category._id)] || [],
    }));

    return res.status(200).json({ data });
  } catch (error) {
    return next(error);
  }
};

const createCategory = async (req, res, next) => {
  try {
    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const existing = await BlogCategory.findOne({ name });
    if (existing) {
      return res.status(200).json(existing);
    }

    const category = await BlogCategory.create({ name });
    return res.status(201).json(category);
  } catch (error) {
    return next(error);
  }
};

const getSubcategories = async (req, res, next) => {
  try {
    const categoryId = req.params.categoryId;
    const category = await BlogCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const subcategories = await BlogSubCategory.find({ category: categoryId }).sort({ name: 1 });
    return res.status(200).json({ data: subcategories });
  } catch (error) {
    return next(error);
  }
};

const createSubcategory = async (req, res, next) => {
  try {
    const categoryId = req.params.categoryId;
    const name = normalizeName(req.body?.name);
    if (!name) {
      return res.status(400).json({ message: 'Subcategory name is required' });
    }

    const category = await BlogCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const existing = await BlogSubCategory.findOne({ name, category: categoryId });
    if (existing) {
      return res.status(200).json(existing);
    }

    const subcategory = await BlogSubCategory.create({ name, category: categoryId });
    return res.status(201).json(subcategory);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  getCategories,
  createCategory,
  getSubcategories,
  createSubcategory,
};
