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

type SubscriptionValue<T, D, E> = FormPartial<T, D, E> &
  Pick<Context<T, D, E>, 'data' | 'error' | 'errors' | 'values'>;

type Form<T, D, E> = FormPartial<T, D, E> & {
  //   service: () => Observable<
  //     State<Context<T, D, E>, Events<T, D, E>, any, States<T, D, E>>
  //   >;
  submit(): void;
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

  const ctx = __service.initialState.context;

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
    handlers: generate(ctx),
    submit: () => __service.send(EventTypes.SUBMIT),
    subscribe: (fn) => {
      return $service.subscribe((state) => {
        const { data, error, errors, values } = state.context;
        const handlers = generate(state.context);
        fn({ data, error, errors, values, handlers });
      });
    },
  };
};

export default create;
