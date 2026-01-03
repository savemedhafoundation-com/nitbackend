const cloudinary = require('./cloudinary');

const ensureCloudinary = () => {
  if (!cloudinary.config().cloud_name) {
    const error = new Error('Cloudinary is not configured.');
    error.statusCode = 500;
    throw error;
  }
};

const uploadBuffer = (buffer, options) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    uploadStream.end(buffer);
  });

const saveUploadFile = async file => {
  if (!file) return null;
  ensureCloudinary();

  const result = await uploadBuffer(file.buffer, {
    folder: 'nit-blogs',
    resource_type: 'image',
    use_filename: true,
    unique_filename: true,
  });

  return {
    publicId: result.public_id,
    url: result.secure_url || result.url,
  };
};

const deleteUploadFile = async publicId => {
  if (!publicId) return;
  ensureCloudinary();
  await cloudinary.uploader.destroy(publicId);
};

module.exports = {
  saveUploadFile,
  deleteUploadFile,
};
