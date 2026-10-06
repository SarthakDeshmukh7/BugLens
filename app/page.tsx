"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import type { Report } from "@/lib/schema";

interface ApiResponse {
  report: Report;
  model_used: string;
  latency_ms: number;
  cached?: boolean;
  cached_at?: string;
}

interface ImageState {
  file: File;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  originalSize: number;
}

export default function BugLensPage() {
  // Input states
  const [imageState, setImageState] = useState<ImageState | null>(null);
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [isCodeOpen, setIsCodeOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Analysis & execution states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resize image on a canvas to max 1024px on long side (JPEG, quality 0.85)
  const processImageFile = useCallback((file: File) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      const maxSide = 1024;

      if (width > maxSide || height > maxSide) {
        if (width >= height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        setErrorMessage("Failed to create canvas context for image processing.");
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setErrorMessage("Failed to process image to JPEG.");
            return;
          }
          const previewUrl = URL.createObjectURL(blob);
          setImageState({
            file,
            blob,
            previewUrl,
            width,
            height,
            originalSize: file.size,
          });
          setErrorMessage(null);
        },
        "image/jpeg",
        0.85
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setErrorMessage("Could not load the selected image file.");
    };

    img.src = objectUrl;
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processImageFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleClearImage = () => {
    if (imageState?.previewUrl) {
      URL.revokeObjectURL(imageState.previewUrl);
    }
    setImageState(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Timer & Stepper effect during analysis
  useEffect(() => {
    if (!isAnalyzing) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const secs = (Date.now() - startTime) / 1000;
      setElapsedSeconds(Number(secs.toFixed(1)));

      if (secs < 2.5) {
        setActiveStep(1);
      } else if (secs < 12.0) {
        setActiveStep(2);
      } else {
        setActiveStep(3);
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [isAnalyzing]);

  // Submit diagnostic request
  const handleAnalyze = async (overrideNoCache: boolean = false) => {
    if (!imageState) return;

    setElapsedSeconds(0);
    setActiveStep(1);
    setIsAnalyzing(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("image", imageState.blob, "screenshot.jpg");
      formData.append("description", description.trim());
      formData.append("width", String(imageState.width));
      formData.append("height", String(imageState.height));

      if (code.trim()) {
        formData.append("code", code.trim());
      }

      if (overrideNoCache === true) {
        formData.append("nocache", "1");
      }

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Gemma 4 is busy, try again");
      }

      setResult(data);
    } catch (err: unknown) {
      console.error("Diagnostic analysis failed:", err);
      setErrorMessage("Gemma 4 is busy, try again");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex(null);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Top Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-md sticky top-0 z-20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-mono font-bold text-sm shadow-[0_0_12px_rgba(6,182,212,0.15)]">
              BL
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-semibold tracking-tight text-zinc-100">
                  BugLens: turn a vague UI screenshot into an actionable bug report
                </h1>
              </div>
              <p className="text-xs text-zinc-400 flex items-center gap-1.5 mt-0.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Diagnostic inspection tool</span>
                <span className="text-zinc-600">•</span>
                <span className="font-medium text-cyan-400/90 font-mono">Powered by Gemma 4</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-zinc-800 text-zinc-300 border border-zinc-700/60">
              v0.4.0
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              ENGINE READY
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Diagnostics Input */}
        <section className="lg:col-span-5 flex flex-col gap-5">
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 flex flex-col gap-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-cyan-500" />
                Input Payload
              </h2>
              {imageState && (
                <span className="text-[11px] font-mono text-zinc-400">
                  {imageState.width}×{imageState.height}px
                </span>
              )}
            </div>

            {/* Drop Zone */}
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                UI Screenshot <span className="text-rose-400">*</span>
              </label>

              {!imageState ? (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-150 flex flex-col items-center justify-center gap-2.5 ${
                    isDragging
                      ? "border-cyan-500 bg-cyan-950/20 text-cyan-300 shadow-[0_0_16px_rgba(6,182,212,0.15)]"
                      : "border-zinc-700/80 hover:border-zinc-600 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <div className="h-10 w-10 rounded-full bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.75"
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      Drop screenshot here, or{" "}
                      <span className="text-cyan-400 underline decoration-cyan-500/40 underline-offset-2">
                        browse
                      </span>
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      Auto-resized to max 1024px JPEG (0.85 quality)
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 group">
                  <div className="max-h-64 overflow-hidden flex items-center justify-center bg-black/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageState.previewUrl}
                      alt="Uploaded UI bug preview"
                      className="max-h-64 w-auto object-contain"
                    />
                  </div>
                  <div className="p-2.5 bg-zinc-900/90 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono text-zinc-300">
                    <div className="truncate max-w-[240px]">
                      <span className="text-zinc-400">{imageState.file.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500">
                        {imageState.width}×{imageState.height}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearImage}
                        className="px-2 py-0.5 text-[11px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Description Input */}
            <div>
              <label
                htmlFor="description-input"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Describe what looks wrong
              </label>
              <textarea
                id="description-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. The checkout button overlaps the footer and total is wrong on mobile"
                className="w-full rounded-lg bg-zinc-950/80 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500 transition-colors resize-none"
              />
            </div>

            {/* Collapsible Frontend Code */}
            <div className="border border-zinc-800/80 rounded-lg overflow-hidden bg-zinc-950/30">
              <button
                type="button"
                onClick={() => setIsCodeOpen(!isCodeOpen)}
                className="w-full px-3.5 py-2.5 text-left text-xs font-medium text-zinc-300 flex items-center justify-between hover:bg-zinc-900/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <svg
                    className={`w-3.5 h-3.5 text-zinc-400 transition-transform ${
                      isCodeOpen ? "rotate-90" : ""
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  Paste related frontend code (optional)
                </span>
                {code.trim() && (
                  <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                    {code.trim().length} chars
                  </span>
                )}
              </button>

              {isCodeOpen && (
                <div className="p-3 border-t border-zinc-800/80 bg-zinc-950/60">
                  <textarea
                    rows={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="<!-- HTML, React, or CSS snippet -->&#10;<button class='w-[600px] absolute ...'>&#10;  Confirm Purchase&#10;</button>"
                    className="w-full font-mono text-xs text-zinc-200 bg-zinc-950 border border-zinc-800/90 rounded p-2.5 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-cyan-500 focus:border-cyan-500"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Gemma 4 will isolate culprits and generate exact before/after fixes.
                  </p>
                </div>
              )}
            </div>

            {/* Analyze Button */}
            <button
              type="button"
              onClick={() => handleAnalyze()}
              disabled={!imageState || isAnalyzing}
              className={`w-full py-2.5 px-4 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all duration-150 ${
                !imageState || isAnalyzing
                  ? "bg-zinc-800/60 text-zinc-500 border border-zinc-800 cursor-not-allowed"
                  : "bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold shadow-[0_0_16px_rgba(6,182,212,0.25)] active:scale-[0.99]"
              }`}
            >
              {isAnalyzing ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4 text-zinc-950"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                  <span>Running Diagnostic...</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  <span>Analyze Screenshot</span>
                </>
              )}
            </button>
          </div>

          {/* Stepper & Progress when Analyzing */}
          {isAnalyzing && (
            <div className="bg-zinc-900/40 border border-cyan-500/30 rounded-xl p-4 shadow-[0_0_20px_rgba(6,182,212,0.08)] flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-400 font-semibold flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                  ANALYSIS IN PROGRESS
                </span>
                <span className="text-zinc-400">{elapsedSeconds}s elapsed</span>
              </div>

              <div className="space-y-2 mt-1">
                {/* Step 1 */}
                <div
                  className={`flex items-center gap-2.5 text-xs font-mono ${
                    activeStep >= 1 ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                      activeStep > 1
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : activeStep === 1
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 animate-pulse"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {activeStep > 1 ? "✓" : "1"}
                  </div>
                  <span>Reading screenshot</span>
                </div>

                {/* Step 2 */}
                <div
                  className={`flex items-center gap-2.5 text-xs font-mono ${
                    activeStep >= 2 ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                      activeStep > 2
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                        : activeStep === 2
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 animate-pulse"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {activeStep > 2 ? "✓" : "2"}
                  </div>
                  <span>Reasoning with Gemma 4</span>
                </div>

                {/* Step 3 */}
                <div
                  className={`flex items-center gap-2.5 text-xs font-mono ${
                    activeStep === 3 ? "text-zinc-200" : "text-zinc-500"
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] ${
                      activeStep === 3
                        ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 animate-pulse"
                        : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    3
                  </div>
                  <span>Building report</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="bg-rose-950/20 border border-rose-500/40 rounded-xl p-4 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 text-rose-400 text-sm font-medium">
                <svg
                  className="w-5 h-5 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span>{errorMessage}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-rose-300/70">
                  Gemma 4 is experiencing high demand. Please retry.
                </span>
                <button
                  type="button"
                  onClick={() => handleAnalyze()}
                  className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs font-medium rounded border border-rose-500/30 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Report Cards */}
        <section className="lg:col-span-7 flex flex-col gap-5">
          {!result ? (
            <div className="h-full min-h-[460px] bg-zinc-900/20 border border-zinc-800/60 rounded-xl p-8 flex flex-col items-center justify-center text-center">
              <div className="h-14 w-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 mb-4 shadow-inner">
                <svg
                  className="w-7 h-7"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-zinc-300 font-mono">
                DIAGNOSTIC STANDBY
              </h3>
              <p className="text-xs text-zinc-500 max-w-sm mt-1.5 leading-relaxed">
                Provide a screenshot and run analysis to generate visual evidence,
                root-cause hypotheses, and suggested code corrections.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 animate-fadeIn">
              {/* Report Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-900/40 border border-zinc-800/80 rounded-xl px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-300 font-semibold flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-400" />
                    Report
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  {result.cached ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-amber-500/10 text-amber-300 border border-amber-500/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Cached result from Gemma 4 (recorded earlier)
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAnalyze(true)}
                        disabled={isAnalyzing}
                        className="px-2.5 py-1 text-xs font-mono font-medium rounded bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 border border-zinc-700 hover:border-cyan-500/50 transition-colors flex items-center gap-1.5"
                      >
                        <svg
                          className="w-3.5 h-3.5 text-cyan-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Re-run live
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Live Gemma 4 result
                    </span>
                  )}
                </div>
              </div>

              {/* Diagnosis Card */}
              <div className="bg-zinc-900/50 border border-zinc-800/90 rounded-xl p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400 font-bold bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
                      Diagnosis
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60">
                      {result.report.category}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Severity Badge */}
                    <span
                      className={`text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full font-semibold border ${
                        result.report.severity === "high"
                          ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                          : result.report.severity === "medium"
                          ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                          : "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      }`}
                    >
                      {result.report.severity} severity
                    </span>

                    {/* Matches Description Badge */}
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        result.report.matches_user_description === "yes"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : result.report.matches_user_description === "partly"
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      }`}
                    >
                      matches description: {result.report.matches_user_description}
                    </span>
                  </div>
                </div>

                <h3 className="text-sm sm:text-base font-semibold text-zinc-100 leading-snug mb-2">
                  {result.report.summary}
                </h3>

                <p className="text-xs text-zinc-400 leading-relaxed border-t border-zinc-800/60 pt-2.5 mt-2">
                  <span className="font-mono text-zinc-500 uppercase text-[10px] block mb-0.5">
                    Severity Rationale
                  </span>
                  {result.report.severity_reason}
                </p>
              </div>

              {/* Visual Evidence Card */}
              {result.report.visual_evidence && result.report.visual_evidence.length > 0 && (
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-3 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    Visual Evidence ({result.report.visual_evidence.length})
                  </h4>
                  <ul className="space-y-2.5">
                    {result.report.visual_evidence.map((item, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-zinc-300 bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-3 flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                      >
                        <span className="leading-relaxed">{item.observation}</span>
                        {item.location && (
                          <span className="self-start text-[11px] font-mono bg-zinc-800 text-cyan-300 px-2 py-0.5 rounded whitespace-nowrap border border-zinc-700/60">
                            {item.location}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Possible Causes Card (hypotheses) */}
              {result.report.possible_causes && result.report.possible_causes.length > 0 && (
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold mb-3 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    Possible Causes (hypotheses)
                  </h4>
                  <div className="grid grid-cols-1 gap-2.5">
                    {result.report.possible_causes.map((item, idx) => (
                      <div
                        key={idx}
                        className="bg-zinc-950/60 border border-zinc-800/80 rounded-lg p-3 text-xs"
                      >
                        <p className="font-semibold text-zinc-200 mb-1">
                          {idx + 1}. {item.cause}
                        </p>
                        <p className="text-zinc-400 leading-relaxed pl-3 border-l-2 border-amber-500/30">
                          {item.why}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Where to Investigate Card */}
              {result.report.investigate && result.report.investigate.length > 0 && (
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold mb-3 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Where to Investigate
                  </h4>
                  <ul className="space-y-1.5">
                    {result.report.investigate.map((item, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-zinc-300 flex items-start gap-2 bg-zinc-950/40 p-2 rounded border border-zinc-800/40"
                      >
                        <span className="font-mono text-emerald-400 font-bold select-none">
                          ›
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Uncertainties Card */}
              {result.report.uncertainties && result.report.uncertainties.length > 0 && (
                <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-2 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                    Uncertainties
                  </h4>
                  <ul className="space-y-1.5">
                    {result.report.uncertainties.map((item, idx) => (
                      <li
                        key={idx}
                        className="text-xs text-zinc-400 flex items-start gap-2 pl-1"
                      >
                        <span className="text-zinc-600 font-bold">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested Fixes Card (if code_analysis has fixes or not_found_reason) */}
              {result.report.code_analysis && (
                <div className="bg-zinc-900/40 border border-cyan-500/30 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-semibold mb-3 flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                      Suggested Fixes
                    </span>
                    {result.report.code_analysis.fixes && (
                      <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded">
                        {result.report.code_analysis.fixes.length} fix(es)
                      </span>
                    )}
                  </h4>

                  {/* Not Found Reason Note */}
                  {result.report.code_analysis.not_found_reason && (
                    <div className="mb-3.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300/90 leading-relaxed">
                      <span className="font-semibold block mb-0.5">Code Note:</span>
                      {result.report.code_analysis.not_found_reason}
                    </div>
                  )}

                  {/* Culprits */}
                  {result.report.code_analysis.culprits &&
                    result.report.code_analysis.culprits.length > 0 && (
                      <div className="mb-4">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block mb-2">
                          Identified Culprits:
                        </span>
                        <div className="space-y-2">
                          {result.report.code_analysis.culprits.map((culprit, idx) => (
                            <div
                              key={idx}
                              className="text-xs font-mono bg-zinc-950 p-2.5 rounded border border-zinc-800 text-zinc-300"
                            >
                              {culprit.location && (
                                <span className="text-cyan-400 block text-[11px] mb-0.5">
                                  {culprit.location}
                                </span>
                              )}
                              <span>{culprit.problem}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Fixes List */}
                  {result.report.code_analysis.fixes &&
                    result.report.code_analysis.fixes.length > 0 && (
                      <div className="space-y-4">
                        {result.report.code_analysis.fixes.map((fix, idx) => (
                          <div
                            key={idx}
                            className="bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden text-xs font-mono"
                          >
                            <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
                              <span className="font-semibold text-zinc-200">
                                Fix {idx + 1}: {fix.description}
                              </span>
                            </div>

                            <div className="p-3 space-y-3">
                              {/* Before */}
                              {fix.before && (
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-rose-400 font-semibold block mb-1">
                                    Before (Existing):
                                  </span>
                                  <pre className="p-2.5 rounded bg-zinc-900/80 border border-rose-500/20 text-rose-300/90 overflow-x-auto text-[11px]">
                                    <code>{fix.before}</code>
                                  </pre>
                                </div>
                              )}

                              {/* After */}
                              {fix.after && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold block">
                                      After (Correction):
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => copyToClipboard(fix.after, idx)}
                                      className="px-2 py-0.5 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors flex items-center gap-1"
                                    >
                                      {copiedIndex === idx ? (
                                        <>
                                          <span className="text-emerald-400">✓</span>
                                          <span>Copied!</span>
                                        </>
                                      ) : (
                                        <>
                                          <span>Copy</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                  <pre className="p-2.5 rounded bg-zinc-900/80 border border-emerald-500/20 text-emerald-300/90 overflow-x-auto text-[11px]">
                                    <code>{fix.after}</code>
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              )}

              {/* Diagnostic Footer */}
              <div className="border-t border-zinc-800/80 pt-3 flex flex-wrap items-center justify-between text-xs font-mono text-zinc-500">
                <div className="flex items-center gap-3">
                  <span>
                    Model: <strong className="text-zinc-300">{result.model_used}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Latency:{" "}
                    <strong className="text-zinc-300">
                      {(result.latency_ms / 1000).toFixed(2)}s
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  className="hover:text-zinc-300 transition-colors"
                >
                  Back to Top ↑
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
