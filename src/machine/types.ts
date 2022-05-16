export type ActorState = 'idle' | 'validating' | 'error' | 'success';

export type FormState =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'submitted'
  | 'error';

export type Schema<T = any> = {
  [K in keyof T]: Schema<T[K]> | Validator<T, T[K]>;
};

export type FlattenedSchema<T = any> = {
  [K in keyof T]: Validator<T, T[K]>;
};

// export type Infer<T> = T extends Schema<infer R>
//   ? {
//       [K in keyof R]: T[K] extends Array<infer U>
//         ? Infer<U>[]
//         : R[K] extends Validator<R, R[K]>
//         ? ReturnType<R[K]> extends Promise<infer N>
//           ? N
//           : ReturnType<R[K]>
//         : R[K];
//     }
//   : never;

export type SyncValidator<V = any, Vs = any> = (value: V, values: Vs) => V;

export type AsyncValidator<V = any, Vs = any> = (
  value: V,
  values: Vs
) => Promise<V>;

export type Validator<V = any, Vs = any> =
  | SyncValidator<V, Vs>
  | AsyncValidator<V, Vs>;

export type SyncSubmitter<T = any> = (values: T) => unknown;
export type AsyncSubmitter<T = any> = (values: T) => Promise<unknown>;
export type Submitter<T = any> = SyncSubmitter<T> | AsyncSubmitter<T>;
