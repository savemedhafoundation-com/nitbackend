import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createBackendHarness } from './helpers/backendHarness.mjs';
const require = createRequire(import.meta.url);

describe('centre capability foundation', () => {
  let harness, Centre, Membership;
  beforeAll(async () => {
    harness = await createBackendHarness({ centres: true });
    Centre = require('../src/models/Centre');
    Membership = require('../src/models/CentreMembership');
  });
  beforeEach(async () => { await harness.reset(); });
  afterAll(async () => { await harness?.close(); });

  it('requires an explicit capability in the requested centre, including for platform admins', async () => {
    const a = await Centre.create({ code: 'A', name: 'Centre A' });
    const b = await Centre.create({ code: 'B', name: 'Centre B' });
    const get = centre => request(harness.app).get(`/api/test/centres/${centre}`).set('Authorization', harness.adminAuthorization);
    expect((await get(a._id)).status).toBe(403);
    await Membership.create({ user: harness.admin._id, centre: a._id, capabilities: ['clinical.read'] });
    expect((await get(a._id)).status).toBe(200);
    expect((await get(b._id)).status).toBe(403);
    expect((await get('not-an-id')).status).toBe(403);
  });

  it('rechecks capability, membership dates, and centre state on every request', async () => {
    const centre = await Centre.create({ code: 'A', name: 'Centre A' });
    const membership = await Membership.create({ user: harness.admin._id, centre: centre._id, capabilities: ['clinical.read'] });
    const get = () => request(harness.app).get(`/api/test/centres/${centre._id}`).set('Authorization', harness.adminAuthorization);
    for (const patch of [{ capabilities: [] }, { capabilities: ['clinical.read'], active: false }, { active: true, endsAt: new Date(0) }, { endsAt: null, startsAt: new Date(Date.now() + 60000) }]) {
      await Membership.updateOne({ _id: membership._id }, { $set: patch });
      expect((await get()).status).toBe(403);
    }
    await Membership.updateOne({ _id: membership._id }, { $set: { startsAt: new Date(0) } });
    expect((await get()).status).toBe(200);
    await Centre.updateOne({ _id: centre._id }, { $set: { active: false } });
    expect((await get()).status).toBe(403);
  });
});
