import { actor, Context, Events, States } from '../src/machine/actor';
import { interpret, Interpreter } from 'xstate';
import { string } from 'zod';

describe('actor', () => {
  let service: Interpreter<Context, any, Events, States>;

  let error: any = null;

  beforeEach(() => {
    service = interpret(
      actor({
        id: '1',
        validator: (v) => string().parseAsync(v),
      }).withConfig({
        actions: {
          sendFail: (_, { data }: any) => {
            error = data;
          },
          sendSuccess: () => {},
          sendValidating: () => {},
        },
      })
    ).start();
  });

  afterEach(() => {
    error = null;
  });

  it('should create initialise actor', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('validation should fail', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(error).not.toBeNull();
        done();
      }
    });

    service.send({ type: 'VALIDATE', value: null, values: {} });
  });

  it('validation should pass', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(error).toBeNull();
        done();
      }
    });

    service.send({ type: 'VALIDATE', value: 'Joe', values: {} });
  });

  it('validation should pass and resolve with new value', (done) => {
    const service = interpret(
      actor({ id: '1', validator: () => 'Jane' }).withConfig({
        actions: {
          sendValidating: () => {},
          sendSuccess: (_, { data }: any) => {
            expect(data).toBe('Jane');
          },
        },
      })
    ).start();

    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        done();
      }
    });

    service.send({ type: 'VALIDATE', value: 'Joe', values: {} });
  });
});
