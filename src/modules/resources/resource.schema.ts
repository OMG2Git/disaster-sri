import { z } from 'zod';

// lat/lng are optional TOGETHER: when omitted, the disaster's own resolved location is the center.
export const nearbyQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().positive().max(500).default(10), // kilometers
    type: z.enum(['SHELTER', 'HOSPITAL', 'FOOD', 'WATER', 'RESCUE']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat and lng must be provided together',
    path: ['lat'],
  });

export type NearbyQuery = z.infer<typeof nearbyQuerySchema>;
