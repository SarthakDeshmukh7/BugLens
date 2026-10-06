# BugLens

> **Turn a vague UI screenshot into an actionable bug report.**

Built for **Hacktoberfest x MSC KBTCOE 2026**  
**Problem Statement 1:** *"The Bug That Only Exists on Screen"*

---

## 1. Overview & Hackathon Context

UI bugs are among the most frustrating issues in software development: they often produce zero JavaScript console errors, yet degrade the user experience. A QA tester or user snaps a partial screenshot and files a ticket saying *"checkout looks broken"*, leaving developers to manually guess which container, media query, or flex setting failed.

**BugLens** is a developer diagnostic tool created for **Hacktoberfest x MSC KBTCOE 2026 (Problem Statement 1: "The Bug That Only Exists on Screen")**. It bridges the gap between visual anomalies and root-cause debugging by using multimodal reasoning with **Gemma 4** to translate raw UI screenshots, natural language observations, and optional code snippets into structured, actionable engineering reports.

---

## 2. The Problem

- **Zero stack traces:** Layout overlaps, clipped text, broken alignment, mobile viewport overflows, and contrast issues rarely throw runtime errors. They exist only visually on screen.
- **Vague reporting:** Bug tickets frequently contain low-context screenshots accompanied by vague descriptions like *"buttons look wrong"* or *"alignment is off"*.
- **High triage overhead:** Engineers spend valuable time recreating viewport sizes, guessing which CSS classes collided, or hunting down the exact JSX/HTML component responsible for the visual flaw.

---

## 3. How It Works

BugLens processes UI bug submissions through an end-to-end multimodal pipeline:

```
[ User Screenshot + Description + Optional Code ]
                     │
                     ▼
       Browser Canvas Optimization
      (Max 1024px, JPEG 0.85 Quality)
                     │
                     ▼
          Next.js Route Handler
            (/api/analyze)
                     │
                     ├─► Cache Lookup (SHA-256 Hash of image + text + code)
                     │
                     ▼
         Gemma 4 Multimodal Reasoning
        (Primary: gemma-4-26b-a4b-it)
        (Fallback: gemma-4-31b-it)
                     │
                     ▼
        Report Normalization & Zod Validation
                     │
                     ▼
       Structured Diagnostic Report in UI
```

1. **Payload Submission:** The user drops a UI screenshot, provides a short description of what looks wrong, and optionally pastes related frontend code (React, HTML, CSS, or Tailwind).
2. **Client-Side Image Optimization:** Before uploading, the image is automatically resized on a canvas element to a maximum of 1024px on the longest dimension (JPEG format, quality 0.85) to conserve bandwidth while preserving visual fidelity.
3. **API Processing (`/api/analyze`):** The Next.js API route checks for a cached response. If none exists (or if `nocache=1` is provided), it dispatches the request to Gemma 4 via the official Google GenAI SDK (`@google/genai`).
   - **Primary Model:** `gemma-4-26b-a4b-it`
   - **Fallback Model:** `gemma-4-31b-it` (automatically engaged if the primary model encounters repeated transient errors)
4. **Validation & Normalization:** Raw JSON responses are cleaned by a normalizer function (mapping fuzzy categories and fixing malformed fixes) and validated through a strict **Zod** schema.
5. **Interactive Diagnostic Report:** The UI renders an engineer-friendly diagnostic breakdown:
   - **Diagnosis:** High-level summary, categorical tag (`layout`, `responsive`, `alignment`, `spacing`, `typography`, `color-contrast`, `missing-element`, `overlap-clipping`, `other`), and confirmation of whether the visual bug matches the user's description (`yes`, `partly`, `no`).
   - **Severity & Reason:** `low`, `medium`, or `high` classification paired with an explicit technical justification.
   - **Visual Evidence:** Specific visual observations with exact screen locations (e.g. *"top-right header"*, *"checkout footer"*).
   - **Possible Causes (Hypotheses):** Structured technical hypotheses explaining *why* the defect likely occurred.
   - **Where to Investigate:** Targeted CSS properties, layout wrappers, or component trees to inspect.
   - **Uncertainties:** Explicit boundaries of what cannot be determined from the screenshot alone.
   - **Suggested Code Fixes (Optional):** When frontend code is provided, culprits are isolated with quoted selectors, and before/after code blocks provide copyable corrections.

---

## 4. Why Gemma 4

