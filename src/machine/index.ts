import { flow } from 'fp-ts/lib/function';
import { pipe } from 'fp-ts/lib/function';
import * as O from 'fp-ts/Option';
import { identity, keys, length, map, values } from 'ramda';
import { actions, ActorRef, assign, createMachine, send, spawn } from 'xstate';
import { Schema } from '../types';
import { actor } from './actor';
import * as z from 'zod';

export enum EventTypes {
  SET = 'set',
  SUBMIT = 'submit',
  CHANGE = 'change',
  VALIDATE = 'validate',
  CHANGE_WITH_VALIDATE = 'changeWithValidate',
}

export enum ActorStates {
  IDLE = 'idle',
  FAILED = 'failed',
  SUCCESS = 'success',
  VALIDATING = 'validating',
}

export type Context<T, D = any, E = Error> = {
  data?: D | null;
  error?: E | null;
  dataUpdatedAt?: number;
  errorUpdatedAt?: number;
  errors: Map<keyof T, Error>;
  __validationMarker: Set<string>;
  schema?: z.ZodObject<any> | boolean;
  actors: { [K: string]: ActorRef<any> };
  states: { [K in keyof T]: ActorStates };
  values: { [K in keyof T]?: T[K] | null };
};

export type SetType<T, D, E> =
  | { name: 'data'; value: Context<T, D, E>['data'] }
  | { name: 'values'; value: Context<T, D, E>['values'] }
  | { name: 'error'; value: Context<T, D, E>['error'] }
  | { name: 'errors'; value: Context<T, D, E>['errors'] }
  | { name: 'schema'; value: Required<Context<T, D, E>>['schema'] };

export type States<T, D = any, E = any> =
  | { value: 'waitingInit'; context: Context<T, D, E> }
  | { value: 'idle'; context: Context<T, D, E> & { schema: Schema<T> } }
  | {
      value: 'validating' | { validating: 'actors' | 'full' };
      context: Context<T, D, E> & { schema: Schema<T> };
    }
  | { value: 'submitting'; context: Context<T, D, E> & { schema: Schema<T> } }
  | { value: 'submitted'; context: Context<T, D, E> & { data: D } }
  | { value: 'error'; context: Context<T, D, E> & { error: E } };

export type Events<T, D = any, E = any> =
  | { type: EventTypes.SUBMIT }
  | ({ type: EventTypes.SET } & SetType<T, D, E>)
  | {
      id: string;
      value: any;
      type: EventTypes.CHANGE | EventTypes.CHANGE_WITH_VALIDATE;
    }
  | { id: keyof T; type: EventTypes.VALIDATE }
  | { type: 'FAIL'; id: string; reason: any }
  | { type: 'SUCCESS' | 'VALIDATING'; id: string };

const { pure, choose } = actions;

