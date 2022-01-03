import { assign, createMachine, sendParent } from 'xstate';
import { Validator } from './types';

export type Context = { value: any; values: any };

export type States = { context: Context; value: 'idle' | 'validating' };

export type Events =
  | { id: string; type: 'FAIL' | 'SUCCESS' }
  | { type: 'VALIDATE'; value: any; values: any };

export const actor = ({
  id,
  validator,
}: {
  id: string;
  validator: Validator;
}) => {
  return createMachine<Context, Events, States>(
    {
      initial: 'idle',

      context: {} as any,

      states: {
        idle: {
          on: {
            VALIDATE: {
              actions: 'setValue',
              target: 'validating',
            },
          },
        },

        validating: {
          entry: 'sendValidating',

          on: {
            VALIDATE: {
              internal: false,
              actions: 'setValue',
              target: 'validating',
            },
          },

          invoke: {
            src: 'validate',
            onDone: {
              target: 'idle',
              actions: 'sendSuccess',
            },
            onError: {
              target: 'idle',
              actions: 'sendFail',
            },
          },
        },
      },
    },
    {
      actions: {
        setValue: assign({
          value: (_, { value }: any) => value,
          values: (_, { values }: any) => values,
        }),

        sendFail: sendParent((_, { data }: any) => {
          return { id, type: 'FAIL', reason: data };
        }),

        sendSuccess: sendParent((_, { data }: any) => {
          return { id, value: data, type: 'SUCCESS' };
        }),

        sendValidating: sendParent(() => ({ id, type: 'VALIDATING' })),
      },

      services: {
        validate: async ({ value, values }) => {
          const res = validator(value, values);
          return res instanceof Promise ? await res : res;
        },
      },
    }
  );
};
