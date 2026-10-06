import { z } from "zod";

// Zod schema for UI bug analysis report
export const ReportSchema = z.object({
  summary: z.string(),
  category: z.enum([
    "layout",
    "responsive",
    "alignment",
    "spacing",
    "typography",
    "color-contrast",
    "missing-element",
    "overlap-clipping",
    "other",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  severity_reason: z.string(),
  visual_evidence: z
    .array(
      z.object({
        observation: z.string(),
        location: z.string(),
      })
    )
    .default([]),
  possible_causes: z
    .array(
      z.object({
        cause: z.string(),
        why: z.string(),
      })
    )
    .default([]),
  investigate: z.array(z.string()).default([]),
  uncertainties: z.array(z.string()).default([]),
  matches_user_description: z.enum(["yes", "partly", "no"]),
  code_analysis: z
    .object({
      culprits: z
        .array(
          z.object({
            location: z.string(),
            problem: z.string(),
          })
        )
        .default([]),
      fixes: z
        .array(
          z.object({
            description: z.string(),
            before: z.string(),
            after: z.string(),
          })
        )
        .default([]),
      not_found_reason: z.string().optional(),
    })
    .optional(),
});

export const reportSchema = ReportSchema;
export type Report = z.infer<typeof ReportSchema>;
export type BugReport = Report;
