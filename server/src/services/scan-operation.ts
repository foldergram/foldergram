import { randomUUID } from 'node:crypto';

export type ScanControl = 'pause' | 'resume' | 'cancel';
export type ScanOperationState = 'queued' | 'running' | 'pausing' | 'paused' | 'cancelling' | 'completed' | 'cancelled' | 'failed';

export class ScanCancelledError extends Error {}

export class ScanControlError extends Error {
  readonly status = 409;
}

export class LocalScanOperation {
  readonly id = randomUUID();
  readonly startedAt = new Date().toISOString();
  state: ScanOperationState = 'queued';
  controllable = false;
  private activeTasks = 0;
  private resumeSignal: Promise<void> | null = null;
  private releaseTasks: (() => void) | null = null;

  constructor(readonly reason: string, private readonly onPause: () => void, private readonly onRelease: () => void) {}

  get controls(): ScanControl[] {
    if (!this.controllable) return [];
    if (this.state === 'running') return ['pause', 'cancel'];
    if (this.state === 'pausing' || this.state === 'paused') return ['resume', 'cancel'];
    return [];
  }

  get snapshot() {
    return { id: this.id, state: this.state, controls: this.controls };
  }

  control(action: ScanControl): void {
    if (action === 'pause' && (this.state === 'pausing' || this.state === 'paused')) return;
    if (action === 'cancel' && (this.state === 'cancelling' || this.state === 'cancelled')) return;
    if (action === 'resume' && this.controllable && this.state === 'running') return;
    if (!this.controls.includes(action)) throw new ScanControlError('This scan operation no longer supports that action.');

    switch (action) {
      case 'pause':
        this.resumeSignal = new Promise<void>(resolve => { this.releaseTasks = resolve; });
        this.state = 'pausing';
        this.onPause();
        break;
      case 'resume':
        this.state = 'running';
        this.release();
        break;
      case 'cancel':
        this.state = 'cancelling';
        this.releaseTasks?.();
        break;
    }
  }

  private release(): void {
    this.resumeSignal = null;
    this.releaseTasks?.();
    this.releaseTasks = null;
    this.onRelease();
  }

  finish(state: 'completed' | 'cancelled' | 'failed'): void {
    this.state = state;
    this.controllable = false;
    this.release();
  }

  async checkpoint(): Promise<void> {
    while (this.resumeSignal && this.state !== 'cancelling') {
      this.reportPausedIfDrained();
      await this.resumeSignal;
    }
    if (this.state === 'cancelling') throw new ScanCancelledError();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    // Admission and accounting are synchronous once a worker may start.
    while (this.state !== 'running') await this.checkpoint();
    this.activeTasks += 1;
    try {
      return await task();
    } finally {
      this.activeTasks -= 1;
      this.reportPausedIfDrained();
    }
  }

  async sealControls(): Promise<void> {
    while (this.state !== 'running') await this.checkpoint();
    this.controllable = false;
  }

  private reportPausedIfDrained(): void {
    if (this.state === 'pausing' && this.activeTasks === 0) this.state = 'paused';
  }
}
