import { ZodType } from 'zod';

export type Schema<T = any> = { [K in keyof T]: ZodType<T[K]> };

export type TypeOf<T> = T extends Schema<infer R> ? R : never;
