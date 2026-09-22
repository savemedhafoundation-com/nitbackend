const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Deliberately uses a disposable database. This command never reads MONGO_URI.
async function main() {
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: 'ebook_migration_check', ip: '127.0.0.1', launchTimeout: 60_000 },
  });

  try {
    await mongoose.connect(mongo.getUri());
    const Ebook = require('../src/models/Ebook');
    const EbookUpload = require('../src/models/EbookUpload');

    for (const model of [Ebook, EbookUpload]) {
      await model.createIndexes();
      // A deployment may retry the migration; index creation must remain safe.
      await model.createIndexes();
      assert.ok((await model.collection.indexes()).length > 1, `${model.modelName} indexes were not created`);
      model.schema.eachPath((name, type) => {
        assert.notEqual(type.instance, 'Buffer', `${model.modelName}.${name} must not store file binary`);
      });
    }

    for (const field of ['isPublished', 'status', 'category', 'createdAt', 'title']) {
      const indexed = Ebook.schema.indexes().some(([fields]) => Object.hasOwn(fields, field));
      assert.ok(indexed, `Ebook.${field} requires an index`);
    }
    for (const field of ['pdfBlobUrl', 'pdfBlobPathname']) {
      assert.equal(Ebook.schema.path(field).instance, 'String');
    }
    assert.equal(Ebook.schema.path('pdfSizeBytes').instance, 'Number');

    const draft = await Ebook.create({ title: 'Migration verification', createdBy: new mongoose.Types.ObjectId() });
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.isPublished, false);
    assert.ok(!draft.pdfBlobUrl, 'A draft must not invent a PDF URL');

    console.log('Ebook migration check passed: metadata schemas, indexes, defaults, and repeated application.');
  } finally {
    await mongoose.disconnect();
    await mongo.stop();
  }
}

main().catch(error => {
  console.error('Ebook migration check failed:', error.message);
  process.exitCode = 1;
});
