import { ActorRef, assign, createMachine, send, spawn } from 'xstate';
import { choose, pure } from 'xstate/lib/actions';
import { actor } from './actor';
import { Schema } from './types';

declare var __DEV__: boolean;

export type ActorStates = 'idle' | 'failed' | 'success' | 'validating';

export enum EventTypes {
  Set = 'set',
  Submit = 'submit',
  Change = 'change',
  Cancel = 'cancel',
  Validate = 'validate',
  ChangeWithValidate = 'changeWithValidate',
}

export type Context<T, D = any, E = Error, Es = any> = {
  data?: D | null;
  error?: E | null;
  failureCount: number;
  __ignore: Set<keyof T>;
  dataUpdatedAt?: number;
  errorUpdatedAt?: number;
  errors: Map<keyof T, Es>;
  schema?: Schema<T> | boolean;
  __validationMarker: Set<string>;
  actors: { [K: string]: ActorRef<any> };
  states: { [K in keyof T]: ActorStates };
  values: { [K in keyof T]?: T[K] | null };
};

export type SetType<T, D, E, Es> =
  | { name: 'data'; value: Context<T, D, E, Es>['data'] }
  | { name: 'error'; value: Context<T, D, E, Es>['error'] }
  | { name: 'values'; value: Required<Context<T, D, E, Es>['values']> }
  | { name: 'errors'; value: Required<Context<T, D, E, Es>['errors']> }
  | { name: 'schema'; value: Schema<T> };

export type States<T, D = any, E = any> =
  | { value: 'waitingInit'; context: Context<T, D, E> }
  | { value: 'idle'; context: Context<T, D, E> & { schema: Schema<T> } }
  | {
      value: 'validating';
      context: Context<T, D, E> & { schema: Schema<T> };
    }
  | {
      value: 'submitting';
      context: Context<T, D, E> & { schema: Schema<T> };
    }
  | { value: 'submitted'; context: Context<T, D, E> & { data: D } }
  | { value: 'error'; context: Context<T, D, E> & { error: E } };

export type Events<T, D = any, E = any, Es = any> =
  | { type: EventTypes.Cancel }
  | { type: EventTypes.Submit; ignore?: (keyof T)[] }
  | ({ type: EventTypes.Set } & SetType<T, D, E, Es>)
  | {
      id: string;
      value: any;
      type: EventTypes.Change | EventTypes.ChangeWithValidate;
    }
  | { id: keyof T; type: EventTypes.Validate }
  | { type: 'FAIL'; id: string; reason: any }
  | { type: 'SUCCESS'; id: string; value: any }
  | { type: 'VALIDATING'; id: string };

const onChangeActions = [
  'setValue',
  'removeError',
  choose([
    {
      actions: 'setActorIdle',
      cond: ({ states }: any, { id }: any) => {
        return states[id] !== 'validating';
      },
    },
  ]),
] as any;

const onChangeWithValidateActions = [
  'setValue',
  'removeError',
  'setActorIdle',
  send(
    ({ values }: any, { value }: any) => ({
      value,
      values,
      type: 'VALIDATE',
    }),
    {
      to: (_, { id }) => id,
    }
  ),
] as any;

