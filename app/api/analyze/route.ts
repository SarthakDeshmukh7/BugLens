import { NextResponse } from "next/server";
import { analyzeScreenshot } from "@/lib/gemma";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export const maxDuration = 120;

// POST route handler for UI screenshot analysis with response caching
export async function POST(req: Request) {
  try {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("image");
    const description = (formData.get("description") as string) || "";
    const widthRaw = formData.get("width");
    const heightRaw = formData.get("height");
    const codeRaw = formData.get("code");
    const nocache = formData.get("nocache") === "1";

    // Validate required image file
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "An image file is required in the 'image' field." },
        { status: 400 }
      );
    }

    // Read image bytes and convert to base64
    const arrayBuffer = await file.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const base64 = imageBuffer.toString("base64");
    const mimeType = file.type || "image/png";

    const width = widthRaw ? String(widthRaw) : undefined;
    const height = heightRaw ? String(heightRaw) : undefined;

    // Optional frontend code (truncated to 12,000 characters)
    let code: string | undefined;
    if (typeof codeRaw === "string") {
      code = codeRaw.slice(0, 12000);
    } else if (codeRaw instanceof Blob) {
      code = (await codeRaw.text()).slice(0, 12000);
    }

    // Compute SHA-256 hash of image bytes + description + code string
    const hash = crypto
      .createHash("sha256")
      .update(imageBuffer)
      .update(description)
      .update(code || "")
      .digest("hex");

    const CACHE_DIR = path.join(process.cwd(), "demo-cache");
    const cacheFilePath = path.join(CACHE_DIR, `${hash}.json`);

    // Cache lookup: unless nocache is set to "1", check if cached response exists
    if (!nocache) {
      try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const cachedRaw = await fs.readFile(cacheFilePath, "utf-8");
        const saved = JSON.parse(cachedRaw);
        return NextResponse.json({
          ...saved,
          cached: true,
        });
      } catch {
        // Cache miss or read error, proceed to live analysis
      }
    }

    // Run live analysis using Gemma models
    const result = await analyzeScreenshot({
      base64,
      mimeType,
      description,
      width,
      height,
      code,
    });

    // Save successful live result to cache (never write failed or error results)
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
      const cachePayload = {
        report: result.report,
        model_used: result.model_used,
        latency_ms: result.latency_ms,
        cached_at: new Date().toISOString(),
      };
      await fs.writeFile(cacheFilePath, JSON.stringify(cachePayload, null, 2), "utf-8");
    } catch (cacheWriteErr: unknown) {
      console.error("Failed to write response to demo-cache:", cacheWriteErr);
    }

    // Return live analysis response
    return NextResponse.json({
      report: result.report,
      model_used: result.model_used,
      latency_ms: result.latency_ms,
      cached: false,
    });
  } catch (error: unknown) {
    // Log error object
    console.error("Error in /api/analyze:", error);

    let status = 500;
    let message = "An unexpected error occurred during analysis.";

    if (error instanceof Error) {
      message = error.message;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
    ) {
      const errStatus = (error as { status: number }).status;
      if (errStatus >= 400 && errStatus < 600) {
        status = errStatus;
      }
    }

    return NextResponse.json({ error: message }, { status });
  }
}
