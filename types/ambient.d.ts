// Sandbox-only ambient shim used exclusively for offline tsc runs.
// This file is NOT shipped; real types come from @types/node, zod,
// @supabase/supabase-js, @vercel/node, pdf-lib and vitest at install time.

declare module 'vitest' {
  export const describe: any;
  export const it: any;
  export const test: any;
  export const expect: any;
  export const beforeAll: any;
  export const beforeEach: any;
  export const afterAll: any;
  export const afterEach: any;
  export const vi: any;
}
declare module 'vitest/globals' {}

declare module '@supabase/supabase-js' {
  export type SupabaseClient = any;
  export type User = any;
  export type Session = any;
  export type AuthError = any;
  export type PostgrestError = any;
  export function createClient(...args: any[]): any;
}

declare module '@vercel/node' {
  export interface VercelRequest {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
    query: Record<string, string | string[] | undefined>;
    body: any;
    url?: string;
    [k: string]: any;
  }
  export interface VercelResponse {
    status(code: number): VercelResponse;
    json(body: any): VercelResponse;
    send(body: any): VercelResponse;
    setHeader(name: string, value: string | number | readonly string[]): VercelResponse;
    end(body?: any): VercelResponse;
    [k: string]: any;
  }
}

declare module 'zod' {
  export interface ZodSafeParseSuccess<T = any> { success: true; data: T; }
  export interface ZodSafeParseFailure { success: false; error: ZodError; }
  export type ZodSafeParseResult<T = any> = ZodSafeParseSuccess<T> | ZodSafeParseFailure;
  export interface ZodTypeAny {
    safeParse(data: unknown): ZodSafeParseResult<any>;
    parse(data: unknown): any;
    optional(): ZodTypeAny;
    nullable(): ZodTypeAny;
    array(): ZodTypeAny;
    [k: string]: any;
  }
  export type ZodType<T = any, U = any, V = any> = ZodTypeAny;
  export type ZodSchema<T = any> = ZodTypeAny;
  export interface ZodError { issues: Array<{ path: (string|number)[]; message: string; code: string }>; [k: string]: any }
  export const z: any;
  export default z;
  export type infer<T> = any;
}
declare namespace z {
  type infer<T> = any;
  interface ZodType<T = any> { safeParse(data: unknown): { success: boolean; data?: T; error?: any }; [k: string]: any }
  interface ZodTypeAny { safeParse(data: unknown): { success: boolean; data?: any; error?: any }; [k: string]: any }
  type ZodSchema<T = any> = ZodTypeAny;
}

declare module 'pdf-lib' {
  // Declared as class so the identifier is simultaneously a value and a type,
  // mirroring real pdf-lib runtime ergonomics.
  export class PDFDocument {
    [k: string]: any;
    static create(...args: any[]): Promise<PDFDocument>;
    addPage(...args: any[]): any;
    embedFont(...args: any[]): any;
    save(...args: any[]): any;
    getPage(index: number): any;
    getPageCount(): number;
    registerFontkit(fontkit: any): void;
    setTitle(v: string): void;
    setCreator(v: string): void;
    setProducer(v: string): void;
    setAuthor(v: string): void;
    setSubject(v: string): void;
    setKeywords(v: string[]): void;
    setCreationDate(d: Date): void;
    setModificationDate(d: Date): void;
  }
  export const StandardFonts: any;
  export function rgb(r: number, g: number, b: number): any;
  export type PDFFont = any;
  export type PDFPage = any;
  export type PDFImage = any;
  export type RGB = any;
}

declare module '@pdf-lib/fontkit' {
  const fontkit: any;
  export default fontkit;
}

// Node built-in modules used by the backend (shimmed; real types come from @types/node)
declare module 'crypto' {
  const c: any;
  export default c;
  export const randomUUID: () => string;
  export const createHash: (algo: string) => any;
  export const createHmac: (algo: string, key: any) => any;
  export const timingSafeEqual: (a: any, b: any) => boolean;
}
declare module 'node:crypto' {
  export * from 'crypto';
}

// Node runtime stubs
declare namespace NodeJS {
  interface ProcessEnv { [k: string]: string | undefined }
  interface Process {
    env: ProcessEnv;
    uptime(): number;
    hrtime: any;
    memoryUsage: () => any;
    version: string;
    exit(code?: number): never;
  }
}
declare const process: NodeJS.Process;
declare const Buffer: any;
declare const console: any;
declare const setTimeout: (cb: (...a: any[]) => void, ms?: number) => any;
declare const clearTimeout: (id: any) => void;
declare const setInterval: (cb: (...a: any[]) => void, ms?: number) => any;
declare const clearInterval: (id: any) => void;
declare const crypto: any;
declare const AbortSignal: { timeout(ms: number): any };
declare const AbortController: any;
declare const URL: any;
declare const URLSearchParams: any;
declare const fetch: any;
declare const Response: any;
declare const Request: any;
declare const Headers: any;
declare const Buffer_: any;
