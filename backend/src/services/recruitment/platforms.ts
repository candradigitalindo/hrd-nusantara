import { createHash, randomUUID } from 'crypto';
import type { JobPosting, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import type { PublicationInput, RecruitmentPlatform } from '../../schemas/recruitmentIntegrationSchema';

export class IntegrationError extends Error {
  constructor(message: string, public statusCode = 502, public uncertain = false) { super(message); }
}

export const PLATFORMS = ['jobstreet', 'linkedin'] as const;
export const integrationConfiguration = (platform: RecruitmentPlatform) => {
  const required = platform === 'jobstreet'
    ? ['RECRUITMENT_PUBLIC_URL', 'SEEK_CLIENT_ID', 'SEEK_CLIENT_SECRET', 'SEEK_HIRER_ID', 'SEEK_CONTACT_NAME', 'SEEK_CONTACT_EMAIL'] as const
    : ['RECRUITMENT_PUBLIC_URL', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_COMPANY_ID'] as const;
  const missing = required.filter((key) => !env[key]);
  return {
    platform, name: platform === 'jobstreet' ? 'JobStreet by SEEK' : 'LinkedIn',
    configured: missing.length === 0, missing,
    documentationUrl: platform === 'jobstreet' ? 'https://developer.seek.com/' : 'https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview',
    note: platform === 'jobstreet'
      ? 'Memerlukan akses partner SEEK, hubungan JobPosting dengan perusahaan, serta izin ApplicationUri untuk portal karier.'
      : 'Memerlukan persetujuan LinkedIn Talent Solutions untuk Job Posting API. Akun perusahaan saja belum cukup.',
  };
};

export const requireConfiguration = (platform: RecruitmentPlatform) => {
  if (!integrationConfiguration(platform).configured) {
    throw new IntegrationError('Integrasi belum dikonfigurasi. Lengkapi pengaturan server setelah akses API resmi disetujui.', 503);
  }
};

// Endpoint ditetapkan oleh aplikasi; input pengguna tidak pernah menjadi tujuan fetch.
// Jangan menyertakan body respons provider dalam galat, log, atau audit (bisa memuat token).
const requestJson = async (url: string, init: RequestInit, mutation = false): Promise<any> => {
  try {
    const response = await fetch(url, {
      ...init, redirect: 'error', signal: AbortSignal.timeout(8_000),
      headers: { 'User-Agent': 'HRDNusantara/1.0', ...init.headers },
    });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403
        ? 'Kredensial atau izin API platform belum sesuai.'
        : response.status === 429 ? 'Batas permintaan platform tercapai. Coba kembali nanti.'
          : `Platform menolak permintaan (HTTP ${response.status}). Periksa konfigurasi dan data lowongan.`;
      throw new IntegrationError(reason, 502, mutation && response.status >= 500);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('Respons platform belum dapat dipastikan. Periksa status sebelum mengirim ulang.', 502, mutation);
  }
};

const tokens = new Map<string, { value: string; expiresAt: number }>();
const exchanges = new Map<string, Promise<string>>();
export const platformToken = async (platform: RecruitmentPlatform): Promise<string> => {
  requireConfiguration(platform);
  const clientId = platform === 'jobstreet' ? env.SEEK_CLIENT_ID! : env.LINKEDIN_CLIENT_ID!;
  const clientSecret = platform === 'jobstreet' ? env.SEEK_CLIENT_SECRET! : env.LINKEDIN_CLIENT_SECRET!;
  const key = createHash('sha256').update(`${platform}:${clientId}:${clientSecret}`).digest('hex');
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = exchanges.get(key);
  if (pending) return pending;
  const exchange = (async () => {
    const token = platform === 'jobstreet'
      ? await requestJson('https://auth.seek.com/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: 'https://graphql.seek.com', client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      })
      : await requestJson('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      });
    const lifetime = Number(token?.expires_in);
    if (typeof token?.access_token !== 'string' || !token.access_token || !Number.isFinite(lifetime) || lifetime <= 0) {
      throw new IntegrationError('Platform mengembalikan token yang tidak valid.');
    }
    tokens.set(key, { value: token.access_token, expiresAt: Date.now() + Math.max(0, lifetime - Math.min(60, lifetime / 10)) * 1000 });
    return token.access_token as string;
  })();
  exchanges.set(key, exchange);
  try { return await exchange; } finally { exchanges.delete(key); }
};

const seekQuery = async (query: string, variables: Record<string, unknown>, mutation = false) => {
  const token = await platformToken('jobstreet');
  const response = await requestJson('https://graphql.seek.com/graphql', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Language': 'id-ID', 'X-Request-Id': randomUUID() },
    body: JSON.stringify({ query, variables }),
  }, mutation);
  if (response.errors?.length) {
    const knownRejection = response.errors.every((e: any) => ['BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(e.extensions?.code));
    throw new IntegrationError('JobStreet menolak permintaan. Periksa izin perusahaan, produk iklan, lokasi, kategori, dan gaji.', 502, mutation && !knownRejection);
  }
  if (!response.data) throw new IntegrationError('Respons JobStreet tidak lengkap.', 502, mutation);
  return response.data;
};

export const testPlatform = async (platform: RecruitmentPlatform) => {
  await platformToken(platform);
  if (platform === 'jobstreet') {
    const data = await seekQuery('query ($id: String!) { hiringOrganization(id: $id) { name } }', { id: env.SEEK_HIRER_ID });
    if (!data.hiringOrganization) throw new IntegrationError('Perusahaan belum dapat diakses melalui API SEEK.');
  }
  return { authenticated: true, message: 'Autentikasi API berhasil. Publikasi tetap bergantung pada izin Job Posting dan validasi lowongan oleh platform.' };
};

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const description = (job: JobPosting) => `<h2>Deskripsi pekerjaan</h2><p>${escapeHtml(job.description).replace(/\n/g, '<br>')}</p><h2>Persyaratan</h2><p>${escapeHtml(job.requirements).replace(/\n/g, '<br>')}</p>`;
export const applicationUrl = (jobId: string, platform: RecruitmentPlatform) => {
  const url = new URL(`/lowongan/${jobId}`, env.RECRUITMENT_PUBLIC_URL);
  url.searchParams.set('source', platform);
  return url.toString();
};

export const buildPublicationPayload = (platform: RecruitmentPlatform, job: JobPosting, requestKey: string, seek?: PublicationInput['seek']): Prisma.InputJsonObject => {
  requireConfiguration(platform);
  if (!job.location?.trim() || !job.employmentType) throw new IntegrationError('Isi lokasi dan jenis pekerjaan sebelum mengirim lowongan.', 400);
  const html = description(job);
  if (platform === 'linkedin') {
    const employment: Record<string, string> = { fulltime: 'FULL_TIME', parttime: 'PART_TIME', contract: 'CONTRACT', internship: 'INTERNSHIP', daily: 'TEMPORARY' };
    return { elements: [{
      company: `urn:li:company:${env.LINKEDIN_COMPANY_ID}`, externalJobPostingId: job.id,
      companyApplyUrl: applicationUrl(job.id, platform), title: job.title, description: html,
      location: job.location, employmentStatus: employment[job.employmentType],
      listedAt: (job.publishedAt ?? job.postedDate).getTime(), jobPostingOperationType: 'CREATE', listingType: 'BASIC',
    }] };
  }
  if (!seek) throw new IntegrationError('Lengkapi lokasi, kategori, produk iklan, dan ringkasan JobStreet.', 400);
  if (job.title.length > 80 || html.length > 15_000) throw new IntegrationError('JobStreet membatasi judul 80 karakter dan deskripsi 15.000 karakter.', 400);
  const min = job.salaryRangeMin?.toNumber(), max = job.salaryRangeMax?.toNumber();
  if (!min || !max || max < min) throw new IntegrationError('JobStreet memerlukan gaji minimum dan maksimum bulanan yang valid, lebih dari nol.', 400);
  const workType: Record<string, string> = { fulltime: 'FullTime', parttime: 'PartTime', contract: 'ContractTemp', internship: 'ContractTemp', daily: 'Casual' };
  return {
    positionOpening: { postingRequester: {
      id: env.SEEK_HIRER_ID!, roleCode: 'Company', personContacts: [{
        name: { formattedName: env.SEEK_CONTACT_NAME! }, roleCode: 'Recruiter',
        communication: { email: [{ address: env.SEEK_CONTACT_EMAIL! }], phone: [] },
      }],
    }, seekPartnerMetadata: job.id },
    positionProfile: {
      positionTitle: job.title, positionOrganizations: [env.SEEK_HIRER_ID!],
      positionLocation: [seek.locationId], jobCategories: [seek.categoryId],
      seekAnzWorkTypeCode: workType[job.employmentType], seekWorkArrangementCodes: ['OnSite'],
      positionFormattedDescriptions: [{ descriptionId: 'AdvertisementDetails', content: html }, { descriptionId: 'SearchSummary', content: seek.summary }],
      offeredRemunerationPackage: { basisCode: 'Salaried', descriptions: [], ranges: [{ intervalCode: 'Month', minimumAmount: { value: min, currency: 'IDR' }, maximumAmount: { value: max, currency: 'IDR' } }] },
      seekHirerJobReference: job.id,
      postingInstructions: [{ idempotencyId: requestKey, seekAdvertisementProductId: seek.advertisementProductId, applicationMethods: [{ applicationUri: { url: applicationUrl(job.id, platform) } }] }],
    },
  };
};

export interface PlatformResult { status: string; remoteId?: string; taskId?: string; remoteUrl?: string; error?: string }
const linkedinHeaders = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'LinkedIn-Version': env.LINKEDIN_API_VERSION });

export const sendPublication = async (platform: RecruitmentPlatform, operation: string, payload: Prisma.JsonValue): Promise<PlatformResult> => {
  if (platform === 'linkedin') {
    const token = await platformToken(platform);
    const result = await requestJson('https://api.linkedin.com/rest/simpleJobPostings', {
      method: 'POST', headers: { ...linkedinHeaders(token), 'X-Restli-Method': 'batch_create' }, body: JSON.stringify(payload),
    }, true);
    const item = result.elements?.[0];
    if (item?.error || Number(item?.status) >= 400) throw new IntegrationError('LinkedIn menolak data lowongan. Periksa data wajib dan izin Job Posting.', 502, Number(item.status) >= 500);
    if (typeof item?.id !== 'string' || !item.id.startsWith('urn:li:simpleJobPostingTask:')) throw new IntegrationError('LinkedIn belum mengembalikan ID tugas publikasi.', 502, true);
    return { status: 'pending', taskId: item.id };
  }
  if (operation === 'CLOSE') {
    const data = await seekQuery('mutation ($input: ClosePostedPositionProfileInput!) { closePostedPositionProfile(input: $input) { positionProfile { profileId { value } } } }', { input: payload }, true);
    if (!data.closePostedPositionProfile?.positionProfile?.profileId?.value) throw new IntegrationError('JobStreet belum mengonfirmasi permintaan penutupan.', 502, true);
    return { status: 'pending' };
  }
  const data = await seekQuery('mutation ($input: PostPositionInput!) { postPosition(input: $input) { ... on PostPositionPayload_Success { positionProfile { profileId { value } } } ... on PostPositionPayload_Conflict { conflictingPositionProfile { profileId { value } } } } }', { input: payload }, true);
  const id = data.postPosition?.positionProfile?.profileId?.value ?? data.postPosition?.conflictingPositionProfile?.profileId?.value;
  if (typeof id !== 'string' || !id) throw new IntegrationError('JobStreet belum mengembalikan ID publikasi.', 502, true);
  return { status: 'pending', remoteId: id };
};

const trustedJobUrl = (value: unknown, platform: RecruitmentPlatform): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value);
    const hosts = platform === 'jobstreet' ? ['jobstreet.co.id', 'id.jobstreet.com', 'www.jobstreet.co.id', 'www.jobstreet.com', 'jobstreet.com', 'www.seek.com.au', 'www.seek.co.nz'] : ['www.linkedin.com'];
    return u.protocol === 'https:' && !u.username && !u.password && hosts.includes(u.hostname) ? u.toString() : undefined;
  } catch { return undefined; }
};

