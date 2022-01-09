export type Schema<T = any> = {
  [K in keyof T]: Schema<T[K]> | Validator<T, T[K]>;
};

export type FlattenKeys<T extends object> = {
  [K in keyof T & (string | number)]: RecursiveKeyOfHandleValue<T[K], `${K}`>;
}[keyof T & (string | number)];

type RecursiveKeyOfInner<T extends object> = {
  [K in keyof T & (string | number)]: RecursiveKeyOfHandleValue<T[K], `.${K}`>;
}[keyof T & (string | number)];

type RecursiveKeyOfHandleValue<
  TValue,
  Text extends string
> = TValue extends any[]
  ? Text
  : TValue extends object
  ? Text | `${Text}${RecursiveKeyOfInner<TValue>}`
  : Text;

export type Validator<SchemaType = any, T = any> = (
  value: T,
  values: SchemaType
) => T | Promise<T>;

export type Infer<T> = T extends Schema<infer R>
  ? {
      [K in keyof R]: R[K] extends Validator<R, R[K]>
        ? ReturnType<R[K]> extends Promise<infer N>
          ? N
          : ReturnType<R[K]>
        : R[K];
    }
  : never;
