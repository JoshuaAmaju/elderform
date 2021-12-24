import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { Context, Events, machine, States } from '../src/machine';
import { TypeOf } from '../src/types';
import { object } from '../src/utils';

const schema = object({
  name: z.string(),
});

type Form = TypeOf<typeof schema>;

const def = machine<Form, any, any>();

const ctx: Context<Form, any, any> = {
  ...def.context,
  values: {},
  errors: new Map(),
};

describe('machine', () => {
  let service: Interpreter<
    Context<Form, any, any>,
    any,
    Events<Form, any, any>,
    States<Form, any, any>
  >;

  beforeEach(() => {
    service = interpret(def.withContext(ctx)).start();
  });

  it('should initialise to waitingInit state given no schema provided', (done) => {
    service.onTransition((state) => {
      if (state.matches('waitingInit')) done();
    });
  });

  it('should initialise to idle state', (done) => {
    service = interpret(def.withContext({ ...ctx, schema })).start();

    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });
});
