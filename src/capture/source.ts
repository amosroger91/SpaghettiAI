// A CaptureSource yields a single JPEG/PNG frame buffer on demand.
// Every camera kind implements this so the rest of the app is source-agnostic.
export interface CaptureSource {
  readonly kind: string;
  /** Grab one fresh frame as an image buffer (jpeg/png bytes). */
  grab(): Promise<Buffer>;
  /** Human-readable description for the dashboard. */
  describe(): string;
}
