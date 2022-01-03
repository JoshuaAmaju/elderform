import type { Interpreter } from 'xstate';
import { interpret } from 'xstate';
import { ActorStates, Context, Events, States } from '../src/machine';
import { EventTypes, machine } from '../src/machine';

export { retry, object } from './tools';

declare var __DEV__: boolean;

export type Handler<T> = {
  value?: T | null;
  state: ActorStates;
  set: (value: T) => void;
  setWithValidate: (value: T) => void;
};

type Generate<T, D, E> = (ctx: Context<T, D, E>) => {
  [K in keyof T]: Handler<T[K]>;
};

export type FormState =
  | 'idle'
  | 'validating'
  | 'submitting'
  | 'submitted'
  | 'error';

export type SubscriptionValue<T, D, E, Es> = {
  state: FormState;
  isIdle: boolean;
  isError: boolean;
  submitted: boolean;
  isSuccess: boolean;
  isValidating: boolean;
  isSubmitting: boolean;
  submittedWithError?: boolean;
  validatedWithErrors?: boolean;
  submittedWithoutError?: boolean;
} & Omit<
  Context<T, D, E, Es>,
  '__ignore' | '__validationMarker' | 'actors' | 'schema'
>;

type Service<T, D, E, Es> = {
  cancel: () => void;
  submit(...ignore: (keyof T)[]): void;
  subscribe: (
    fn: (
      val: SubscriptionValue<T, D, E, Es>,
      handlers: { [K in keyof T]: Handler<T[K]> }
    ) => void
  ) => () => void;
  __generate: Generate<T, D, E>;
  __service: Interpreter<
    Context<T, D, E, Es>,
    any,
    Events<T, D, E, Es>,
    States<T, D, E>
  >;
};

export type Config<T, D = any, E = Error, Es = Error> = {
  onSubmit: (value: T) => D | Promise<D>;
  schema?: Context<T, D, E, Es>['schema'];
  initialValues?: { [K in keyof T]?: T[K] };
};

export const createForm = <T, D = any, E = Error, Es = Error>({
  schema,
  onSubmit,
  initialValues,
}: Config<T, D, E, Es>): Service<T, D, E, Es> => {
  const def = machine<T, D, E, Es>();

  const service = interpret(
    def
      .withContext({
        ...def.context,
        schema,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        values: initialValues ?? {},
      })
      .withConfig({
        services: {
          submit: async ({ values }) => {
            const res = onSubmit(values as T);
            return res instanceof Promise ? await res : res;
          },
        },
      })
  ).start();

  const generate: Generate<T, D, E> = ({
    states,
    schema,
    values,
  }: Context<T, D, E>) => {
    if (!schema || typeof schema === 'boolean') {
      if (__DEV__) {
        console.warn('Cannot generate handlers without schema defined');
      }

      return;
    }

    const { shape } = schema;

    const entries = Object.keys(shape).map((id) => {
      const _id = id as keyof T;
      const state = states[_id];
      const value = values[_id];

      const handler: Handler<T[typeof _id]> = {
        state,
        value,
        set: (value) => {
          service.send({ id, value, type: EventTypes.Change });
        },
        setWithValidate: (value) => {
          service.send({
            id,
            value,
            type: EventTypes.ChangeWithValidate,
          });
        },
      };

      return [id, handler];
    });

    return Object.fromEntries(entries);
  };

  return {
    __service: service,
    __generate: generate,
    cancel: () => {
      service.send(EventTypes.Cancel);
    },
    submit: (...ignore) => {
      service.send({ ignore, type: EventTypes.Submit });
    },
    subscribe: (fn) => {
      const subscription = service.subscribe((_state) => {
        const { __ignore, __validationMarker, actors, schema, ...rest } =
          _state.context;

        const handlers = generate(_state.context);

        const isError = _state.matches('error');
        const submitted = _state.matches('submitted');
        const isSubmitting = _state.matches('submitting');
        const isValidating = _state.matches('validating');
        const isIdle = _state.matches('idle') || _state.matches('waitingInit');

        const submittedWithoutError = submitted && !rest.error;
        const submittedWithError = isError && !!rest.error;
        const validatedWithErrors =
          isIdle &&
          _state.history?.matches('validating') &&
          rest.errors.size > 0;

        const state: FormState = _state.matches('waitingInit')
          ? 'idle'
          : (_state.value as any);

        fn(
          {
            ...rest,

            // form states
            state,
            isIdle,
            isError,
            submitted,
            isValidating,
            isSubmitting,
            submittedWithError,
            validatedWithErrors,
            isSuccess: submitted,
            submittedWithoutError,
          },
          handlers
        );
      });

      return () => {
        subscription.unsubscribe();
      };
    },
  };
};
