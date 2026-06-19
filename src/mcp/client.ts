// Thin HTTP client the MCP tools use to talk to a running print-watch server.
// Going through the HTTP API (rather than calling the analysis code directly)
// means the MCP server shares the same camera queueing, history, and alerts as
// the dashboard — one source of truth, no camera contention.

export class PrintWatchClient {
  constructor(private base: string) {
    this.base = base.replace(/\/$/, "");
  }

  private url(path: string, camera?: string): string {
    const u = new URL(this.base + path);
    if (camera) u.searchParams.set("camera", camera);
    return u.toString();
  }

  async get<T = unknown>(path: string, camera?: string): Promise<T> {
    const res = await fetch(this.url(path, camera), { signal: AbortSignal.timeout(180_000) });
    return this.parse<T>(res);
  }

  async post<T = unknown>(path: string, camera?: string, body?: unknown): Promise<T> {
    const res = await fetch(this.url(path, camera), {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(180_000),
    });
    return this.parse<T>(res);
  }

  /** Fetch the live preview frame as base64 JPEG for an MCP image content block. */
  async snapshot(camera?: string): Promise<string> {
    const res = await fetch(this.url("/api/snapshot", camera), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`snapshot failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || (data as { error?: string })?.error) {
      throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
    }
    return data as T;
  }

  /** Quick reachability probe with a friendlier error than a deep call. */
  async ping(): Promise<void> {
    try {
      await this.get("/api/status");
    } catch (e) {
      throw new Error(`cannot reach SpaghettiAI at ${this.base} — is it running? (${(e as Error).message})`);
    }
  }
}