export const machine = <T, D, E, Es>() => {
  return createMachine<
    Context<T, D, E, Es>,
    Events<T, D, E, Es>,
    States<T, D, E>
  >(
    {
      initial: 'idle',

      context: {
        values: {},
        failureCount: 0,
        errors: new Map(),
        __ignore: new Set(),
        __validationMarker: new Set(),
      } as any,

      entry: choose([
        {
          cond: 'hasSchema',
          actions: ['spawnActors', 'setInitialStates'],
        },
      ]),

      on: {
        VALIDATING: {
          actions: ['setActorValidating'],
        },

        // enter idle state if change is sent while in another state
        [EventTypes.Change]: {
          target: 'idle',
          actions: onChangeActions,
        },

        [EventTypes.Validate]: {
          target: 'idle',
          cond: 'hasSchema',
          actions: onChangeWithValidateActions,
        },

        [EventTypes.Set]: [
          {
            target: 'idle',
            in: 'waitingInit',
            actions: ['set', 'maybeSpawnActors', 'maybeSetInitialStates'],
          },
          {
            actions: choose([
              {
                actions: [
                  'set',
                  (_, { name }) => {
                    if (__DEV__) {
                      switch (name) {
                        case 'values':
                        case 'errors':
                          console.warn(
                            `setting value of "${name}" without defining a schema`
                          );
                          break;
                      }
                    }
                  },
                ],
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
            cond: ({ schema }) => !schema && typeof schema !== 'boolean',
          },

          on: {
            FAIL: {
              actions: ['setActorFail', 'setError'],
            },

            SUCCESS: {
              actions: ['setActorSuccess', 'removeError', 'setValue'],
            },

            [EventTypes.Change]: {
              actions: onChangeActions,
            },

            [EventTypes.Submit]: [
              {
                actions: 'onSubmitWithErrors',
                cond: ({ errors }) => errors.size > 0,
              },
              {
                target: 'validating',
                actions: assign({
                  __ignore: (_, { ignore = [] }) => new Set(ignore),
                }),
                cond: ({ schema }, { ignore = [] }) => {
                  if (!schema || typeof schema === 'boolean') return false;
                  const schemaLength = Object.values(schema).length;
                  return schemaLength - ignore.length > 0;
                },
              },
              {
                target: 'submitting',
              },
            ],

            [EventTypes.Validate]: {
              cond: 'hasSchema',
              actions: onChangeWithValidateActions,
            },

            [EventTypes.ChangeWithValidate]: {
              cond: 'hasSchema',
              actions: onChangeWithValidateActions,
            },
          },
        },

        validating: {
          exit: assign({
            __ignore: (_) => new Set(),
            __validationMarker: (_) => new Set(),
          }),

          entry: [
            assign({ errors: (_) => new Map() }),
            pure(({ schema, values, __ignore }) => {
              return Object.keys(schema as Schema)
                .filter((key) => !__ignore.has(key as keyof T))
                .map((key) => {
                  const value = values[key as keyof T];
                  return send(
                    { value, values, type: 'VALIDATE' },
                    { to: key as string }
                  );
                });
            }),
          ],

          always: [
            {
              target: 'idle',
              cond: (ctx) => {
                return (
                  ctx.errors.size > 0 &&
                  ctx.__validationMarker.size >=
                    Object.keys(ctx.schema as Schema).length - ctx.__ignore.size
                );
              },
            },
            {
              target: 'submitting',
              cond: ({ schema, __ignore, __validationMarker }) => {
                return (
                  __validationMarker.size >=
                  Object.keys(schema as Schema).length - __ignore.size
                );
              },
            },
          ],

          on: {
            FAIL: {
              actions: ['mark', 'setActorFail', 'setError'],
            },

            SUCCESS: {
              actions: ['mark', 'setActorSuccess', 'removeError', 'setValue'],
            },
          },
        },

        submitting: {
          on: {
            [EventTypes.Cancel]: 'idle',
          },

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

        submitted: {
          entry: assign({
            failureCount: (_) => 0,
          }),
        },

        error: {
          entry: assign({
            failureCount: (ctx) => ctx.failureCount + 1,
          }),

          on: {
            [EventTypes.Submit]: 'submitting',
          },
        },
      },
    },
    {
      guards: {
        hasSchema: ({ schema }) =>
          typeof schema !== 'boolean' &&
          !!schema &&
          Object.values(schema as Schema).length > 0,
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
            const entries = Object.keys(schema as Schema).map((key) => [
              key,
              'idle',
            ]);
            return Object.fromEntries(entries);
          },
        }),

        spawnActors: assign({
          actors: ({ schema }) => {
            const shape = schema as Schema;

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
            return errors.set(id, reason);
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
            return __validationMarker.add(id);
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
      },
    }
  );
};