export const checkPublication = async (platform: RecruitmentPlatform, row: { operation: string; remoteId: string | null; taskId: string | null }): Promise<PlatformResult> => {
  if (platform === 'jobstreet') {
    if (!row.remoteId) throw new IntegrationError('ID publikasi belum tersedia. Coba ulang pengiriman JobStreet dengan referensi yang sama.', 409);
    const data = await seekQuery('query ($id: String!) { positionProfile(id: $id) { positionUri postingInstructions { end } ... on PostedPositionProfile { seekStatusCode } } }', { id: row.remoteId });
    const profile = data.positionProfile;
    if (!profile) return { status: 'pending' };
    const end = profile.postingInstructions?.[0]?.end;
    if (end && new Date(end).getTime() <= Date.now()) return { status: 'closed' };
    if (row.operation === 'CLOSE' || profile.seekStatusCode !== 'Active' || !profile.positionUri) return { status: 'pending' };
    return { status: 'published', remoteUrl: trustedJobUrl(profile.positionUri, platform) };
  }
  if (!row.taskId) throw new IntegrationError('ID tugas belum tersedia. Periksa publikasi di LinkedIn sebelum mengirim ulang.', 409);
  const token = await platformToken(platform);
  const response = await requestJson(`https://api.linkedin.com/rest/simpleJobPostingTasks?ids=${encodeURIComponent(row.taskId)}`, { headers: linkedinHeaders(token) });
  const task = response.results?.[row.taskId];
  if (!task) throw new IntegrationError('Status tugas LinkedIn belum tersedia. Periksa di platform dan coba lagi.');
  if (task.status === 'FAILED' || (task.status === 'PROCESSED' && task.errorMessage)) return { status: 'failed', error: 'LinkedIn menolak publikasi. Periksa data lowongan dan izin API di akun partner.' };
  if (task.status === 'PROCESSED') return { status: 'processed' };
  if (task.status !== 'SUCCEEDED') return { status: 'pending' };
  const id = typeof task.jobPosting === 'string' ? task.jobPosting : undefined;
  const numericId = id?.match(/^urn:li:jobPosting:(\d+)$/)?.[1];
  return { status: row.operation === 'CLOSE' ? 'closed' : 'published', remoteId: id, remoteUrl: numericId ? trustedJobUrl(`https://www.linkedin.com/jobs/view/${numericId}`, platform) : undefined };
};
