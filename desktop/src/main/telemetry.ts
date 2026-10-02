import { Backend } from './backend';

export type DesktopEventType =
  | 'DESKTOP_STARTED' | 'DESKTOP_FOCUS_LOST' | 'DESKTOP_FOCUS_GAINED' | 'DESKTOP_TAB_CHANGED' | 'DESKTOP_CLOSED';

interface QueuedEvent { type: DesktopEventType; timestamp: string; payload: Record<string, unknown> }

/** Cola en memoria de eventos DESKTOP_* -> /desktop-events cada `flushSec` y en el cierre; si falla, reintenta. */
export class DesktopTelemetry {
  private queue: QueuedEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private target: { sessionId: number; token: string } | null = null;
  private flushing = false;

  constructor(private readonly backend: Backend, private readonly flushSec: number) {}

  start(sessionId: number, token: string): void {
    this.target = { sessionId, token };
    this.timer ??= setInterval(() => void this.flush(), this.flushSec * 1000);
  }

  emit(type: DesktopEventType, payload: Record<string, unknown> = {}): void {
    if (!this.target) return;
    this.queue.push({ type, timestamp: new Date().toISOString(), payload });
  }

  async flush(): Promise<boolean> {
    if (!this.target || this.queue.length === 0) return true;
    if (this.flushing) return false;
    this.flushing = true;
    const batch = this.queue;
    this.queue = [];
    try {
      await this.backend.desktopEvents(this.target.sessionId, this.target.token, batch);
      return true;
    } catch {
      this.queue = batch.concat(this.queue);
      return false;
    } finally {
      this.flushing = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.target = null;
  }
}
