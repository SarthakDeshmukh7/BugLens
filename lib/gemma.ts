import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { ReportSchema, type Report } from "./schema";
import { z } from "zod";

const SCHEMA_DIRECTIVE =
  "Respond with exactly ONE JSON object, not an array. Describe the single most important issue in the screenshot; mention any other issues inside visual_evidence. The object must have exactly these keys: summary, category, severity, severity_reason, visual_evidence (array of objects with observation and location), possible_causes (array of objects with cause and why), investigate (array of strings), uncertainties (array of strings), matches_user_description (yes, partly, or no).";

const SYSTEM_INSTRUCTION =
  `You are a UI bug analyst. You are given a screenshot and a short bug description. Describe only what is visibly present in the screenshot. Every item in visual_evidence must be something you can actually see, with its location (for example, top navigation, bottom-right of the page). Do not invent elements that are not visible. Treat possible_causes as hypotheses to verify, not facts, because you cannot see the source code. If the screenshot's dimensions suggest a desktop viewport but the user reports a phone problem, say that in uncertainties. Anything you cannot determine from a screenshot goes in uncertainties. Respond only with JSON matching the schema. ${SCHEMA_DIRECTIVE}`;

export const PRIMARY_MODEL = "gemma-4-26b-a4b-it";
export const FALLBACK_MODEL = "gemma-4-31b-it";

export interface AnalyzeOptions {
  base64: string;
  mimeType: string;
  description: string;
  width?: number | string | null;
  height?: number | string | null;
  code?: string | null;
}

export interface AnalyzeResult {
  report: Report;
  model_used: string;
  latency_ms: number;
}

// Extract response text while ignoring any part with thought: true
function extractNonThoughtText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (part && !part.thought && typeof part.text === "string") {
      textParts.push(part.text);
    }
  }

  if (textParts.length > 0) {
    return textParts.join("");
  }

  return response.text ?? "";
}

// Strip markdown code fences if present (e.g. ```json ... ``` or ``` ... ```)
function stripMarkdownCodeFences(raw: string): string {
  const text = raw.trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (match) {
    return match[1].trim();
  }
  const embeddedMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (embeddedMatch) {
    return embeddedMatch[1].trim();
  }
  return text;
}

