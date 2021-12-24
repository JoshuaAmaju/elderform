import { machine, Context, Events, States } from '../src/machine';
import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { Schema, TypeOf } from '../src/types';
import { object } from '../src/utils';

const schema = object({
  name: z.string(),
});

type Form = TypeOf<typeof schema>;

describe('empty', () => {
  let service: Interpreter<
    Context<Form>,
    any,
    Events<Form, any, any>,
    States<Form, any, any>
  >;

  service.state.context.values.name;

  it('empty', (done) => {
    done();
  });
});
