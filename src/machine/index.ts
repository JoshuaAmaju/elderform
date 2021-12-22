import { send, actions, assign, createMachine, ActorRef } from 'xstate';

enum EventTypes {
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

type Context = {
  data: any;
  error: Error;
  __doneMarker: Set<string>;
  errors: Map<string, Error>;
  values: { [K: string]: any };
  states: { [K: string]: ActorStates };
  actors: { [K: string]: ActorRef<any> };
};

type States =
  | { value: 'idle'; context: Context }
  | { value: 'validating'; context: Context }
  | { value: 'submitting'; context: Context };

type Events =
  | { type: EventTypes.SUBMIT }
  | {
      id: string;
      value: any;
      type: EventTypes.CHANGE | EventTypes.CHANGE_WITH_VALIDATE;
    }
  | { id: string; type: EventTypes.VALIDATE }
  | { type: 'FAIL'; id: string; reason: any }
  | { type: 'SUCCESS' | 'VALIDATING'; id: string };

const { pure } = actions;

export const machine = createMachine<Context, Events, States>(
  {
    initial: 'idle',

    on: {
      FAIL: {
        actions: ['setActorFail'],
      },

      SUCCESS: {
        actions: ['setActorSuccess'],
      },

      VALIDATING: {
        actions: assign({
          states: ({ states }, { id }) => {
            return { ...states, [id]: ActorStates.VALIDATING };
          },
        }),
      },
    },

    states: {
      idle: {
        on: {
          [EventTypes.CHANGE]: {
            actions: 'setValue',
          },

          [EventTypes.SUBMIT]: 'validating',

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
        // entry: pure(() => {}),

        always: {
          target: 'submitting',
          cond: ({ __doneMarker }) => __doneMarker.size > 0,
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
        // exit: assign({
        //   states: () => ({}),
        // }),

        invoke: {
          src: '',
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
    actions: {
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
        values: (_) => ({}),
      }),

      mark: assign({
        __doneMarker: ({ __doneMarker }, { id }: any) => {
          __doneMarker.add(id);
          return __doneMarker;
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
  }
);
