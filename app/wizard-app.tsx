"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Stepper, type WizardStep } from "@/components/wizard/stepper";
import { UploadStep } from "@/components/wizard/upload-step";
import { CalibrateStep } from "@/components/wizard/calibrate-step";
import { AnalyzeStep, type AnalyzePhase } from "@/components/wizard/analyze-step";
import { ReviewStep } from "@/components/wizard/review-step";
import { fetchDemoManifest, type DemoClip } from "@/lib/demo-manifest";
import { isValidJobId } from "@/lib/id";
import { ResultsSchema, type CourtCorners, type ProgressJson, type Results } from "@/lib/types";

type ClipSource =
  | { kind: "upload"; file: File; videoUrl: string }
  | { kind: "demo"; clip: DemoClip; videoUrl: string };

type ResultsPhase = "idle" | "polling" | "ready" | "error" | "timeout";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 6 * 60 * 1000;

function putWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (status ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — network error"));
    xhr.send(file);
  });
}

export function WizardApp() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<WizardStep>("upload");
  const [source, setSource] = useState<ClipSource | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [corners, setCorners] = useState<CourtCorners | null>(null);

  const [results, setResults] = useState<Results | null>(null);
  const [progress, setProgress] = useState<ProgressJson | null>(null);
  const [resultsPhase, setResultsPhase] = useState<ResultsPhase>("idle");
  const [resultsError, setResultsError] = useState<string | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const lastFileRef = useRef<File | null>(null);

  const [warmStatus, setWarmStatus] = useState<"idle" | "warming" | "done" | "error">("idle");

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number | null>(null);
  const recoveredRef = useRef(false);

  const setUrlParam = useCallback(
    (key: "id" | "demo", value: string) => {
      const params = new URLSearchParams();
      params.set(key, value);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const clearUrlParams = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;

      const tick = async () => {
        if (pollDeadlineRef.current !== null && Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setResultsPhase("timeout");
          return;
        }
        try {
          const res = await fetch(`/api/results/${id}`, { cache: "no-store" });
          if (res.status === 200) {
            const data = await res.json();
            const parsed = ResultsSchema.safeParse(data);
            if (parsed.success) {
              setResults(parsed.data);
              setResultsPhase("ready");
              stopPolling();
            } else {
              setResultsError("Results did not match the expected format.");
              setResultsPhase("error");
              stopPolling();
            }
          } else if (res.status === 202) {
            const data = await res.json().catch(() => null);
            if (data) setProgress(data);
          } else if (res.status === 500) {
            const data = await res.json().catch(() => ({}));
            setResultsError(data.message ?? "Analysis failed.");
            setResultsPhase("error");
            stopPolling();
          }
        } catch {
          // transient network error — keep polling until the hard timeout
        }
      };

      tick();
      pollTimerRef.current = setInterval(tick, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  useEffect(() => stopPolling, [stopPolling]);

  const selectDemoClip = useCallback(
    async (clip: DemoClip) => {
      setUploadError(null);
      setJobId(clip.id);
      setUrlParam("demo", clip.id);
      setSource({ kind: "demo", clip, videoUrl: clip.videoPath });
      setResults(null);
      setResultsError(null);
      setResultsPhase("polling");
      setCorners(null);
      setStep("calibrate");

      try {
        const res = await fetch(clip.resultsPath, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load this demo clip's results.");
        const data = await res.json();
        const parsed = ResultsSchema.safeParse(data);
        if (!parsed.success) throw new Error("Demo results did not match the expected format.");
        setResults(parsed.data);
        setResultsPhase("ready");
      } catch (err) {
        setResultsError(err instanceof Error ? err.message : "Could not load demo results.");
        setResultsPhase("error");
      }
    },
    [setUrlParam],
  );

  // Recover from a page refresh via ?id=/?demo= in the URL (Decision #18/F3).
  useEffect(() => {
    if (recoveredRef.current) return;
    recoveredRef.current = true;

    const demoId = searchParams.get("demo");
    const id = searchParams.get("id");

    if (demoId) {
      fetchDemoManifest().then((clips) => {
        const clip = clips.find((c) => c.id === demoId);
        if (clip) selectDemoClip(clip);
      });
    } else if (id && isValidJobId(id)) {
      // Live-upload recovery: the local File/blob URL is gone (accepted tradeoff,
      // Decision F4) so there's no video to calibrate with — resume polling and
      // surface a "start over" fallback once/if results land. Deferred a tick so
      // these state updates aren't synchronous within the effect body itself.
      queueMicrotask(() => {
        setJobId(id);
        setResultsPhase("polling");
        setStep("analyze");
        startPolling(id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startUpload = useCallback(
    async (file: File) => {
      lastFileRef.current = file;
      setUploadError(null);
      setIsUploading(true);
      setUploadProgress(0);

      try {
        const presignRes = await fetch("/api/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, contentType: file.type }),
        });
        if (!presignRes.ok) {
          const body = await presignRes.json().catch(() => ({}));
          throw new Error(body.message ?? "Failed to get an upload URL.");
        }
        const { jobId: newJobId, url } = await presignRes.json();

        await putWithProgress(url, file, setUploadProgress);

        setIsUploading(false);
        setJobId(newJobId);
        setUrlParam("id", newJobId);
        setSource({ kind: "upload", file, videoUrl: URL.createObjectURL(file) });
        setResults(null);
        setResultsError(null);
        setProgress(null);
        setCorners(null);
        setResultsPhase("polling");
        setStep("calibrate");
        startPolling(newJobId);

        // Critical sequencing (EUREKA finding, Phase 3): kick off inference
        // immediately — do NOT wait for calibration. A failed invoke here
        // (e.g. the Lambda doesn't exist yet) surfaces naturally via the
        // poll timing out or the eventual error.json path, not a client hack.
        fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: newJobId }),
        }).catch(() => {});
      } catch (err) {
        setIsUploading(false);
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
      }
    },
    [setUrlParam, startPolling],
  );

  const handleCalibrateContinue = useCallback(
    (c: CourtCorners) => {
      setCorners(c);
      setStep(resultsPhase === "ready" ? "review" : "analyze");
    },
    [resultsPhase],
  );

  // Auto-advance out of the Analyze screen the moment results land, if the
  // user got there before inference finished. Derived at render time rather
  // than via a setState-in-effect, so there's no extra render pass and no
  // window where `step` and `resultsPhase` briefly disagree.
  const effectiveStep: WizardStep =
    step === "analyze" && resultsPhase === "ready" && source ? "review" : step;

  const resetAll = useCallback(() => {
    stopPolling();
    setStep("upload");
    setSource(null);
    setJobId(null);
    setCorners(null);
    setResults(null);
    setProgress(null);
    setResultsPhase("idle");
    setResultsError(null);
    setIsUploading(false);
    setUploadProgress(0);
    setUploadError(null);
    clearUrlParams();
  }, [stopPolling, clearUrlParams]);

  const retryAnalysis = useCallback(() => {
    if (!jobId) return;
    setResultsError(null);
    setProgress(null);
    setResultsPhase("polling");
    if (source?.kind === "demo") {
      selectDemoClip(source.clip);
      return;
    }
    fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    }).catch(() => {});
    startPolling(jobId);
  }, [jobId, source, selectDemoClip, startPolling]);

  const triggerWarmPing = useCallback(async () => {
    setWarmStatus("warming");
    try {
      const res = await fetch("/api/warm", { method: "POST" });
      setWarmStatus(res.ok ? "done" : "error");
    } catch {
      setWarmStatus("error");
    }
  }, []);

  const analyzePhase: AnalyzePhase = resultsPhase === "timeout" ? "timeout" : resultsPhase === "error" ? "error" : "polling";

  const retryUpload = useCallback(() => {
    if (lastFileRef.current) startUpload(lastFileRef.current);
  }, [startUpload]);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-semibold tracking-tight">RefAI</span>
            <span className="text-xs text-muted-foreground hidden sm:inline">Virtual tennis referee</span>
          </div>
          <div className="flex items-center gap-4">
            <Stepper current={effectiveStep} />
            <Button
              size="sm"
              variant="ghost"
              onClick={triggerWarmPing}
              disabled={warmStatus === "warming"}
              title="Send a warm-up ping to the inference function before a live demo"
            >
              {warmStatus === "warming"
                ? "Warming…"
                : warmStatus === "done"
                  ? "Warmed"
                  : warmStatus === "error"
                    ? "Warm failed"
                    : "Warm up"}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8">
        {effectiveStep === "upload" && (
          <UploadStep
            onSelectDemo={selectDemoClip}
            onFileAccepted={startUpload}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            uploadError={uploadError}
            onRetry={retryUpload}
            onDismissError={() => setUploadError(null)}
          />
        )}

        {effectiveStep === "calibrate" && source && (
          <CalibrateStep videoUrl={source.videoUrl} onContinue={handleCalibrateContinue} />
        )}

        {effectiveStep === "analyze" &&
          (source === null && resultsPhase === "ready" ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <div className="text-sm font-medium">Results are ready</div>
              <div className="text-sm text-muted-foreground max-w-md">
                The video preview was lost on refresh (it plays from your local file, which isn&apos;t
                persisted). Start over to analyze a clip and review it end-to-end.
              </div>
              <Button onClick={resetAll}>Start over</Button>
            </div>
          ) : (
            <AnalyzeStep
              progress={progress}
              phase={analyzePhase}
              errorMessage={resultsError}
              onCancel={resetAll}
              onRetry={retryAnalysis}
            />
          ))}

        {effectiveStep === "review" && source && results && corners && (
          <ReviewStep videoUrl={source.videoUrl} results={results} corners={corners} />
        )}
      </main>
    </div>
  );
}