export const machine = <T, D = any, E = any>() => {
  return createMachine<Context<T, D, E>, Events<T, D, E>, States<T, D, E>>(
    {
      id: 'form',
      initial: 'idle',

      entry: choose([
        {
          cond: 'hasSchema',
          actions: ['spawnActors', 'setInitialStates'],
        },
      ]),

      on: {
        FAIL: {
          actions: ['setActorFail', 'setError'],
        },

        SUCCESS: {
          actions: ['setActorSuccess', 'removeError'],
        },

        VALIDATING: {
          actions: ['setActorValidating'],
        },

        // enter idle state if change is sent while in another state
        [EventTypes.CHANGE]: {
          target: 'idle',
          actions: 'setValue',
        },

        [EventTypes.SET]: [
          {
            target: 'idle',
            in: 'waitingInit',
            actions: ['set', 'maybeSpawnActors', 'maybeSetInitialStates'],
          },
          {
            actions: choose([
              {
                actions: 'set',
                cond: (_, e) => e.name !== 'schema',
              },
              {
                actions: 'set',
                cond: (ctx, e) =>
                  !ctx.schema && (e.value !== null || e.value !== undefined),
              },
            ]),
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
            cond: ({ schema }) => !schema && schema !== false,
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
                cond: 'hasSchema',
                target: 'validating',
              },
              {
                target: 'submitting',
              },
            ],

            [EventTypes.VALIDATE]: {
              cond: 'hasSchema',
              actions: send(
                ({ values }, { id }) => {
                  return { value: values[id], type: 'VALIDATE' };
                },
                { to: (_, { id }) => id as string }
              ),
            },

            [EventTypes.CHANGE_WITH_VALIDATE]: {
              cond: 'hasSchema',
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
          initial: 'actors',

          states: {
            actors: {
              exit: assign({
                __validationMarker: (_) => new Set(),
              }),

              entry: pure(({ schema, values }) => {
                return pipe(
                  (schema as z.ZodObject<any>).shape,
                  keys,
                  map((key) => {
                    const value = values[key as keyof T];
                    return send({ value, type: 'VALIDATE' }, { to: key });
                  })
                );
              }),

              always: [
                {
                  target: '#form.idle',
                  cond: (ctx) => {
                    return (
                      ctx.errors.size > 0 &&
                      ctx.__validationMarker.size >=
                        pipe(
                          (ctx.schema as z.ZodObject<any>).shape,
                          keys,
                          length
                        )
                    );
                  },
                },
                {
                  target: 'full',
                  cond: ({ schema, __validationMarker }) => {
                    return (
                      __validationMarker.size >=
                      pipe((schema as z.ZodObject<any>).shape, keys, length)
                    );
                  },
                },
              ],

              on: {
                FAIL: {
                  actions: ['mark', 'setActorFail', 'setError'],
                },

                SUCCESS: {
                  actions: ['mark', 'setActorSuccess', 'removeError'],
                },
              },
            },

            full: {
              invoke: {
                src: 'validateSchema',
                onDone: '#form.submitting',
                onError: {
                  target: '#form.idle',
                  actions: assign({
                    errors: (_, { data }) => data,
                  }),
                },
              },
            },
          },
        },

        submitting: {
          entry: assign({
            data: (_) => null,
            error: (_) => null,
          }),

          exit: choose([
            {
              cond: 'hasSchema',
              actions: assign({
                states: ({ schema }) => {
                  return Object.fromEntries(
                    keys((schema as z.ZodObject<any>).shape).map(
                      (key) => [key, ActorStates.IDLE] as const
                    )
                  ) as Context<T, D, E>['states'];
                },
              }),
            },
          ]),

          invoke: {
            src: 'submit',
            onDone: {
              target: 'submitted',
              actions: assign({
                data: (_, { data }) => data,
                dataUpdatedAt: (_) => Date.now(),
              }),
            },
            onError: {
              target: 'error',
              actions: assign({
                error: (_, { data }) => data,
                errorUpdatedAt: (_) => Date.now(),
              }),
            },
          },
        },

        submitted: {},

        error: {
          on: {
            [EventTypes.SUBMIT]: 'submitting',
          },
        },
      },
    },
    {
      guards: {
        hasSchema: ({ schema }) =>
          typeof schema !== 'boolean' &&
          !!schema &&
          values((schema as z.ZodObject<any>).shape).length > 0,
      },

      actions: {
        set: assign((ctx, { name, value }: any) => {
          return { ...ctx, [name]: value };
        }),

        maybeSpawnActors: choose([
          {
            actions: 'spawnActors',
            cond: ({ schema }, { name, value }: any) => {
              return !schema && name === 'schema' && !!value && value !== false;
            },
          },
        ]),

        maybeSetInitialStates: choose([
          {
            actions: 'setInitialStates',
            cond: ({ states }, { name, value }: any) => {
              return !states && name === 'schema' && value !== false;
            },
          },
        ]),

        setInitialStates: assign({
          states: ({ schema }) => {
            const entries = pipe(
              (schema as z.ZodObject<any>).shape,
              O.fromNullable,
              O.map(
                flow(
                  keys,
                  map((key) => [key, ActorStates.IDLE])
                )
              ),
              O.fold(() => [], identity)
            );

            return Object.fromEntries(entries);
          },
        }),

        spawnActors: assign({
          actors: ({ schema }) => {
            const entries = pipe(
              schema,
              O.fromNullable,
              O.filter((s) => typeof s !== 'boolean'),
              O.map((s) => {
                const { shape } = s as z.ZodObject<any>;

                return pipe(
                  keys(shape),
                  map((key) => {
                    const act = spawn(
                      actor({
                        id: key as string,
                        validator: shape[key],
                      }),
                      key as string
                    );

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
          errors: ({ errors }, { id, reason }: any) => {
            errors.set(id, reason);
            return errors;
          },
        }),

        removeError: assign({
          errors: ({ errors }, { id }: any) => {
            errors.delete(id);
            return errors;
          },
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

        validateSchema: async ({ schema, values }) => {
          try {
            return await (schema as z.ZodObject<any>).parseAsync(values);
          } catch (error) {
            let err = error;

            if (error instanceof z.ZodError) {
              const errors = error.issues.map((e) => {
                const [path] = e.path;
                return [path, e.message] as const;
              });

              err = new Map(errors);
            }

            throw err;
          }
        },
      },
    }
  );
};
