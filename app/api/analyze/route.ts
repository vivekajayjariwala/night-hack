import { NextResponse } from "next/server";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { lambda, LAMBDA_FUNCTION_NAME } from "@/lib/aws";
import { isValidJobId } from "@/lib/id";

// POST /api/analyze — Decision #31/F1/F2. Body: {jobId}. Invokes refai-detect
// async (InvocationType: 'Event', MaximumRetryAttempts=0 set at the Lambda
// event-source-mapping/function level — silent retries would corrupt poll
// state and 3x cost) and returns immediately (202). The Lambda function
// itself does not exist yet in this environment; a failed invoke here is an
// expected, known gap until it's deployed, not a bug in this route.

export async function POST(request: Request) {
  let body: { jobId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON body" }, { status: 400 });
  }

  const { jobId } = body;
  if (typeof jobId !== "string" || !isValidJobId(jobId)) {
    return NextResponse.json({ message: "jobId must be a valid UUID" }, { status: 400 });
  }

  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: LAMBDA_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ jobId })),
      }),
    );
  } catch (err) {
    return NextResponse.json(
      { message: `Failed to invoke inference: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ jobId, status: "invoked" }, { status: 202 });
}
