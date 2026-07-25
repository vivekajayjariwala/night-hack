import { z } from "zod";

// Lambda output contract (PLAN.md Phase 3 §Architecture / Decision Q1).
// Python's detect.py must emit exactly this shape.

export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  cls: z.literal("person"),
  conf: z.number(),
});

export const BallDetectionSchema = z.object({
  x: z.number(),
  y: z.number(),
  conf: z.number(),
});

export const FrameSchema = z.object({
  t: z.number(), // seconds, from CAP_PROP_POS_MSEC — never frame_idx/fps (VFR drift, Decision Q2/F5)
  boxes: z.array(BoxSchema),
  ball: BallDetectionSchema.nullable(),
});

export const MetaSchema = z.object({
  detectionRate: z.number(),
  imgsz: z.number(),
  modelMs: z.number(),
  lowDetection: z.boolean().optional(), // set true when ball detected in <20% of frames
});

export const ResultsSchema = z.object({
  fps: z.number(),
  meta: MetaSchema,
  frames: z.array(FrameSchema),
});

export type Box = z.infer<typeof BoxSchema>;
export type BallDetection = z.infer<typeof BallDetectionSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type Meta = z.infer<typeof MetaSchema>;
export type Results = z.infer<typeof ResultsSchema>;

export interface ProgressJson {
  stage: string;
  framesDone: number;
  totalFrames: number;
}

export interface ErrorJson {
  message: string;
}

export interface Point {
  x: number;
  y: number;
}

/** Court corners in intrinsic pixel space, clicked TL -> TR -> BR -> BL (outer doubles corners). */
export type CourtCorners = [Point, Point, Point, Point];

export type LineCall = "IN" | "OUT" | "TOO_CLOSE";

export interface BounceEvent {
  t: number;
  type: "BOUNCE";
  call: LineCall;
  confidence: number;
  courtPos: Point; // meters, origin = TL doubles corner, x = width axis, y = length axis
  marginCm: number; // signed distance to nearest singles boundary; negative = outside
  screenPos: Point; // pixel position at the bounce apex, for canvas markers
}
