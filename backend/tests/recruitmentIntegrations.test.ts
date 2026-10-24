import request from 'supertest';
import { Role } from '@prisma/client';
import { env } from '../src/config/env';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';

const app = bikinApp();
const original = { ...env };
let hr: string, employee: string, jobId: string;
let fetchMock: jest.SpyInstance;
let counter = 0;
const token = { access_token: 'provider-token-never-return-to-browser', expires_in: 1800 };
const taskId = 'urn:li:simpleJobPostingTask:test-task';
const profileId = 'seekAnz:positionProfile:jobAd:test';
const seek = { locationId: 'seekAnz:location:seek:jakarta', categoryId: 'seekAnz:jobCategory:seek:hospitality', advertisementProductId: 'verified-product', summary: 'Bergabung sebagai waiter di Jakarta' };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const act = (platform: string, action = 'publish', extra: Record<string, unknown> = {}) => request(app).post(`/api/job-postings/${jobId}/publications/${platform}`).set(auth(hr)).send({ action, ...extra });
const taskResult = (status: string, extra = {}) => ({ results: { [taskId]: { status, ...extra } } });

beforeEach(async () => {
  await resetDatabase();
  counter += 1;
  Object.assign(env, {
    RECRUITMENT_PUBLIC_URL: 'https://karier.example.id',
    LINKEDIN_CLIENT_ID: `linkedin-test-${counter}`, LINKEDIN_CLIENT_SECRET: 'private+/=linkedin', LINKEDIN_COMPANY_ID: '12345',
    SEEK_CLIENT_ID: `seek-test-${counter}`, SEEK_CLIENT_SECRET: 'private-seek', SEEK_HIRER_ID: 'seekAnz:organization:seek:123',
    SEEK_CONTACT_NAME: 'Tim Rekrutmen', SEEK_CONTACT_EMAIL: 'rekrutmen@example.id',
  });
  await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
  await makeEmployee({ email: 'staf@resto.id' });
  hr = await login(app, 'hr@resto.id'); employee = await login(app, 'staf@resto.id');
  const position = await makePosition('Waiter');
  const job = await request(app).post('/api/job-postings').set(auth(hr)).send({
    title: 'Waiter', description: 'Melayani tamu', requirements: 'Ramah dan teliti', positionId: position.id,
    location: 'Jakarta, Indonesia', employmentType: 'fulltime', salaryRangeMin: 4_000_000, salaryRangeMax: 6_000_000,
  });
  expect(job.status).toBe(201); jobId = job.body.id;
  await request(app).patch(`/api/job-postings/${jobId}/status`).set(auth(hr)).send({ status: 'open' });
  fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { fetchMock.mockRestore(); Object.assign(env, original); });
afterAll(async () => { app.close(); });

it('menampilkan kebutuhan onboarding tanpa membocorkan kredensial atau menghubungi provider', async () => {
  env.SEEK_CLIENT_SECRET = undefined; env.LINKEDIN_CLIENT_SECRET = undefined;
  const response = await request(app).get('/api/recruitment/integrations').set(auth(hr));
  expect(response.status).toBe(200);
  expect(response.body.data).toHaveLength(2);
  expect(response.body.data[0]).toMatchObject({ configured: false, missing: ['SEEK_CLIENT_SECRET'] });
  expect(JSON.stringify(response.body)).not.toContain('private-seek');
  expect((await request(app).post('/api/recruitment/integrations/jobstreet/test').set(auth(hr))).status).toBe(503);
  expect((await act('linkedin')).status).toBe(503);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await prisma.recruitmentPublication.count()).toBe(0);
});

