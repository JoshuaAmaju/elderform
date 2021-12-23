import { actor, Context, Events, States } from '../src/machine/actor';
import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';

describe('actor', () => {
  let service: Interpreter<Context, any, Events, States>;

  beforeEach(() => {
    service = interpret(actor({ id: '1', validator: z.string() })).start();
  });

  it('should create initialise actor', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle')) {
        done();
      }
    });
  });

  it('should not indicate first run', (done) => {
    service.onTransition((state) => {
      if (!state.context.__firstRun) {
        done();
      }
    });
  });
});
