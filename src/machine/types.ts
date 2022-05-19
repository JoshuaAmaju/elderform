export type ActorState = 'idle' | 'validating' | 'error' | 'success';

export type FormState =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'submitted'
  | 'error';

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
