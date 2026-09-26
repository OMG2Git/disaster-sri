import { z } from 'zod';

const tag = z.string().trim().toLowerCase().min(1).max(50);
const status = z.enum(['ACTIVE', 'RESOLVED', 'CLOSED']);

export const createDisasterSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  tags: z.array(tag).max(20).default([]),
  status: status.default('ACTIVE'),
});

// Only these fields may be updated. Location fields are owned by the location worker.
export const updateDisasterSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    tags: z.array(tag).max(20),
    status,
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field must be provided' });

export const listDisastersQuerySchema = z.object({
  tag: tag.optional(),
  status: status.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type CreateDisasterInput = z.infer<typeof createDisasterSchema>;
export type UpdateDisasterInput = z.infer<typeof updateDisasterSchema>;
export type ListDisastersQuery = z.infer<typeof listDisastersQuerySchema>;
