import { ActorRef, assign, createMachine, send, spawn } from 'xstate';
import { choose, pure } from 'xstate/lib/actions';
import type { ZodIssue, ZodObject } from 'zod';
import { ZodError } from 'zod';
import { actor } from './actor';

export type ActorStates = 'idle' | 'failed' | 'success' | 'validating';

export enum EventTypes {
  SET = 'set',
  SUBMIT = 'submit',
  CHANGE = 'change',
  VALIDATE = 'validate',
  CHANGE_WITH_VALIDATE = 'changeWithValidate',
}

export type Context<T, D = any, E = Error> = {
  data?: D | null;
  error?: E | null;
  dataUpdatedAt?: number;
  errorUpdatedAt?: number;
  __validationMarker: Set<string>;
  schema?: ZodObject<any> | boolean;
  actors: { [K: string]: ActorRef<any> };
  states: { [K in keyof T]: ActorStates };
  values: { [K in keyof T]?: T[K] | null };
  errors: Map<keyof T, ZodIssue['message']>;
};

export type SetType<T, D, E> =
  | { name: 'data'; value: Context<T, D, E>['data'] }
  | { name: 'values'; value: Context<T, D, E>['values'] }
  | { name: 'error'; value: Context<T, D, E>['error'] }
  | { name: 'errors'; value: Context<T, D, E>['errors'] }
  | { name: 'schema'; value: Required<Context<T, D, E>>['schema'] };

export type States<T, D = any, E = any> =
  | { value: 'waitingInit'; context: Context<T, D, E> }
  | { value: 'idle'; context: Context<T, D, E> & { schema: ZodObject<any> } }
  | {
      value: 'validating' | { validating: 'actors' | 'full' };
      context: Context<T, D, E> & { schema: ZodObject<any> };
    }
  | {
      value: 'submitting';
      context: Context<T, D, E> & { schema: ZodObject<any> };
    }
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

export const machine = <T, D, E>() => {
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
        // Wait for the machine to be initialised with a schema
        waitingInit: {},

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
                return Object.keys((schema as ZodObject<any>).shape).map(
                  (key) => {
                    const value = values[key as keyof T];
                    return send(
                      { value, type: 'VALIDATE' },
                      { to: key as string }
                    );
                  }
                );
              }),

              always: [
                {
                  target: '#form.idle',
                  cond: (ctx) => {
                    return (
                      ctx.errors.size > 0 &&
                      ctx.__validationMarker.size >=
                        Object.keys((ctx.schema as ZodObject<any>).shape).length
                    );
                  },
                },
                {
                  target: 'full',
                  cond: ({ schema, __validationMarker }) => {
                    return (
                      __validationMarker.size >=
                      Object.keys((schema as ZodObject<any>).shape).length
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
              actions: 'setInitialStates',
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
          Object.values((schema as ZodObject<any>).shape).length > 0,
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
            const entries = Object.keys((schema as ZodObject<any>).shape).map(
              (key) => [key, 'idle']
            );
            return Object.fromEntries(entries);
          },
        }),

        spawnActors: assign({
          actors: ({ schema }) => {
            const { shape } = schema as ZodObject<any>;

            const entries = Object.keys(shape).map((key) => {
              const act = spawn(
                actor({
                  id: key as string,
                  validator: shape[key],
                }),
                key as string
              );

              return [key, act] as const;
            });

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
            return { ...states, [id]: 'idle' };
          },
        }),

        setActorFail: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: 'failed' };
          },
        }),

        setActorSuccess: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: 'success' };
          },
        }),

        setActorValidating: assign({
          states: ({ states }, { id }: any) => {
            return { ...states, [id]: 'validating' };
          },
        }),
      },

      services: {
        submit: () => Promise.resolve(),

        validateSchema: async ({ schema, values }) => {
          try {
            return await (schema as ZodObject<any>).parseAsync(values);
          } catch (error) {
            let err = error;

            if (error instanceof ZodError) {
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
