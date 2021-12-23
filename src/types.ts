import { ZodRawShape, ZodType } from 'zod';

export type Schema<T extends ZodRawShape> = { [K in keyof T]: ZodType<T[K]> };

export type Config<T extends ZodRawShape, D = any> = {
  schema: Schema<T>;
  onSubmit: (value: T) => Promise<D>;
  initialValues: { [K in keyof T]: T[K] };
};
