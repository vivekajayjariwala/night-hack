import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { LambdaClient } from "@aws-sdk/client-lambda";

// Server-only AWS clients. Credentials come from the default provider chain
// (~/.aws/credentials via `aws configure`) — never hardcoded, never in env
// files. Region/bucket/function name are non-secret config from .env.local.

const region = process.env.AWS_REGION ?? "us-east-1";

export const s3 = new S3Client({ region });
export const lambda = new LambdaClient({ region });

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";
export const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_FUNCTION_NAME ?? "";
