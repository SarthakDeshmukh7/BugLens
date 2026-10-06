import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Route handler for testing vision model UI analysis
export async function POST(req: Request) {
  try {
    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("image");
    const description = (formData.get("description") as string) || "";

    // Validate image file presence
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "An image file is required in the 'image' field." },
        { status: 400 }
      );
    }

    // Convert the image blob to inline base64 string
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const mimeType = file.type;

    // Check API key configuration
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY environment variable is not set." },
        { status: 500 }
      );
    }

    // Initialize Google GenAI SDK client
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Describe any UI problems visible in this screenshot. User description: ${description}`;

    // Call gemma-4-26b-a4b-it with single user message
    const response = await ai.models.generateContent({
      model: "gemma-4-26b-a4b-it",
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
    });

    // Return the text response as JSON
    return NextResponse.json({
      text: response.text ?? "",
    });
  } catch (error: unknown) {
    // Log full error object
    console.error(error);
    // Extract status code and error message on failure
    let status = 500;
    let message = "An unexpected error occurred.";

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
