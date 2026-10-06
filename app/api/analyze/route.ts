import { NextResponse } from "next/server";
import { analyzeScreenshot } from "@/lib/gemma";

export const maxDuration = 120;

// POST route handler for UI screenshot analysis
export async function POST(req: Request) {
  try {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("image");
    const description = (formData.get("description") as string) || "";
    const widthRaw = formData.get("width");
    const heightRaw = formData.get("height");
    const codeRaw = formData.get("code");

    // Validate required image file
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "An image file is required in the 'image' field." },
        { status: 400 }
      );
    }

    // Convert file to base64 inline string and retrieve mime type
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
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

    // Run analysis using Gemma models with retry and fallback
    const result = await analyzeScreenshot({
      base64,
      mimeType,
      description,
      width,
      height,
      code,
    });

    // Return analysis report, model used, and latency
    return NextResponse.json({
      report: result.report,
      model_used: result.model_used,
      latency_ms: result.latency_ms,
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
