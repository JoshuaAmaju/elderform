import { assign, createMachine, sendParent } from 'xstate';
import { ZodError, ZodTypeAny } from 'zod';

export type Context = {
  value?: any;
};

export type States = { context: Context; value: 'idle' | 'validating' };

export type Events =
  | { id: string; type: 'FAIL' | 'SUCCESS' }
  | { type: 'VALIDATE'; value: any };

export const actor = ({
  id,
  validator,
}: {
  id: string;
  validator: ZodTypeAny;
}) => {
  return createMachine<Context, Events, States>(
    {
      initial: 'idle',

      context: {},

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
        }),

        sendFail: sendParent((_, { data }: any) => {
          return { id, type: 'FAIL', reason: data };
        }),

        sendSuccess: sendParent((_) => {
          return { id, type: 'SUCCESS' };
        }),
      },

      services: {
        validate: async ({ value }) => {
          try {
            return await validator.parseAsync(value);
          } catch (e) {
            let err = (e as Error)?.message;

            // console.log('error', e);

            if (e instanceof ZodError) err = e.issues[0].message;

            return Promise.reject(err);
          }
        },
      },
    }
  );
};