// Check if error is retryable (fetch failed, 500, 503, UNAVAILABLE, or JSON parse / Zod validation error)
function isRetryableError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true;
  }
  if (error instanceof z.ZodError) {
    return true;
  }
  if (typeof error === "object" && error !== null) {
    const errObj = error as Record<string, unknown>;
    const status = errObj.status;
    const statusCode = errObj.statusCode;
    const code = errObj.code;

    if (status === 500 || status === 503 || status === "UNAVAILABLE") {
      return true;
    }
    if (statusCode === 500 || statusCode === 503) {
      return true;
    }
    if (code === 500 || code === 503) {
      return true;
    }
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("fetch failed") ||
      msg.includes("500") ||
      msg.includes("503") ||
      msg.includes("service unavailable") ||
      msg.includes("internal server error") ||
      msg.includes("unavailable") ||
      msg.includes("high demand")
    ) {
      return true;
    }
    if ("cause" in error && error.cause instanceof Error) {
      const causeMsg = error.cause.message.toLowerCase();
      if (
        causeMsg.includes("fetch failed") ||
        causeMsg.includes("econnreset") ||
        causeMsg.includes("etimedout")
      ) {
        return true;
      }
    }
  }
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Normalize model output before validation against ReportSchema
function normalizeReport(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    return raw;
  }

  const obj = { ...(raw as Record<string, unknown>) };

  // (1) Lowercase and trim category and severity
  const validCategories = new Set([
    "layout",
    "responsive",
    "alignment",
    "spacing",
    "typography",
    "color-contrast",
    "missing-element",
    "overlap-clipping",
    "other",
  ]);

  if (typeof obj.category === "string") {
    const cat = obj.category.trim().toLowerCase();
    if (validCategories.has(cat)) {
      obj.category = cat;
    } else if (cat.includes("overlap") || cat.includes("clip")) {
      obj.category = "overlap-clipping";
    } else if (cat.includes("responsive") || cat.includes("mobile")) {
      obj.category = "responsive";
    } else if (cat.includes("align")) {
      obj.category = "alignment";
    } else if (cat.includes("spac") || cat.includes("margin") || cat.includes("padding")) {
      obj.category = "spacing";
    } else if (cat.includes("contrast") || cat.includes("color")) {
      obj.category = "color-contrast";
    } else if (cat.includes("layout")) {
      obj.category = "layout";
    } else if (cat.includes("missing")) {
      obj.category = "missing-element";
    } else {
      obj.category = "other";
    }
  } else {
    obj.category = "other";
  }

  const validSeverities = new Set(["low", "medium", "high"]);
  if (typeof obj.severity === "string") {
    const sev = obj.severity.trim().toLowerCase();
    if (validSeverities.has(sev)) {
      obj.severity = sev;
    } else {
      obj.severity = "medium";
    }
  } else {
    obj.severity = "medium";
  }

  // Normalize matches_user_description if present
  if (typeof obj.matches_user_description === "string") {
    const mud = obj.matches_user_description.trim().toLowerCase();
    if (mud === "yes" || mud === "no" || mud === "partly") {
      obj.matches_user_description = mud;
    } else if (mud.includes("part")) {
      obj.matches_user_description = "partly";
    } else if (mud.includes("no")) {
      obj.matches_user_description = "no";
    } else {
      obj.matches_user_description = "yes";
    }
  }

  // (4) visual_evidence items that are strings become { observation: <string>, location: "" }
  if (Array.isArray(obj.visual_evidence)) {
    obj.visual_evidence = obj.visual_evidence.map((item) => {
      if (typeof item === "string") {
        return { observation: item, location: "" };
      }
      if (typeof item === "object" && item !== null) {
        const itemObj = item as Record<string, unknown>;
        return {
          observation: typeof itemObj.observation === "string" ? itemObj.observation : String(itemObj.observation ?? ""),
          location: typeof itemObj.location === "string" ? itemObj.location : String(itemObj.location ?? ""),
        };
      }
      return { observation: String(item ?? ""), location: "" };
    });
  }

  // (4) possible_causes items that are strings become { cause: <string>, why: "" }
  if (Array.isArray(obj.possible_causes)) {
    obj.possible_causes = obj.possible_causes.map((item) => {
      if (typeof item === "string") {
        return { cause: item, why: "" };
      }
      if (typeof item === "object" && item !== null) {
        const itemObj = item as Record<string, unknown>;
        return {
          cause: typeof itemObj.cause === "string" ? itemObj.cause : String(itemObj.cause ?? ""),
          why: typeof itemObj.why === "string" ? itemObj.why : String(itemObj.why ?? ""),
        };
      }
      return { cause: String(item ?? ""), why: "" };
    });
  }

  // (2) & (3) code_analysis normalization
  if (typeof obj.code_analysis === "object" && obj.code_analysis !== null) {
    const codeAnalysis = { ...(obj.code_analysis as Record<string, unknown>) };

    // (2) in code_analysis.culprits, convert any string item into { location: "", problem: <the string> }
    if (Array.isArray(codeAnalysis.culprits)) {
      codeAnalysis.culprits = codeAnalysis.culprits.map((item) => {
        if (typeof item === "string") {
          return { location: "", problem: item };
        }
        if (typeof item === "object" && item !== null) {
          const itemObj = item as Record<string, unknown>;
          return {
            location: typeof itemObj.location === "string" ? itemObj.location : String(itemObj.location ?? ""),
            problem: typeof itemObj.problem === "string" ? itemObj.problem : String(itemObj.problem ?? ""),
          };
        }
        return { location: "", problem: String(item ?? "") };
      });
    }

    // (3) in code_analysis.fixes, if an item lacks description, set it to its problem or title if present, or else "Suggested fix"; make sure before and after are strings (use "" if missing)
    if (Array.isArray(codeAnalysis.fixes)) {
      codeAnalysis.fixes = codeAnalysis.fixes.map((item) => {
        if (typeof item === "object" && item !== null) {
          const itemObj = item as Record<string, unknown>;
          let description = "Suggested fix";
          if (typeof itemObj.description === "string" && itemObj.description.trim()) {
            description = itemObj.description;
          } else if (typeof itemObj.problem === "string" && itemObj.problem.trim()) {
            description = itemObj.problem;
          } else if (typeof itemObj.title === "string" && itemObj.title.trim()) {
            description = itemObj.title;
          }

          const before = typeof itemObj.before === "string" ? itemObj.before : "";
          const after = typeof itemObj.after === "string" ? itemObj.after : "";

          return {
            ...itemObj,
            description,
            before,
            after,
          };
        }
        if (typeof item === "string") {
          return {
            description: item,
            before: "",
            after: "",
          };
        }
        return {
          description: "Suggested fix",
          before: "",
          after: "",
        };
      });
    }

    obj.code_analysis = codeAnalysis;
  }

  return obj;
}

