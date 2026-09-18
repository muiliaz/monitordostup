import { z } from 'zod';

export const idParam = z.object({ id: z.coerce.number().int().positive() });

// Empty string from a form means "no body check".
const optionalText = z
  .string()
  .max(1000)
  .nullish()
  .transform((v) => (v && v.length > 0 ? v : null));

// Pause/resume are separate actions, not part of the editable config.
export const checkInput = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.url({ protocol: /^https?$/ }),
  intervalSec: z.number().int().min(30).max(3600),
  // Up to 60s even though the minimal interval is 30s: a check may legitimately
  // run longer than its interval, overlap protection handles that case.
  timeoutMs: z.number().int().min(500).max(60_000),
  expectedStatus: z.number().int().min(100).max(599).default(200),
  expectedBodySubstring: optionalText,
  isPublic: z.boolean().default(false),
  groupId: z.number().int().positive().nullable().default(null),
});

export const groupInput = z.object({
  name: z.string().trim().min(1).max(200),
  alertEmails: z
    .array(z.email())
    .max(50)
    .default([])
    .transform((list) => [...new Set(list.map((e) => e.trim().toLowerCase()))]),
});
