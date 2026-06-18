// Abstraction so we can swap Ollama for another backend (e.g. a cloud model for
// escalation) without touching the analysis code.
export interface VisionRequest {
  system?: string;
  prompt: string;
  /** base64 image(s), no data: prefix. */
  images: string[];
  /** JSON schema; when set the provider must return valid JSON matching it. */
  schema?: Record<string, unknown>;
  temperature?: number;
}

export interface VisionProvider {
  readonly name: string;
  /** Free-form text completion over image(s). */
  complete(req: VisionRequest): Promise<string>;
  /** Structured completion: returns parsed JSON validated against req.schema. */
  json<T>(req: VisionRequest & { schema: Record<string, unknown> }): Promise<T>;
  /** Cheap reachability/health check. */
  health(): Promise<{ ok: boolean; detail: string }>;
}
