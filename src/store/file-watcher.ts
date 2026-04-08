import chokidar from 'chokidar';
import path from 'node:path';

// FileWatcher wraps chokidar with 200ms debounce to avoid redundant rebuilds
// when editors write files in multiple steps (e.g. tmp rename pattern).
export class FileWatcher {
  private watcher: ReturnType<typeof chokidar.watch> | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private tasksDir: string,
    private onChange: (filePath: string) => void,
    private onDelete: (filePath: string) => void,
    private onAdd: (filePath: string) => void,
  ) {}

  start(): void {
    const pattern = path.join(this.tasksDir, '**', '*.md');

    this.watcher = chokidar.watch(pattern, {
      ignoreInitial: true,
      persistent: true,
    });

    const debounce = (key: string, fn: () => void): void => {
      const existing = this.debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      this.debounceTimers.set(
        key,
        setTimeout(() => {
          this.debounceTimers.delete(key);
          fn();
        }, 200),
      );
    };

    this.watcher
      .on('change', (filePath: string) => {
        debounce(`change:${filePath}`, () => this.onChange(filePath));
      })
      .on('unlink', (filePath: string) => {
        debounce(`unlink:${filePath}`, () => this.onDelete(filePath));
      })
      .on('add', (filePath: string) => {
        debounce(`add:${filePath}`, () => this.onAdd(filePath));
      });
  }

  stop(): void {
    // Clear all pending debounce timers before closing
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }
}
