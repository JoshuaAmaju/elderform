import { ActorRef, assign, createMachine, send, spawn } from 'xstate';
import { choose, pure } from 'xstate/lib/actions';
import { Validator } from '..';
import { actor } from './actor';
import { Schema } from './types';
import { flatten } from './utils';
import { get, set } from 'object-path';

declare var __DEV__: boolean;

export type ActorStates = 'idle' | 'failed' | 'success' | 'validating';

export enum EventTypes {
  Set = 'set',
  Kill = 'kill',
  Spawn = 'spawn',
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
      value: any;
      id: keyof T;
      type: EventTypes.Change | EventTypes.ChangeWithValidate;
    }
  | { id: keyof T; type: EventTypes.Validate }
  | { id: any; type: EventTypes.Kill }
  | { id: string; type: EventTypes.Spawn; value: Validator }
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

const validateActions = [
  'removeError',
  'setActorIdle',
  send(
    ({ values }: any, { id }: any) => ({
      values,
      type: 'VALIDATE',
      value: get(values, id),
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

        [EventTypes.ChangeWithValidate]: {
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

            [EventTypes.Kill]: {
              cond: 'notBoolSchema',
              actions: assign({
                schema: ({ schema }, { id }) => {
                  delete (schema as Schema<T>)[id as keyof T];
                  return schema;
                },
                actors: ({ actors }, { id }) => {
                  const act = actors?.[id];
                  delete actors?.[id];
                  act?.stop?.();
                  return actors;
                },
              }),
            },

            [EventTypes.Spawn]: {
              cond: 'notBoolSchema',
              actions: assign({
                schema: ({ schema }, { id, value }) => {
                  return { ...(schema as Schema<T>), [id]: value };
                },
                actors: ({ actors }, { id, value }) => {
                  const act = spawn(actor({ id, validator: value }), id);
                  return { ...actors, [id]: act };
                },
              }),
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
                cond: ({ actors = {} }, { ignore = [] }) => {
                  const length = Object.values(actors).length;
                  return length - ignore.length > 0;
                },
              },
              {
                target: 'submitting',
              },
            ],

            [EventTypes.Validate]: {
              cond: 'hasSchema',
              actions: validateActions,
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
            pure(({ actors, values, __ignore }) => {
              return Object.keys(actors)
                .filter((key) => !__ignore.has(key as keyof T))
                .map((key) => {
                  const value = get(values, key);
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
                    Object.keys(ctx.actors).length - ctx.__ignore.size
                );
              },
            },
            {
              target: 'submitting',
              cond: ({ actors, __ignore, __validationMarker }) => {
                return (
                  __validationMarker.size >=
                  Object.keys(actors).length - __ignore.size
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

        notBoolSchema: ({ schema }) => typeof schema !== 'boolean',
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
            const flattened = flatten(schema as Schema);

            const entries = Object.keys(flattened).map((key) => [key, 'idle']);
            return Object.fromEntries(entries);
          },
        }),

        spawnActors: assign({
          actors: ({ schema }) => {
            const shape = schema as Schema;

            const flattened = flatten(shape);

            const entries = Object.keys(flattened).map((key) => {
              const act = spawn(
                actor({
                  id: key as string,
                  validator: flattened[key],
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
            set(values, id, value);
            return values;
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
