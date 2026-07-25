import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, S3_BUCKET } from "@/lib/aws";
import { ACCEPTED_CONTENT_TYPES } from "@/lib/upload-gate";

// POST /api/presign — Decision #31-38 / #33. Body: {filename, contentType}.
// Generates a server-side UUID jobId, returns a 5-minute presigned PUT URL
// for uploads/{jobId}.mp4, content-type constrained.

const PRESIGN_EXPIRY_S = 300;

export async function POST(request: Request) {
  let body: { filename?: unknown; contentType?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const { filename, contentType } = body;
  if (typeof filename !== "string" || filename.length === 0) {
    return NextResponse.json({ message: "filename is required" }, { status: 400 });
  }
  if (
    typeof contentType !== "string" ||
    !ACCEPTED_CONTENT_TYPES.includes(contentType as (typeof ACCEPTED_CONTENT_TYPES)[number])
  ) {
    return NextResponse.json(
      { message: "contentType must be video/mp4 or video/webm" },
      { status: 400 },
    );
  }

  const jobId = randomUUID();
  const key = `uploads/${jobId}.mp4`;

  try {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY_S });
    return NextResponse.json({ jobId, url });
  } catch (err) {
    return NextResponse.json(
      { message: `Failed to presign upload: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
