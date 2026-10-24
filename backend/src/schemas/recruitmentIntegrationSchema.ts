import { z } from 'zod';
import { ulidField } from './common';

export const integrationPlatformSchema = z.enum(['jobstreet', 'linkedin']);
export type RecruitmentPlatform = z.infer<typeof integrationPlatformSchema>;
export const integrationParamsSchema = z.object({ platform: integrationPlatformSchema });
export const publicationParamsSchema = z.object({ id: ulidField, platform: integrationPlatformSchema });
export const publicationInputSchema = z.object({
  action: z.enum(['publish', 'close', 'refresh']),
  seek: z.object({
    locationId: z.string().trim().min(1).max(250),
    categoryId: z.string().trim().min(1).max(250),
    advertisementProductId: z.string().trim().min(1).max(500),
    summary: z.string().trim().min(1).max(150),
  }).strict().optional(),
}).strict();
export type PublicationInput = z.infer<typeof publicationInputSchema>;
