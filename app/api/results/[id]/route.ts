import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "@/lib/aws";
import { ResultsSchema } from "@/lib/types";
import { isValidJobId } from "@/lib/id";

// GET /api/results/[id] — Decision #32/F3. Server-side S3 GetObject (never
// presigned GET — a missing key 403s, not 404s, which is indistinguishable
// from "broken" on a presigned URL). Checks in order:
//   results/{id}/error.json   -> 500 + {message}
//   results/{id}/results.json -> 200 + zod-validated Results
//   results/{id}/progress.json -> 202 + progress
//   nothing yet (NoSuchKey)   -> 202 + default "queued" progress
// NoSuchKey is caught specifically and treated as "not ready yet", not an
// error — that's the expected state for most of a poll's lifetime.

const DEFAULT_PROGRESS = { stage: "queued", framesDone: 0, totalFrames: 0 };

function isNoSuchKey(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.Code === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

async function getObjectText(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const text = await res.Body?.transformToString();
    return text ?? null;
  } catch (err) {
    if (isNoSuchKey(err)) return null;
    throw err;
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ message: "id must be a valid UUID" }, { status: 400 });
  }

  try {
    const errorText = await getObjectText(`results/${id}/error.json`);
    if (errorText !== null) {
      let message = "Analysis failed";
      try {
        const parsed = JSON.parse(errorText);
        if (parsed && typeof parsed.message === "string") message = parsed.message;
      } catch {
        // malformed error.json — fall back to the generic message
      }
      return NextResponse.json({ message }, { status: 500 });
    }

    const resultsText = await getObjectText(`results/${id}/results.json`);
    if (resultsText !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(resultsText);
      } catch {
        return NextResponse.json({ message: "Malformed results JSON" }, { status: 500 });
      }
      const validated = ResultsSchema.safeParse(parsed);
      if (!validated.success) {
        return NextResponse.json(
          { message: "Results did not match the expected schema" },
          { status: 500 },
        );
      }
      return NextResponse.json(validated.data, { status: 200 });
    }

    const progressText = await getObjectText(`results/${id}/progress.json`);
    if (progressText !== null) {
      try {
        const progress = JSON.parse(progressText);
        return NextResponse.json(progress, { status: 202 });
      } catch {
        return NextResponse.json(DEFAULT_PROGRESS, { status: 202 });
      }
    }

    return NextResponse.json(DEFAULT_PROGRESS, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { message: `Failed to read results: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
