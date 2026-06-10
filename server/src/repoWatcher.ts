import path from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import type { Response } from "express";

async function collectDirectories(rootPath: string): Promise<string[]> {
  const directories: string[] = [rootPath];
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git") {
      continue;
    }
    const absolutePath = path.join(rootPath, entry.name);
    directories.push(...(await collectDirectories(absolutePath)));
  }

  return directories;
}

export class RepoEventHub {
  private readonly clients = new Set<Response>();

  addClient(response: Response): void {
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();
    response.write(
      `event: connected\ndata: ${JSON.stringify({
        sentAt: new Date().toISOString()
      })}\n\n`
    );
    this.clients.add(response);
    response.on("close", () => {
      this.clients.delete(response);
    });
  }

  broadcast(eventName: string, payload: Record<string, unknown>): void {
    const message =
      `event: ${eventName}\n` +
      `data: ${JSON.stringify({
        ...payload,
        sentAt: new Date().toISOString()
      })}\n\n`;
    for (const client of this.clients) {
      client.write(message);
    }
  }
}

export class RepoWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private repoPath: string | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly onChange: (payload: {
      relativePath: string | null;
      eventType: string;
    }) => void
  ) {}

  async watchRepo(repoPath: string): Promise<void> {
    if (this.repoPath !== repoPath) {
      this.close();
    }
    this.repoPath = repoPath;

    const directories = await collectDirectories(repoPath).catch(() => []);
    const nextSet = new Set(directories);

    for (const [directory, watcher] of this.watchers) {
      if (!nextSet.has(directory)) {
        watcher.close();
        this.watchers.delete(directory);
      }
    }

    for (const directory of directories) {
      if (!this.watchers.has(directory)) {
        this.attachDirectoryWatcher(directory);
      }
    }
  }

  close(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = null;
    }
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    this.repoPath = null;
  }

  private attachDirectoryWatcher(directory: string): void {
    const watcher = watch(directory, { persistent: false }, (eventType, filename) => {
      const name = filename ? String(filename) : "";
      if (name === ".git") {
        return;
      }
      const relativeDirectory = this.repoPath
        ? path.relative(this.repoPath, directory).replace(/\\/g, "/")
        : "";
      const relativePath = [relativeDirectory, name]
        .filter(Boolean)
        .join("/")
        .replace(/^\/+/, "");
      this.scheduleBroadcast(relativePath || null, eventType);
    });

    watcher.on("error", () => {
      this.watchers.delete(directory);
    });

    this.watchers.set(directory, watcher);
  }

  private scheduleBroadcast(relativePath: string | null, eventType: string): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.onChange({
        relativePath,
        eventType
      });
    }, 160);

    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => {
      if (this.repoPath) {
        void this.watchRepo(this.repoPath);
      }
    }, 240);
  }
}
