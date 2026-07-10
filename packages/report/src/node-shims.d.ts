/// <reference path="../../../types/node-shims.d.ts" />

declare module "node:fs" {
  export const constants: {
    O_WRONLY: number;
    O_CREAT: number;
    O_TRUNC: number;
    O_NOFOLLOW: number;
  };
}

declare module "node:fs/promises" {
  interface FileHandle {
    writeFile(data: string, encoding: BufferEncoding): Promise<void>;
    close(): Promise<void>;
  }

  interface Stats {
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }

  export function lstat(path: string): Promise<Stats>;
  export function open(path: string, flags: number, mode?: number): Promise<FileHandle>;
}

declare module "node:path" {
  export function parse(path: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  };
}
