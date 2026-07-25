// Client-side upload gate (PLAN.md Decision C5 / #11). Checked before any
// upload starts — MP4(H.264)/WebM only, <=30s, <=60MB. Presigned PUT cannot
// enforce content-length server-side (F9), so this is the only real gate;
// accepted per F8's spend cap.

export const MAX_DURATION_S = 30;
export const MAX_SIZE_BYTES = 60 * 1024 * 1024;
export const ACCEPTED_CONTENT_TYPES = ["video/mp4", "video/webm"] as const;
export const UPLOAD_GATE_MESSAGE = "Please upload an MP4 (H.264) or WebM, ≤30s, ≤60MB";

export interface UploadGateResult {
  ok: boolean;
  message?: string;
  duration?: number;
}

/**
 * Validates type/size synchronously, then probes duration by loading video
 * metadata in a detached <video> element. A file that can't produce
 * metadata (e.g. an HEVC .mov the browser can't decode) fails the same way
 * as an over-duration clip — both are rejected with the same message,
 * since from the user's perspective the fix is the same ("re-export as
 * MP4/H.264 or WebM").
 */
export async function validateUploadFile(file: File): Promise<UploadGateResult> {
  if (!ACCEPTED_CONTENT_TYPES.includes(file.type as (typeof ACCEPTED_CONTENT_TYPES)[number])) {
    return { ok: false, message: UPLOAD_GATE_MESSAGE };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { ok: false, message: UPLOAD_GATE_MESSAGE };
  }

  const duration = await probeVideoDuration(file).catch(() => null);
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, message: UPLOAD_GATE_MESSAGE };
  }
  if (duration > MAX_DURATION_S) {
    return { ok: false, message: UPLOAD_GATE_MESSAGE };
  }

  return { ok: true, duration };
}

function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };

    video.onloadedmetadata = () => {
      const d = video.duration;
      cleanup();
      resolve(d);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("Could not decode video metadata"));
    };

    video.src = url;
  });
}
