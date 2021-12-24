import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/lib/Option';
import { identity, keys, length, map } from 'ramda';
import { actions, ActorRef, assign, createMachine, send, spawn } from 'xstate';
import { ZodRawShape } from 'zod';
import { Schema } from '../types';
import { actor } from './actor';

enum EventTypes {
  SET = 'set',
  SUBMIT = 'submit',
  CHANGE = 'change',
  VALIDATE = 'validate',
  CHANGE_WITH_VALIDATE = 'changeWithValidate',
}

enum ActorStates {
  IDLE = 'idle',
  FAILED = 'failed',
  SUCCESS = 'success',
  VALIDATING = 'validating',
}

type Context<T extends ZodRawShape, D = any, E = Error> = {
  data?: D;
  error?: E;
  schema?: Schema<T>;
  errors: Map<keyof T, Error>;
  __validationMarker: Set<string>;
  actors: { [K: string]: ActorRef<any> };
  states: { [K in keyof T]: ActorStates };
  values: { [K in keyof T]: T[K] | null };
};

export type SetType<T extends ZodRawShape, D, E> =
  | { name: 'data'; value: Context<T, D, E>['data'] }
  | { name: 'values'; value: Context<T, D, E>['values'] }
  | { name: 'error'; value: Context<T, D, E>['error'] }
  | { name: 'errors'; value: Context<T, D, E>['errors'] }
  | { name: 'schema'; value: Context<T, D, E>['schema'] };

type States<T extends ZodRawShape, D, E> =
  | { value: 'waitingInit'; context: Context<T, D, E> }
  | { value: 'idle'; context: Context<T, D, E> & { schema: Schema<T> } }
  | {
      value: 'validating';
      context: Context<T, D, E> & { schema: Schema<T> };
    }
  | { value: 'submitting'; context: Context<T, D, E> & { schema: Schema<T> } };

type Events<T extends ZodRawShape, D, E> =
  | { type: EventTypes.SUBMIT }
  | ({ type: EventTypes.SET } & SetType<T, D, E>)
  | {
      id: string;
      value: any;
      type: EventTypes.CHANGE | EventTypes.CHANGE_WITH_VALIDATE;
    }
  | { id: string; type: EventTypes.VALIDATE }
  | { type: 'FAIL'; id: string; reason: any }
  | { type: 'SUCCESS' | 'VALIDATING'; id: string };

const { pure, choose } = actions;

export const machine = <T extends ZodRawShape, D, E>() => {
  return createMachine<Context<T, D, E>, Events<T, D, E>, States<T, D, E>>(
    {
      initial: 'idle',

      entry: choose([
        {
          cond: 'hasSchema',
          actions: 'spawnActors',
        },
      ]),

      on: {
        FAIL: {
          actions: ['setActorFail'],
        },

        SUCCESS: {
          actions: ['setActorSuccess'],
        },

        VALIDATING: {
          actions: ['setActorValidating'],
        },

        [EventTypes.SET]: [
          {
            target: 'idle',
            in: 'waitingInit',
            actions: ['set', 'maybeSpawnActors'],
          },
          {
            actions: 'set',
          },
        ],
      },

      states: {
        waitingInit: {
          meta: {
            summary: 'Wait for the machine to be initialised with a schema',
          },
        },

        idle: {
          always: {
            target: 'waitingInit',
            cond: ({ schema }) => !schema,
          },

          on: {
            [EventTypes.CHANGE]: {
              actions: 'setValue',
            },

            [EventTypes.SUBMIT]: [
              {
                actions: 'onSubmitWithErrors',
                cond: ({ errors }) => errors.size > 0,
              },
              {
                target: 'validating',
              },
            ],

            [EventTypes.VALIDATE]: {
              actions: send(
                ({ values }, { id }) => {
                  return { value: values[id], type: 'VALIDATE' };
                },
                { to: (_, { id }) => id }
              ),
            },

            [EventTypes.CHANGE_WITH_VALIDATE]: {
              actions: [
                'setValue',
                send((_, { value }) => ({ value, type: 'VALIDATE' }), {
                  to: (_, { id }) => id,
                }),
              ],
            },
          },
        },

        validating: {
          exit: assign({
            __validationMarker: (_) => new Set(),
          }),

          entry: pure(({ schema, values }) => {
            return pipe(
              schema,
              keys,
              map((key) => {
                const value = values[key];
                return send({ value, type: 'VALIDATE' }, { to: key });
              })
            );
          }),

          always: {
            target: 'submitting',
            cond: ({ schema, __validationMarker }) => {
              return __validationMarker.size >= pipe(schema, keys, length);
            },
          },

          on: {
            FAIL: {
              actions: ['mark', 'setActorFail'],
            },

            SUCCESS: {
              actions: ['mark', 'setActorSuccess'],
            },
          },
        },

        submitting: {
          exit: assign({
            states: ({ schema }) => {
              return Object.fromEntries(
                keys(schema).map((key) => [key, ActorStates.IDLE] as const)
              ) as Context<T, D, E>['states'];
            },
          }),

          invoke: {
            src: 'submit',
            onDone: {
              target: 'idle',
              actions: assign({
                data: (_, { data }) => data,
              }),
            },
            onError: {
              target: 'idle',
              actions: assign({
                error: (_, { data }) => data,
              }),
            },
          },
        },
      },
    },
    {
      guards: {
        hasSchema: ({ schema }) => !!schema,
      },

      actions: {
        set: assign((ctx, { name, value }: any) => {
          return { ...ctx, [name]: value };
        }),

        maybeSpawnActors: choose([
          {
            actions: 'spawnActors',
            cond: ({ schema }, { name, value }: any) => {
              return !schema && name === 'schema' && !!value;
            },
          },
        ]),

        spawnActors: assign({
          actors: ({ schema }) => {
            const entries = pipe(
              schema,
              O.fromNullable,
              O.map((s) => {
                return pipe(
                  keys(s),
                  map((key) => {
                    const validator = s[key];
                    const act = spawn(actor({ id: key as string, validator }));
                    return [key, act] as const;
                  })
                );
              }),
              O.fold(() => [], identity)
            );

            return Object.fromEntries(entries);
          },
        }),

        setValue: assign({
          values: ({ values }, { id, value }: any) => {
            return { ...values, [id]: value };
          },
        }),

        setError: assign({
          errors: ({ errors }, { id, error }: any) => {
            errors.set(id, error);
            return errors;
          },
        }),

        removeError: assign({
          errors: ({ errors }, { id }: any) => {
            errors.delete(id);
            return errors;
          },
        }),

        clearErrors: assign({
          errors: (_) => new Map(),
        }),

        clearValues: assign({
          values: (_) => ({} as T),
        }),

        mark: assign({
          __validationMarker: ({ __validationMarker }, { id }: any) => {
            __validationMarker.add(id);
            return __validationMarker;
          },
        }),

        setActorIdle: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: ActorStates.IDLE };
          },
        }),

        setActorFail: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: ActorStates.FAILED };
          },
        }),

        setActorSuccess: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: ActorStates.SUCCESS };
          },
        }),

        setActorValidating: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: ActorStates.VALIDATING };
          },
        }),
      },

      services: {
        submit: () => Promise.resolve(),
      },
    }
  );
};