it('membatasi integrasi dan pengiriman pada izin rekrutmen yang sesuai', async () => {
  expect((await request(app).get('/api/recruitment/integrations').set(auth(employee))).status).toBe(403);
  expect((await request(app).post('/api/recruitment/integrations/linkedin/test').set(auth(employee))).status).toBe(403);
  expect((await request(app).get(`/api/job-postings/${jobId}/publications`).set(auth(employee))).status).toBe(403);
  expect((await request(app).post(`/api/job-postings/${jobId}/publications/linkedin`).set(auth(employee)).send({ action: 'publish' })).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('menolak platform tak dikenal, input asing, draft, tenggat lewat, dan data wajib kosong sebelum fetch', async () => {
  expect((await act('unknown')).status).toBe(400);
  expect((await act('linkedin', 'publish', { endpoint: 'https://evil.example' })).status).toBe(400);
  await prisma.jobPosting.update({ where: { id: jobId }, data: { status: 'draft' } });
  expect((await act('linkedin')).status).toBe(400);
  await prisma.jobPosting.update({ where: { id: jobId }, data: { status: 'open', deadline: new Date('2020-01-01') } });
  expect((await act('linkedin')).status).toBe(400);
  await prisma.jobPosting.update({ where: { id: jobId }, data: { deadline: null, location: null } });
  expect((await act('linkedin')).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('mengirim LinkedIn, membedakan accepted dari tayang, lalu menutup melalui task API', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ elements: [{ id: taskId, status: 202 }] }));
  const accepted = await act('linkedin');
  expect(accepted.status).toBe(202); expect(accepted.body.status).toBe('pending');
  const authBody = new URLSearchParams(fetchMock.mock.calls[0][1].body);
  expect(authBody.get('client_secret')).toBe('private+/=linkedin');
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(payload.elements[0]).toMatchObject({ company: 'urn:li:company:12345', externalJobPostingId: jobId, employmentStatus: 'FULL_TIME', jobPostingOperationType: 'CREATE' });
  expect(payload.elements[0].companyApplyUrl).toBe(`https://karier.example.id/lowongan/${jobId}?source=linkedin`);
  expect(payload.elements[0].description).toContain('Ramah dan teliti');
  expect(fetchMock.mock.calls[1][1].headers['LinkedIn-Version']).toBe('202604');
  expect(JSON.stringify(accepted.body)).not.toContain(token.access_token);
  expect(accepted.body.payload).toBeUndefined();
  expect((await act('linkedin')).status).toBe(409);
  fetchMock.mockResolvedValueOnce(json(taskResult('IN_PROGRESS')));
  expect((await act('linkedin', 'refresh')).body.status).toBe('pending');
  fetchMock.mockResolvedValueOnce(json(taskResult('SUCCEEDED', { jobPosting: 'urn:li:jobPosting:456' })));
  const live = await act('linkedin', 'refresh');
  expect(live.body).toMatchObject({ status: 'published', remoteUrl: 'https://www.linkedin.com/jobs/view/456' });
  expect(fetchMock.mock.calls[3][0]).toContain(encodeURIComponent(taskId));
  fetchMock.mockResolvedValueOnce(json({ elements: [{ id: taskId, status: 202 }] }));
  expect((await act('linkedin', 'close')).body.status).toBe('pending');
  expect(JSON.parse(fetchMock.mock.calls[4][1].body).elements[0].jobPostingOperationType).toBe('CLOSE');
  fetchMock.mockResolvedValueOnce(json(taskResult('SUCCEEDED')));
  expect((await act('linkedin', 'refresh')).body.status).toBe('closed');
  const callsAfterClosure = fetchMock.mock.calls.length;
  expect((await act('linkedin', 'refresh')).body.status).toBe('closed');
  expect(fetchMock).toHaveBeenCalledTimes(callsAfterClosure);
  expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('accessToken'))).toHaveLength(1);
});

it('hanya mengirim sekali saat dua permintaan publikasi datang bersamaan', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ elements: [{ id: taskId, status: 202 }] }));
  const responses = await Promise.all([act('linkedin'), act('linkedin')]);
  expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
  expect(fetchMock.mock.calls.filter((call) => String(call[0]).endsWith('/simpleJobPostings'))).toHaveLength(1);
  expect(await prisma.recruitmentPublication.count()).toBe(1);
});

it('mengenali kegagalan di dalam HTTP 200 LinkedIn tanpa menyalin galat mentah provider', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ elements: [{ status: 422, error: { message: 'private-seek provider-token-never-return-to-browser' } }] }));
  const rejected = await act('linkedin');
  expect(rejected.status).toBe(502); expect(rejected.body.publication.status).toBe('failed');
  expect(JSON.stringify(rejected.body)).not.toContain(token.access_token);
  expect(JSON.stringify(rejected.body)).not.toContain('private-seek');
});

it('tidak menganggap PROCESSED sebagai lowongan yang sudah tayang', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ elements: [{ id: taskId, status: 202 }] }));
  await act('linkedin');
  fetchMock.mockResolvedValueOnce(json(taskResult('PROCESSED')));
  expect((await act('linkedin', 'refresh')).body.status).toBe('processed');
});

