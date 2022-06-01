import type { Interpreter, State } from 'xstate';
import { interpret } from 'xstate';
import { machine } from './machine';
import type { Ctx, Events, States } from './machine';
import type {
  Validator,
  FormState,
  Submitter,
  ActorState,
} from './machine/types';

export * from './tools';
export * from './machine';
export * as actor from './machine/actor';
export { Validator, FormState, ActorState, Submitter };

export type Values<T extends object, D, E, Es> = {
  state: FormState;
} & Pick<
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
  cancel: () => void;
  kill: (id: string) => void;
  submitAsync: () => Promise<D>;
  set: <N extends keyof T>(name: N, value: T[N]) => void;
  validate: <N extends keyof T>(name: N, value?: T[N]) => void;
  spawn: (id: string, value: unknown | null, validator: Validator) => void;
};

export type Extra<T extends object, D, E, FE> = {
  __service: Interpreter<Ctx<T, D, E, FE>, any, Events, States>;
  subscribe: (subscriber: (state: Values<T, D, E, FE>) => void) => void;
};

export type Config<T extends object, D, TErrors extends object> = {
  onSubmit: (value: T) => D | Promise<D>;
  initialValues?: { [K in keyof T]?: T[K] };
  initialErrors?: { [K in keyof TErrors]?: TErrors[K] };
};

export const create = <
  ValuesType extends object = any,
  DataType = any,
  ErrorType = any,
  ErrorsType extends object = any,
  TData = DataType
>({
  onSubmit,
  initialValues,
  initialErrors,
}: Config<ValuesType, DataType, ErrorsType>): Actions<ValuesType, TData> &
  Extra<ValuesType, TData, ErrorType, ErrorsType> => {
  const service = interpret(
    machine<ValuesType, ErrorsType>({
      initialValues,
      initialErrors,
      onSubmit,
    } as any)
  ).start();

  const reset: Actions['reset'] = () => {
    service.send('reset');
  };

  const submit: Actions['submit'] = () => {
    service.send('submit');
  };

  const cancel: Actions['cancel'] = () => {
    service.send('cancel');
  };

  const kill: Actions['kill'] = (id) => {
    service.send({ id, type: 'kill' });
  };

  const spawn: Actions['spawn'] = (id, value, validator) => {
    service.send({ id, value, validator, type: 'spawn' });
  };

  const set: Actions<ValuesType>['set'] = (id, value) => {
    service.send({ id: id as string, value, type: 'set' });
  };

  const validate: Actions<ValuesType>['validate'] = (id, value) => {
    service.send({ value, id: id as string, type: 'validate' });
  };

  const submitAsync: Actions['submitAsync'] = () => {
    return new Promise((resolve, reject) => {
      const onTransition = (
        s: State<Ctx<ValuesType, any, any, any>, Events, any, States>
      ) => {
        if (s.matches('submitted')) {
          resolve(s.context.data);
          service.off(onTransition);
        }

        if (s.matches('error')) {
          reject(s.context.error);
          service.off(onTransition);
        }

        if (s.event.type === 'cancel') {
          const err = new Error('Form submission was cancelled at: ' + s.value);
          err.name = 'CancelError';
          reject(err);
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
    cancel,
    validate,
    submitAsync,
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