// Call model, filter thought parts, strip fences, parse JSON, and validate against schema
async function callAndParse(
  ai: GoogleGenAI,
  model: string,
  base64: string,
  mimeType: string,
  prompt: string
): Promise<Report> {
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 4096,
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });

  const rawText = extractNonThoughtText(response);
  const cleanedText = stripMarkdownCodeFences(rawText);
  const parsedJson = JSON.parse(cleanedText);

  // If the result is an array with at least one element, use its first element as the report
  const candidate =
    Array.isArray(parsedJson) && parsedJson.length > 0 ? parsedJson[0] : parsedJson;

  const normalized = normalizeReport(candidate);

  try {
    return ReportSchema.parse(normalized);
  } catch (validationError: unknown) {
    console.error(
      "Report validation failed. Raw response snippet (first 800 chars):",
      rawText.slice(0, 800)
    );
    throw validationError;
  }
}

// Main analysis function with retry policy and fallback model
export async function analyzeScreenshot(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const startTime = Date.now();
  const TIMEOUT_MS = 35000;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Build prompt including description, optional screenshot dimensions, and directive
  let prompt = `User description: ${options.description}`;
  if (options.width && options.height) {
    prompt += `\nScreenshot dimensions: ${options.width}x${options.height} pixels.`;
  }
  prompt += `\n${SCHEMA_DIRECTIVE}`;

  // When frontend code is provided, append code analysis instructions
  if (options.code && options.code.trim().length > 0) {
    prompt += `\n\nThe developer also provided this frontend code:\n\n${options.code}\n\nAdd a code_analysis object. culprits must quote or reference actual lines or selectors that appear in the provided code. Each fixes item must have before (exact code copied from the provided code) and after (the corrected code). Do not invent files, classes, or lines that are not in the provided code. If the provided code does not explain the bug, leave culprits and fixes empty and explain in not_found_reason.`;
  }

  const canAttempt = () => Date.now() - startTime < TIMEOUT_MS;

  let report: Report | null = null;
  let modelUsed = PRIMARY_MODEL;
  let lastError: unknown;

  // 1 attempt on gemma-4-26b-a4b-it
  try {
    report = await callAndParse(ai, PRIMARY_MODEL, options.base64, options.mimeType, prompt);
    modelUsed = PRIMARY_MODEL;
  } catch (err: unknown) {
    lastError = err;
    console.error(`Attempt 1 with ${PRIMARY_MODEL} failed:`, err);

    if (!isRetryableError(err)) {
      throw err;
    }

    // One retry after 2 seconds (if within 35 seconds)
    await sleep(2000);

    if (canAttempt()) {
      try {
        report = await callAndParse(ai, PRIMARY_MODEL, options.base64, options.mimeType, prompt);
        modelUsed = PRIMARY_MODEL;
      } catch (retryErr: unknown) {
        lastError = retryErr;
        console.error(`Retry attempt with ${PRIMARY_MODEL} failed:`, retryErr);

        if (!isRetryableError(retryErr)) {
          throw retryErr;
        }
      }
    } else {
      console.warn("Skipping primary model retry: 35s deadline exceeded.");
    }
  }

  // If primary model failed, make 1 attempt on gemma-4-31b-it (if within 35 seconds)
  if (!report) {
    if (canAttempt()) {
      console.error(`Attempting fallback with ${FALLBACK_MODEL}...`);
      try {
        report = await callAndParse(ai, FALLBACK_MODEL, options.base64, options.mimeType, prompt);
        modelUsed = FALLBACK_MODEL;
      } catch (fallbackErr: unknown) {
        console.error(`Fallback attempt with ${FALLBACK_MODEL} failed:`, fallbackErr);
        throw fallbackErr;
      }
    } else {
      console.warn("Skipping fallback attempt: 35s deadline exceeded.");
      throw lastError || new Error("UI analysis timed out after 35 seconds.");
    }
  }

  if (!report) {
    throw lastError || new Error("UI analysis failed.");
  }

  const latency_ms = Date.now() - startTime;

  return {
    report,
    model_used: modelUsed,
    latency_ms,
  };
}
