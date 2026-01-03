const Blog = require('../models/Blog');
const { saveUploadFile, deleteUploadFile } = require('../utils/fileStorage');

const parseArrayField = value => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map(item => String(item).trim()).filter(Boolean);
      }
    } catch (error) {
      // Fall back to comma-separated values.
    }
    return trimmed
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
};

const parseFaqs = value => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => ({
        question: typeof item?.question === 'string' ? item.question.trim() : '',
        answer: typeof item?.answer === 'string' ? item.answer.trim() : '',
      }))
      .filter(item => item.question || item.answer);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parseFaqs(parsed);
      }
    } catch (error) {
      return [];
    }
  }
  return [];
};

const parseAdminStatement = body => {
  if (!body) return {};

  if (typeof body.adminStatement === 'string') {
    try {
      const parsed = JSON.parse(body.adminStatement);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (error) {
      // Ignore invalid JSON.
    }
  }

  const output = {};
  const hasQuotation =
    Object.prototype.hasOwnProperty.call(body, 'adminStatementQuotation') ||
    Object.prototype.hasOwnProperty.call(body, 'quotation');
  const hasName =
    Object.prototype.hasOwnProperty.call(body, 'adminStatementName') ||
    Object.prototype.hasOwnProperty.call(body, 'adminName');
  const hasDesignation =
    Object.prototype.hasOwnProperty.call(body, 'adminStatementDesignation') ||
    Object.prototype.hasOwnProperty.call(body, 'adminDesignation');

  if (hasQuotation) output.quotation = body.adminStatementQuotation ?? body.quotation ?? '';
  if (hasName) output.name = body.adminStatementName ?? body.adminName ?? '';
  if (hasDesignation) output.designation = body.adminStatementDesignation ?? body.adminDesignation ?? '';

  return output;
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getBlogs = async (req, res, next) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Number.parseInt(req.query.limit, 10) || 10);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.category) {
      filter.category = new RegExp(`^${escapeRegex(req.query.category)}$`, 'i');
    }
    if (req.query.subCategory) {
      filter.subCategory = new RegExp(`^${escapeRegex(req.query.subCategory)}$`, 'i');
    }
    if (req.query.cancerStage) {
      filter.cancerStage = req.query.cancerStage;
    }

    const [blogs, total] = await Promise.all([
      Blog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Blog.countDocuments(filter),
    ]);

    return res.status(200).json({
      data: blogs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return next(error);
  }
};

const getBlogById = async (req, res, next) => {
  try {
    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewsCount: 1 } },
      { new: true }
    );

    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    return res.status(200).json(blog);
  } catch (error) {
    return next(error);
  }
};

const searchBlogs = async (req, res, next) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const blogs = await Blog.find(
      { $text: { $search: query } },
      { score: { $meta: 'textScore' } }
    ).sort({ score: { $meta: 'textScore' }, createdAt: -1 });

    return res.status(200).json({ data: blogs });
  } catch (error) {
    return next(error);
  }
};

const getBlogsByCategory = async (req, res, next) => {
  try {
    const category = req.params.category;
    const blogs = await Blog.find({
      category: new RegExp(`^${escapeRegex(category)}$`, 'i'),
    }).sort({ createdAt: -1 });

    return res.status(200).json({ data: blogs });
  } catch (error) {
    return next(error);
  }
};

const createBlog = async (req, res, next) => {
  try {
    const { title, description, category, subCategory, cancerStage, writtenBy } = req.body;
    const imageFile = req.files?.image?.[0];
    const blogImages = req.files?.blogImage || [];

    if (!title || !description || !category || !writtenBy) {
      return res.status(400).json({ message: 'title, description, category, and writtenBy are required' });
    }
    if (!imageFile) {
      return res.status(400).json({ message: 'Main image is required' });
    }
    if (blogImages.length !== 2) {
      return res.status(400).json({ message: 'Exactly two blog images are required' });
    }

    const savedImage = await saveUploadFile(imageFile);
    const savedBlogImages = await Promise.all(blogImages.map(file => saveUploadFile(file)));
    const adminPhotoFile = req.files?.adminPhoto?.[0] || null;
    const savedAdminPhoto = adminPhotoFile ? await saveUploadFile(adminPhotoFile) : null;

    const adminStatement = parseAdminStatement(req.body);
    if (savedAdminPhoto) {
      adminStatement.photoUrl = savedAdminPhoto.url;
      adminStatement.photoPublicId = savedAdminPhoto.publicId;
    }

    const blog = await Blog.create({
      title: title.trim(),
      metadata: parseArrayField(req.body.metadata),
      videoLinks: parseArrayField(req.body.videoLinks),
      spotlight:
        req.body.spotlight === true ||
        req.body.spotlight === 'true' ||
        req.body.spotlight === 1 ||
        req.body.spotlight === '1',
      description: description.trim(),
      imageUrl: savedImage.url,
      imagePublicId: savedImage.publicId,
      category: category.trim(),
      subCategory: subCategory ? subCategory.trim() : undefined,
      cancerStage: cancerStage || undefined,
      writtenBy: writtenBy.trim(),
      faqs: parseFaqs(req.body.faqs),
      blogImage: savedBlogImages.map(item => ({
        imageUrl: item.url,
        imagePublicId: item.publicId,
      })),
      adminStatement,
    });

    return res.status(201).json(blog);
  } catch (error) {
    return next(error);
  }
};

const updateBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    const { title, description, category, subCategory, cancerStage, writtenBy } = req.body;

    if (title) blog.title = title.trim();
    if (description) blog.description = description.trim();
    if (category) blog.category = category.trim();
    if (subCategory !== undefined) blog.subCategory = subCategory ? subCategory.trim() : '';
    if (cancerStage) blog.cancerStage = cancerStage;
    if (writtenBy) blog.writtenBy = writtenBy.trim();

    if (req.body.metadata !== undefined) {
      blog.metadata = parseArrayField(req.body.metadata);
    }
    if (req.body.videoLinks !== undefined) {
      blog.videoLinks = parseArrayField(req.body.videoLinks);
    }
    if (req.body.spotlight !== undefined) {
      blog.spotlight =
        req.body.spotlight === true ||
        req.body.spotlight === 'true' ||
        req.body.spotlight === 1 ||
        req.body.spotlight === '1';
    }
    if (req.body.faqs !== undefined) {
      blog.faqs = parseFaqs(req.body.faqs);
    }

    const adminStatement = parseAdminStatement(req.body);
    if (!blog.adminStatement) blog.adminStatement = {};
    if (adminStatement.quotation !== undefined) blog.adminStatement.quotation = adminStatement.quotation;
    if (adminStatement.name !== undefined) blog.adminStatement.name = adminStatement.name;
    if (adminStatement.designation !== undefined) blog.adminStatement.designation = adminStatement.designation;

    const imageFile = req.files?.image?.[0];
    if (imageFile) {
      await deleteUploadFile(blog.imagePublicId);
      const savedImage = await saveUploadFile(imageFile);
      blog.imageUrl = savedImage.url;
      blog.imagePublicId = savedImage.publicId;
    }

    const adminPhotoFile = req.files?.adminPhoto?.[0];
    if (adminPhotoFile) {
      await deleteUploadFile(blog.adminStatement.photoPublicId);
      const savedAdminPhoto = await saveUploadFile(adminPhotoFile);
      blog.adminStatement.photoUrl = savedAdminPhoto.url;
      blog.adminStatement.photoPublicId = savedAdminPhoto.publicId;
    }

    const blogImages = req.files?.blogImage || [];
    if (blogImages.length > 0) {
      if (blogImages.length !== 2) {
        return res.status(400).json({ message: 'Exactly two blog images are required' });
      }
      await Promise.all(blog.blogImage.map(item => deleteUploadFile(item.imagePublicId)));
      const savedBlogImages = await Promise.all(blogImages.map(file => saveUploadFile(file)));
      blog.blogImage = savedBlogImages.map(item => ({
        imageUrl: item.url,
        imagePublicId: item.publicId,
      }));
    }

    await blog.save();

    return res.status(200).json(blog);
  } catch (error) {
    return next(error);
  }
};

const deleteBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    await deleteUploadFile(blog.imagePublicId);
    await Promise.all(blog.blogImage.map(item => deleteUploadFile(item.imagePublicId)));
    if (blog.adminStatement?.photoPublicId) {
      await deleteUploadFile(blog.adminStatement.photoPublicId);
    }

    await blog.deleteOne();
    return res.status(200).json({ message: 'Blog deleted' });
  } catch (error) {
    return next(error);
  }
};

const likeBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { likesCount: 1 } },
      { new: true }
    );
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    return res.status(200).json({ likesCount: blog.likesCount });
  } catch (error) {
    return next(error);
  }
};

const shareBlog = async (req, res, next) => {
  try {
    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { sharesCount: 1 } },
      { new: true }
    );
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }
    return res.status(200).json({ sharesCount: blog.sharesCount });
  } catch (error) {
    return next(error);
  }
};

const addComment = async (req, res, next) => {
  try {
    const { comment, name, phoneNumber } = req.body || {};
    if (!comment || !name || !phoneNumber) {
      return res.status(400).json({ message: 'comment, name, and phoneNumber are required' });
    }

    const blog = await Blog.findById(req.params.id);
    if (!blog) {
      return res.status(404).json({ message: 'Blog not found' });
    }

    blog.comments.push({
      comment: comment.trim(),
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
    });

    await blog.save();
    return res.status(201).json(blog.comments[blog.comments.length - 1]);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
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
};
