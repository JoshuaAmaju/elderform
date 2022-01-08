export type Schema<T = any> = {
  [K in keyof T]: Schema<T[K]> | Validator<T, T[K]>;
};

export type FlattenedSchema<T extends Schema = any> = {
  [K in keyof T]: T[K] extends Schema<infer R> ? Schema<R> : T[K];
};

type Dotify<A, B> = `${string & A}.${string & B}`;

export type RecursiveKeyOf<T extends object> = {
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

type N = {
  name: string;
  company: {
    address: {
      age: string;
    };
  };
  age: string;
};

const n = {
  name: () => '',
  company: {
    address: {
      age: () => '',
    },
  },
  age: () => '',
};

type M = Infer<typeof n>;

type O<T extends object> = {
  [K in
    | keyof T
    | Dotify<keyof T, { [P in keyof T[keyof T]]: any }>]: K extends keyof T
    ? T[K]
    : T[keyof T];
};

type Y = O<typeof n>;

// let u: Y = ['name'];

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
