import { z } from "zod";

export const intervalSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});

export const availabilityIntervalSchema = intervalSchema.extend({
  state: z.enum(["available", "tentative", "unavailable"]),
});

export const rangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1),
  dailyStart: z.string().regex(/^\d{2}:\d{2}$/),
  dailyEnd: z.string().regex(/^\d{2}:\d{2}$/),
  excludeDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

export const createPollSchema = z
  .object({
    title: z.string().min(1).max(200),
    context: z.string().max(2000).optional(),
    location: z.string().max(500).optional(),
    durationMinutes: z.number().int(),
    timezone: z.string().min(1),
    windows: z.array(intervalSchema).optional(),
    range: rangeSchema.optional(),
  })
  .refine((value) => (value.windows && value.windows.length > 0) || value.range, {
    message: "Provide windows or a date range.",
  });

export const submitSchema = z.object({
  name: z.string().min(1).max(80),
  intervals: z.array(availabilityIntervalSchema).default([]),
  remainderUnavailable: z.boolean().optional(),
});

export const updateSchema = z.object({
  responseVersion: z.number().int().min(1),
  intervals: z.array(availabilityIntervalSchema).default([]),
  remainderUnavailable: z.boolean().optional(),
});

export const withdrawSchema = z.object({
  responseVersion: z.number().int().min(1),
});

export const finalizeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  eventVersion: z.number().int().min(1),
  resultsVersion: z.number().int().min(1),
  note: z.string().max(500).optional(),
});
