type BufferEncoding = string;

declare const console: {
  error(...data: unknown[]): void;
  log(...data: unknown[]): void;
};

declare const process: {
  argv: string[];
  version: string;
  versions: {
    node: string;
  };
  cwd(): string;
  exitCode?: number;
  stderr: {
    write(chunk: string): void;
  };
  stdout: {
    write(chunk: string): void;
  };
};

declare module "node:child_process" {
  export interface ExecFileException extends Error {
    code?: number | string;
    killed?: boolean;
    signal?: string;
    stdout?: string;
    stderr?: string;
  }

  export function execFile(
    file: string,
    args: readonly string[],
    options: {
      cwd?: string;
      encoding?: BufferEncoding;
      maxBuffer?: number;
      timeout?: number;
    },
    callback: (error: ExecFileException | null, stdout: string, stderr: string) => void
  ): void;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: "hex"): string;
  }

  export function createHash(algorithm: string): Hash;
}

declare module "node:fs/promises" {
  export function appendFile(path: string, data: string, options?: BufferEncoding | { encoding?: BufferEncoding }): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function realpath(path: string): Promise<string>;
  export function writeFile(path: string, data: string, options?: BufferEncoding | { encoding?: BufferEncoding }): Promise<void>;
}

declare module "node:path" {
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
  export const sep: string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}
