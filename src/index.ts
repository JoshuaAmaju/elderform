import { flow, pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import { identity, keys, map } from 'ramda';
import { from, Subscription } from 'rxjs';
import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import {
  ActorStates,
  Context,
  Events,
  EventTypes,
  machine,
  States,
} from '../src/machine';
import { Config } from './types';

export { TypeOf } from './types';
export { object } from './utils';
export { z };

type Handler<T> = {
  state: ActorStates;
  set: (value: T) => void;
  setWithValidate: (value: T) => void;
};

type Generate<T, D, E> = (ctx: Context<T, D, E>) => {
  [K in keyof T]: Handler<T[K]>;
};

type FormPartial<T, D, E> = {
  //   generate: Generate<T, D, E>;
  handlers: { [K in keyof T]: Handler<T[K]> };
};

type FormState =
  | 'idle'
  | 'validating'
  | 'validatedWithErrors'
  | 'submitting'
  | 'submitted'
  | 'submittedWithError'
  | 'error';

type SubscriptionValue<T, D, E> = FormPartial<T, D, E> & {
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

type Form<T, D, E> = FormPartial<T, D, E> & {
  submit(): void;
  state: FormState;
  subscribe: (fn: (val: SubscriptionValue<T, D, E>) => void) => Subscription;
  __generate: Generate<T, D, E>;
  __service: Interpreter<
    Context<T, D, E>,
    any,
    Events<T, D, E>,
    States<T, D, E>
  >;
};

const create = <T, D, E>({
  schema,
  onSubmit,
  initialValues,
}: Config<T, D>): Form<T, D, E> => {
  const def = machine<T, D, E>();

  const __service = interpret(
    def
      .withContext({
        ...def.context,
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

  const $service = from(__service);

  const { initialState } = __service;

  const ctx = initialState.context;

  const generate: Form<T, D, E>['__generate'] = ({
    states,
    schema,
  }: Context<T, D, E>) => {
    const entries = pipe(
      schema,
      O.fromNullable,
      O.map(
        flow(
          keys,
          map((id) => {
            const _id = id as keyof T;
            const state = states[_id];

            const handler: Handler<T[typeof _id]> = {
              state,
              set: (value) => {
                __service.send({ id, value, type: EventTypes.CHANGE });
              },
              setWithValidate: (value) => {
                __service.send({
                  id,
                  value,
                  type: EventTypes.CHANGE_WITH_VALIDATE,
                });
              },
            };

            return [id, handler];
          })
        )
      ),
      O.fold(() => [], identity)
    );

    return Object.fromEntries(entries);
  };

  return {
    __service,
    __generate: generate,
    state: 'idle',
    handlers: generate(ctx),
    submit: () => __service.send(EventTypes.SUBMIT),
    subscribe: (fn) => {
      return $service.subscribe((_state) => {
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

        fn({
          data,
          error,
          state,
          errors,
          values,
          handlers,

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
        });
      });
    },
  };
};

export default create;
