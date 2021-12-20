import { assign, sendParent, createMachine } from 'xstate';

type Context = {
  value?: any;
};

type States = { value: 'idle' | 'validating'; context: Context };

type Events =
  | { id: string; type: 'FAIL' | 'SUCCESS' }
  | { type: 'VALIDATE'; value: any };

export const actor = ({ id }: { id: string }) => {
  return createMachine<Context, Events, States>(
    {
      initial: 'idle',

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
            },
            onError: {
              target: 'idle',
            },
          },
        },
      },
    },
    {
      actions: {
        setValue: assign({
          value: (_, { value }: any) => value,
        }),

        sendFail: sendParent((_, { data }: any) => {
          return { id, type: 'FAIL', reason: data };
        }),

        sendSuccess: sendParent((_) => {
          return { id, type: 'SUCCESS' };
        }),
      },

      services: {
        validate: () => Promise.resolve(),
      },
    }
  );
};