BugLens leverages Google's open **Gemma 4** models (`gemma-4-26b-a4b-it` and `gemma-4-31b-it`) accessed through the Gemini API:

- **Multimodal Context:** Gemma 4 reasons simultaneously across visual pixels (the screenshot), natural language descriptions (the user's complaint), and source code (the implementation).
- **Grounded Evidence:** Prompts are structured to mandate that visual evidence directly correspond to visible rendered elements, discouraging speculative visual assertions.
- **Code Quoting With Guardrails:** When analyzing frontend code, Gemma 4 is instructed to quote only classes and selectors that actually appear in the submitted code, and to explain in not_found_reason when the code does not account for the bug. This reduces, but does not eliminate, invented details, so suggested fixes should be reviewed before they are applied.

---

## 5. Honest Design Choices

- **Acknowledging Uncertainties:** Static screenshots do not provide computed styles or runtime state. BugLens requires the model to list an `uncertainties` array highlighting what it cannot know (e.g. whether an issue is caused by parent overflow clipping or an absolute position rule).
- **Hypotheses Rather Than Dogma:** Suspected root causes are explicitly labeled as hypotheses to guide developer investigation rather than pretending to be absolute facts.
- **Graceful Retries & Model Fallback:** Transient API errors (HTTP 500 and 503, and network failures) are retried after a short delay. If the primary model keeps failing, one attempt is made on gemma-4-31b-it.
- **Transparent Response Caching:**
  - Fast, deterministic cache keys are computed from a SHA-256 hash of the image bytes, the description string, and the code snippet.
  - Cached payloads are stored as real recorded Gemma 4 outputs in `demo-cache/`.
  - When served from cache, the UI clearly displays:  
    `Cached result from Gemma 4 (recorded earlier)`
  - A **"Re-run live"** button is provided to force a fresh analysis (`nocache=1`). Live results are clearly labeled:  
    `Live Gemma 4 result`
  - Cache errors are wrapped in `try/catch` blocks so filesystem issues never crash live requests.

---

## 6. Tech Stack

- **Framework:** [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language:** TypeScript
- **Styling:** Vanilla Tailwind CSS (dark developer diagnostic interface)
- **Validation:** [Zod](https://zod.dev/) for structured data validation and normalization
- **AI SDK:** [`@google/genai`](https://www.npmjs.com/package/@google/genai) (Google Gemini API with Gemma 4 models)
- **Hashing & Storage:** Node.js `crypto` (SHA-256) and `fs/promises`

---

## 7. Run Locally

### Prerequisites
- Node.js 20.9 or newer
- A Google Gemini API key with access to Gemma 4 models

### Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/buglens.git
   cd buglens
   ```
   (replace YOUR_GITHUB_USERNAME with the account that hosts this repository)

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env.local` file in the project root:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open in browser:**
   Navigate to [http://localhost:3000](http://localhost:3000) to use BugLens.

---

## 8. Limitations

To set honest expectations, BugLens has the following limitations:

- **No Computed CSS Inspection:** The tool cannot inspect actual browser DOM trees or computed CSS styles from a screenshot alone.
- **Code Snippet Truncation:** Pasted frontend code is truncated to 12,000 characters to operate reliably within token constraints.
- **Vision Misinterpretations:** Multimodal models can occasionally misjudge subtle pixel alignments or low-contrast elements.
- **External Data Transmission:** Uploaded screenshots and pasted code snippets are sent to the Google Gemini API for inference.
- **No Screenshot Diffing:** Direct before-and-after visual diffing or Figma design-to-implementation comparison is not currently implemented.

---

## 9. Demo Cases

The repository includes recorded real Gemma 4 results in demo-cache/: one case with pasted frontend code and one screenshot-only case. They are replayed instantly and labelled as cached in the UI. Use the 'Re-run live' button to call the model again.

---

## 10. AI-Assisted Development

BugLens was designed and built during the Hacktoberfest x MSC KBTCOE 2026 hackathon, working solo, with AI assistance:

Google Antigravity was the coding environment. Its agent (running a Gemini model, shown in the IDE as "Gemini 3.8 Flash High") wrote most of the code from prompts I wrote and reviewed.
Claude was used as a helper for planning, architecture, prompt design and debugging guidance. It did not edit the codebase directly.
Gemma 4 (gemma-4-26b-a4b-it, with gemma-4-31b-it as the fallback, through the Google Gemini API) is the model inside BugLens that analyzes screenshots. No Gemini model is used by the app itself.

I reviewed and tested the code during the build window.
