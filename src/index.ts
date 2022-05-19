import type { Interpreter } from 'xstate';
import { interpret, State } from 'xstate';
import { config } from './machine';
import type { Ctx, Events, States } from './machine';
import type { Validator, FormState } from './machine/types';

import * as types from './machine/types';
import * as actor from './machine/actor';

export type { types };
export * from './tools';
export * from './machine';
export { actor };

export type SubscriptionValue<T extends object, D, E, Es> = Pick<
  Ctx<T, D, E, Es>,
  | 'data'
  | 'error'
  | 'values'
  | 'states'
  | 'errors'
  | 'failureCount'
  | 'dataUpdatedAt'
  | 'errorUpdatedAt'
> &
  Record<
    'isIdle' | 'isValidating' | 'isSubmitting' | 'submitted' | 'isError',
    boolean
  >;

export type Actions<T = any, D = any> = {
  reset: () => void;
  submit: () => void;
  cancelSubmit: () => void;
  kill: (id: string) => void;
  submitAsync: () => Promise<D>;
  // clearError: (id: string) => void;
  set: <N extends keyof T>(name: N, value: T[N]) => void;
  validate: <N extends keyof T>(name: N, value?: T[N]) => void;
  spawn: (id: string, value: unknown | null, validator: Validator) => void;
};

export type Config<T extends object, D> = {
  onSubmit: (value: T) => D | Promise<D>;
  initialValues?: { [K in keyof T]?: T[K] };
};

export const createForm = <
  T extends object = any,
  D = any,
  E = any,
  FE = any,
  TData = D
>({
  onSubmit,
  initialValues,
}: Config<T, D>): Actions<T, TData> & {
  __service: Interpreter<Ctx<T, D, E, FE>, any, Events, States>;
  subscribe: (
    subscriber: (state: SubscriptionValue<T, D, E, FE>) => void
  ) => void;
} => {
  const service = interpret(config<T>(initialValues as T, onSubmit));

  const reset: Actions['reset'] = () => {
    service.send('reset');
  };

  const submit: Actions['submit'] = () => {
    service.send('submit');
  };

  // const clearError: Actions['clearError'] = (id) => {
  //   service.send({ id, type: 'clear_error' });
  // };

  const cancelSubmit: Actions['cancelSubmit'] = () => {
    service.send('cancel');
  };

  const kill: Actions['kill'] = (id) => {
    service.send({ id, type: 'kill' });
  };

  const spawn: Actions['spawn'] = (id, value, validator) => {
    service.send({ id, value, validator, type: 'spawn' });
  };

  const set: Actions<T>['set'] = (id, value) => {
    service.send({ id: id as string, value, type: 'set' });
  };

  const validate: Actions<T>['validate'] = (id, value) => {
    service.send({ value, id: id as string, type: 'validate' });
  };

  const submitAsync: Actions['submitAsync'] = () => {
    return new Promise((resolve, reject) => {
      const onTransition = (
        s: State<Ctx<T, any, any, any>, Events, any, States>
      ) => {
        if (s.matches('submitted')) {
          resolve(s.context.data);
          service.off(onTransition);
        }

        if (s.matches('error')) {
          reject(s.context.error);
          service.off(onTransition);
        }
      };

      service.onTransition(onTransition);

      service.send('submit');
    });
  };

  return {
    set,
    kill,
    spawn,
    reset,
    submit,
    validate,
    // clearError,
    submitAsync,
    cancelSubmit,
    __service: service,
    subscribe: (subscriber) => {
      const subscription = service.subscribe((s) => {
        const {
          data,
          error,
          states,
          errors,
          actors,
          values,
          failureCount,
          dataUpdatedAt,
          errorUpdatedAt,
        } = s.context;

        const state = s.value as FormState;

        const isIdle = state === 'idle';
        const isError = state === 'error';
        const submitted = state === 'submitted';
        const isValidating = state === 'validating';
        const isSubmitting = state === 'submitting';

        const value = {
          state,

          data,
          error,

          values,
          states,
          errors,

          failureCount,
          dataUpdatedAt,
          errorUpdatedAt,

          actors,

          isIdle,
          isError,
          submitted,
          isValidating,
          isSubmitting,
          isSuccess: submitted,
        };

        subscriber(value);
      });

      return () => {
        subscription.unsubscribe();
      };
    },
  };
};
