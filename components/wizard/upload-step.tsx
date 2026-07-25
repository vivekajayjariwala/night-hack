"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { fetchDemoManifest, type DemoClip } from "@/lib/demo-manifest";
import { validateUploadFile, UPLOAD_GATE_MESSAGE } from "@/lib/upload-gate";
import { cn } from "@/lib/utils";

export function UploadStep({
  onSelectDemo,
  onFileAccepted,
  isUploading,
  uploadProgress,
  uploadError,
  onRetry,
  onDismissError,
}: {
  onSelectDemo: (clip: DemoClip) => void;
  onFileAccepted: (file: File) => void;
  isUploading: boolean;
  uploadProgress: number;
  uploadError: string | null;
  onRetry: () => void;
  onDismissError: () => void;
}) {
  const [demoClips, setDemoClips] = useState<DemoClip[] | null>(null); // null = still loading manifest
  const [dragOver, setDragOver] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchDemoManifest().then(setDemoClips);
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setGateError(null);
      setValidating(true);
      const result = await validateUploadFile(file);
      setValidating(false);
      if (!result.ok) {
        setGateError(result.message ?? UPLOAD_GATE_MESSAGE);
        return;
      }
      onFileAccepted(file);
    },
    [onFileAccepted],
  );

  const hasDemoClips = demoClips !== null && demoClips.length > 0;
  const error = gateError ?? uploadError;

  return (
    <div className="flex flex-col gap-8">
      {demoClips === null && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-md bg-secondary animate-pulse" />
          ))}
        </div>
      )}

      {hasDemoClips && (
        <div>
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-3">Try a demo clip</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {demoClips!.map((clip) => (
              <button
                key={clip.id}
                type="button"
                onClick={() => onSelectDemo(clip)}
                className="group text-left rounded-md overflow-hidden border border-border bg-card hover:border-foreground/50 transition-colors"
              >
                <div className="aspect-video bg-secondary relative overflow-hidden">
                  <video src={clip.videoPath} className="w-full h-full object-cover" muted preload="metadata" />
                </div>
                <div className="p-3">
                  <div className="font-medium text-sm">{clip.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">Instant results — no wait</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        {hasDemoClips && (
          <h2 className="text-sm uppercase tracking-wide text-muted-foreground mb-3">Or upload your own</h2>
        )}
        <Card
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "border-dashed transition-colors",
            dragOver && "border-foreground bg-secondary/50",
            hasDemoClips ? "py-8" : "py-16",
          )}
        >
          <CardContent className="flex flex-col items-center justify-center text-center gap-3">
            {isUploading ? (
              <div className="w-full max-w-sm flex flex-col gap-3 items-center">
                <div className="text-sm text-muted-foreground">Uploading…</div>
                <Progress value={uploadProgress} className="w-full" />
                <div className="t-mono text-xs text-muted-foreground">{uploadProgress}%</div>
              </div>
            ) : (
              <>
                <div className="text-sm text-foreground">Drag and drop a tennis clip, or</div>
                <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={validating}>
                  {validating ? "Checking file…" : "Choose a file"}
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept="video/mp4,video/webm"
                  className="hidden"
                  onChange={(e) => handleFiles(e.target.files)}
                />
                <div className="text-xs text-muted-foreground">MP4 (H.264) or WebM · up to 30s · up to 60MB</div>
              </>
            )}
          </CardContent>
        </Card>
        {error && (
          <div className="mt-3 rounded-md border border-call-out/50 bg-call-out/10 px-3 py-2 text-sm text-call-out flex items-center justify-between gap-3">
            <span>{error}</span>
            <div className="flex gap-2 shrink-0">
              {uploadError && (
                <Button size="sm" variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setGateError(null);
                  onDismissError();
                }}
              >
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
