import { NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { lambda, LAMBDA_FUNCTION_NAME } from "@/lib/aws";

// POST /api/warm — pre-demo warm-up trigger (Decisions #31-38, P3 cold-start
// mitigation). Sends {warm: true} to refai-detect; the Lambda handler
// special-cases that payload to return instantly without doing real work.
// Async invoke so this route returns immediately regardless of cold-start
// latency on the Lambda side.

export async function POST() {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ warm: true })),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { message: `Failed to warm Lambda: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "warming" }, { status: 202 });
}