it('menahan pengiriman ulang LinkedIn bila hasil kiriman tidak dapat dipastikan', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockRejectedValueOnce(new Error('socket disconnected'));
  const result = await act('linkedin');
  expect(result.body.publication.status).toBe('uncertain');
  expect((await act('linkedin')).status).toBe(409);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('menggunakan kontrak SEEK, memeriksa tayang, dan menunggu konfirmasi penutupan', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ data: { postPosition: { positionProfile: { profileId: { value: profileId } } } } }));
  const accepted = await act('jobstreet', 'publish', { seek });
  expect(accepted.status).toBe(202); expect(accepted.body.status).toBe('pending');
  const payload = JSON.parse(fetchMock.mock.calls[1][1].body).variables.input;
  expect(payload.positionOpening.postingRequester.personContacts[0]).toMatchObject({ name: { formattedName: 'Tim Rekrutmen' }, communication: { email: [{ address: 'rekrutmen@example.id' }], phone: [] }, roleCode: 'Recruiter' });
  expect(payload.positionProfile).toMatchObject({ positionLocation: [seek.locationId], jobCategories: [seek.categoryId], seekAnzWorkTypeCode: 'FullTime' });
  expect(payload.positionProfile.offeredRemunerationPackage.ranges[0]).toMatchObject({ intervalCode: 'Month', minimumAmount: { value: 4000000, currency: 'IDR' } });
  expect(payload.positionProfile.postingInstructions[0]).toMatchObject({ seekAdvertisementProductId: seek.advertisementProductId, applicationMethods: [{ applicationUri: { url: `https://karier.example.id/lowongan/${jobId}?source=jobstreet` } }] });
  fetchMock.mockResolvedValueOnce(json({ data: { positionProfile: null } }));
  expect((await act('jobstreet', 'refresh')).body.status).toBe('pending');
  const profile = { positionUri: 'https://id.jobstreet.com/job/123', seekStatusCode: 'Active', postingInstructions: [{ end: '2099-01-01T00:00:00Z' }] };
  fetchMock.mockResolvedValueOnce(json({ data: { positionProfile: profile } }));
  expect((await act('jobstreet', 'refresh')).body.status).toBe('published');
  fetchMock.mockResolvedValueOnce(json({ data: { closePostedPositionProfile: { positionProfile: { profileId: { value: profileId } } } } }));
  expect((await act('jobstreet', 'close')).body.status).toBe('pending');
  fetchMock.mockResolvedValueOnce(json({ data: { positionProfile: profile } }));
  expect((await act('jobstreet', 'refresh')).body.status).toBe('pending');
  fetchMock.mockResolvedValueOnce(json({ data: { positionProfile: { ...profile, postingInstructions: [{ end: '2020-01-01T00:00:00Z' }] } } }));
  expect((await act('jobstreet', 'refresh')).body.status).toBe('closed');
});

it('mengulang SEEK dengan snapshot dan idempotencyId yang sama saat koneksi terputus', async () => {
  fetchMock.mockResolvedValueOnce(json(token)).mockRejectedValueOnce(new Error('network interrupted'));
  expect((await act('jobstreet', 'publish', { seek })).body.publication.status).toBe('uncertain');
  const firstBody = fetchMock.mock.calls[1][1].body;
  await prisma.jobPosting.update({ where: { id: jobId }, data: { description: 'Deskripsi sudah berubah' } });
  fetchMock.mockResolvedValueOnce(json({ data: { postPosition: { conflictingPositionProfile: { profileId: { value: profileId } } } } }));
  expect((await act('jobstreet', 'publish', { seek: { ...seek, summary: 'Berbeda' } })).status).toBe(202);
  expect(fetchMock.mock.calls[2][1].body).toBe(firstBody);
});

it('menolak gaji tidak lengkap untuk SEEK sebelum autentikasi atau kiriman iklan', async () => {
  await prisma.jobPosting.update({ where: { id: jobId }, data: { salaryRangeMin: null } });
  expect((await act('jobstreet', 'publish', { seek })).status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('menandai pengiriman yang terputus setelah restart sebagai perlu diperiksa', async () => {
  await prisma.recruitmentPublication.create({ data: { id: 'lease-test', jobPostingId: jobId, platform: 'linkedin', operation: 'CREATE', status: 'sending', requestKey: 'lease-request', payload: {}, leaseUntil: new Date('2020-01-01') } });
  const response = await request(app).get(`/api/job-postings/${jobId}/publications`).set(auth(hr));
  expect(response.body.data[0].status).toBe('uncertain');
  expect(response.body.data[0].payload).toBeUndefined();
  expect((await act('linkedin')).status).toBe(409);
});

it.each(['jobstreet', 'linkedin'])('menyimpan sumber %s pada lamaran portal agar dapat disaring HR', async (source) => {
  const account = await request(app).post('/api/karier/daftar').send({ name: 'Siti Pelamar', email: 'siti@example.id', password: 'RahasiaUji123' });
  expect(account.status).toBe(201);
  const result = await request(app).post('/api/karier/lamar').set(auth(account.body.token)).send({ jobPostingId: jobId, source });
  expect(result.status).toBe(201);
  expect(await prisma.candidate.findFirstOrThrow()).toMatchObject({ source });
  const candidates = await request(app).get(`/api/candidates?source=${source}`).set(auth(hr));
  expect(candidates.body.data).toHaveLength(1);
});
