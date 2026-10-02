import { app } from 'electron';
import { SessionInfo } from './validate';

export class BackendError extends Error {
  constructor(public readonly status: number, message: string, public readonly minVersion?: string) {
    super(message);
  }
}

export interface Student { id: number; name: string; email: string }
export interface Exam { id: number; title: string; description: string }

export class Backend {
  constructor(private readonly baseUrl: string) {}

  private async call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const headers: Record<string, string> = {
      'X-Desktop-Version': app.getVersion(),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { ...init, headers, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new BackendError(0, (e as Error).message);
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* no JSON */ }
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; minVersion?: string };
      throw new BackendError(res.status, b.error ?? `HTTP ${res.status}`, b.minVersion);
    }
    return body as T;
  }

  students(): Promise<Student[]> { return this.call('/api/students'); }
  exams(): Promise<Exam[]> { return this.call('/api/exams'); }
  createSession(studentId: number, examId: number): Promise<SessionInfo> {
    return this.call('/api/sessions', { method: 'POST', body: JSON.stringify({ studentId, examId }) });
  }
  status(sessionId: number, token: string): Promise<SessionInfo & { status: string }> {
    return this.call(`/api/sessions/${sessionId}/status`, { token });
  }
  desktopEvents(sessionId: number, token: string, events: unknown[]): Promise<unknown> {
    return this.call(`/api/sessions/${sessionId}/desktop-events`, { method: 'POST', token, body: JSON.stringify({ events }) });
  }
}
