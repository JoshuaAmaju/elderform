import { interpret, Interpreter, State } from 'xstate';
import * as z from 'zod';
import { from, Observable } from 'rxjs';
import {
  Context,
  Events,
  EventTypes,
  machine,
  States,
  ActorStates,
} from '../src/machine';
import { Config } from './types';
import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import { identity, keys, map } from 'ramda';
import { flow } from 'fp-ts/lib/function';

export { TypeOf } from './types';
export { object } from './utils';

export { z };

type Handler<T> = {
  state: ActorStates;
  set: (value: T) => void;
  setWithValidate: (value: T) => void;
};

type Form<T, D, E> = {
  //   service: () => Observable<
  //     State<Context<T, D, E>, Events<T, D, E>, any, States<T, D, E>>
  //   >;
  __service: Interpreter<
    Context<T, D, E>,
    any,
    Events<T, D, E>,
    States<T, D, E>
  >;
  submit(): void;
  handlers: { [K in keyof T]: Handler<T[K]> };
  generate(): { [K in keyof T]: Handler<T[K]> };
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

  const generate: Form<T, D, E>['generate'] = () => {
    const { states } = __service.initialState.context;

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
    generate,
    __service,
    // service: () => from(__service),
    handlers: generate(),
    submit: () => __service.send(EventTypes.SUBMIT),
  };
};

export default create;
