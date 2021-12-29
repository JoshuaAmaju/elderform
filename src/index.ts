import type { Interpreter, State } from 'xstate';
import { interpret } from 'xstate';
import type { ActorStates, Context, Events, States } from '../src/machine';
import { EventTypes, machine } from '../src/machine';

type Handler<T> = {
  value?: T | null;
  state: ActorStates;
  set: (value: T) => void;
  setWithValidate: (value: T) => void;
};

type Generate<T, D, E> = (ctx: Context<T, D, E>) => {
  [K in keyof T]: Handler<T[K]>;
};

type FormState =
  | 'idle'
  | 'validating'
  | 'validatedWithErrors'
  | 'submitting'
  | 'submitted'
  | 'submittedWithError'
  | 'error';

type SubscriptionValue<T, D, E> = {
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
} & Pick<
  Context<T, D, E>,
  'data' | 'error' | 'errors' | 'values' | 'dataUpdatedAt' | 'errorUpdatedAt'
>;

type Form<T, D, E> = {
  submit(): void;
  state: FormState;
  subscribe: (
    fn: (
      val: SubscriptionValue<T, D, E>,
      handlers: { [K in keyof T]: Handler<T[K]> }
    ) => void
  ) => () => void;
  __generate: Generate<T, D, E>;
  __service: Interpreter<
    Context<T, D, E>,
    any,
    Events<T, D, E>,
    States<T, D, E>
  >;
};

export type Config<T, D = any, E = Error> = {
  onSubmit: (value: T) => Promise<D>;
  schema?: Context<T, D, E>['schema'];
  initialValues?: { [K in keyof T]?: T[K] };
};

const create = <T, D = any, E = Error>({
  schema,
  onSubmit,
  initialValues,
}: Config<T, D, E>): Form<T, D, E> => {
  const def = machine<T, D, E>();

  const service = interpret(
    def
      .withContext({
        ...def.context, // doesn't really do anything, just to appease typescript
        schema,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        errors: new Map(),
        values: initialValues ?? {},
        __validationMarker: new Set(),
      })
      .withConfig({
        services: {
          submit: ({ values }) => onSubmit(values as T),
        },
      })
  ).start();

  const { initialState } = service;

  const state: FormState = initialState.matches('waitingInit')
    ? 'idle'
    : (initialState.value as any);

  const generate: Generate<T, D, E> = ({
    states,
    schema,
    values,
  }: Context<T, D, E>) => {
    if (!schema || typeof schema === 'boolean') return;

    const { shape } = schema;

    const entries = Object.keys(shape).map((id) => {
      const _id = id as keyof T;
      const state = states[_id];
      const value = values[_id];

      const handler: Handler<T[typeof _id]> = {
        state,
        value,
        set: (value) => {
          service.send({ id, value, type: EventTypes.CHANGE });
        },
        setWithValidate: (value) => {
          service.send({
            id,
            value,
            type: EventTypes.CHANGE_WITH_VALIDATE,
          });
        },
      };

      return [id, handler];
    });

    return Object.fromEntries(entries);
  };

  return {
    state,
    __service: service,
    __generate: generate,
    submit: () => service.send(EventTypes.SUBMIT),
    subscribe: (fn) => {
      const listener: (
        s: State<Context<T, D, E>, Events<T, D, E>, any, States<T, D, E>>,
        e: Events<T, D, E>
      ) => void = (_state) => {
        const { data, error, errors, values, dataUpdatedAt, errorUpdatedAt } =
          _state.context;

        const handlers = generate(_state.context);

        const isError = _state.matches('error');
        const submitted = _state.matches('submitted');
        const isSubmitting = _state.matches('submitting');
        const isValidating = _state.matches('validating');
        const isIdle = _state.matches('idle') || _state.matches('waitingInit');

        const submittedWithoutError = submitted && !error;
        const submittedWithError = isError && !!error;
        const validatedWithErrors =
          isIdle && _state.history?.matches('validating') && errors.size > 0;

        const state: FormState = _state.matches('waitingInit')
          ? 'idle'
          : validatedWithErrors
          ? 'validatedWithErrors'
          : _state.matches('error')
          ? 'submittedWithError'
          : (_state.value as FormState);

        fn(
          {
            data,
            error,
            state,
            errors,
            values,

            dataUpdatedAt,
            errorUpdatedAt,

            // form states
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
      };

      service.onTransition(listener);

      return () => {
        service.off(listener);
      };
    },
  };
};

export default create;
