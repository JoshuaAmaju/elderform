import { assign, createMachine, sendParent } from 'xstate';
import { Validator } from './types';

export type Ctx<T = any, E = any> = {
  value: T;
  error?: E | null;
};

export type Events =
  | { type: 'reset' }
  | { type: 'change'; value: any }
  | { type: 'validate'; value?: any; values: any }
  | { type: 'set'; name: 'error' | 'value'; value: any };

export type States = {
  value: 'idle' | 'validating' | 'error' | 'success';
  context: Ctx;
};

export const actor = ({
  id,
  error,
  // value,
  onValidate,
}: {
  id: string;
  error?: unknown;
  // value?: unknown;
  onValidate: Validator;
}) => {
  return createMachine<Ctx, Events, States>(
    {
      initial: !!error ? 'error' : 'idle',

      // context: { error, value },

      on: {
        validate: 'validating',

        reset: {
          target: 'idle',
          // actions: assign({
          //   error: (_) => error,
          //   value: (_) => value,
          // }),
        },

        // set: {
        //   actions: choose([
        //     {
        //       actions: 'setValue',
        //       cond: (_, { name }) => name === 'value',
        //     },
        //     {
        //       cond: (_, { name }) => name === 'error',
        //       actions: assign({ error: (_, { value }) => value }),
        //     },
        //   ]),
        // },

        // change: [
        //   {
        //     in: 'error',
        //     target: 'idle',
        //     actions: 'setValue',
        //   },
        //   {
        //     in: 'validating',
        //     actions: 'setValue',
        //     target: 'validating',
        //   },
        //   {
        //     actions: 'setValue',
        //   },
        // ],
      },

      states: {
        idle: {
          entry: 'notifyIdle',
        },

        validating: {
          entry: 'notifyValidating',

          invoke: {
            src: 'validate',
            onError: {
              target: 'error',
              actions: [
                // 'setError',
                'notifyError',
              ],
            },
            onDone: {
              target: 'idle',
              actions: [
                'notifySuccess',
                // assign({ value: (_, { data }) => data }),
              ],
            },
          },
        },

        error: {
          exit: 'clearError',
        },

        success: {},
      },
    },
    {
      actions: {
        // setValue: assign({
        //   value: (_, { value }: any) => value,
        // }),

        // setError: assign({
        //   error: (_, { data }: any) => data,
        // }),

        // clearError: assign({ error: (_) => null }),

        notifyIdle: sendParent((_) => {
          return { id, type: 'actor_idle' };
        }),

        notifyValidating: sendParent(() => {
          return { id, type: 'actor_validating' };
        }),

        notifySuccess: sendParent((_, { data }: any) => {
          return { id, type: 'actor_success', value: data };
        }),

        notifyError: sendParent((_, { data }: any) => {
          return { id, type: 'actor_error', error: data };
        }),
      },
      services: {
        validate: async (_, { value, values }: any) => {
          const res = onValidate(value, values);
          return res instanceof Promise ? await res : res;
        },
      },
    }
  );
};
