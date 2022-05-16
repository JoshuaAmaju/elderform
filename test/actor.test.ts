import { config, Ctx, Events, States } from '../src/machine/actor';
import { interpret, Interpreter } from 'xstate';
import { string } from 'zod';

describe('actor', () => {
  let service: Interpreter<Ctx, any, Events, States>;

  const mockActions = {
    notifyError: () => {},
    notifySuccess: () => {},
    notifyValidating: () => {},
  };

  beforeEach(() => {
    service = interpret(
      config('1', null, (v) => string().parseAsync(v)).withConfig({
        actions: mockActions,
      })
    ).start();
  });

  it('should create actor', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('should create actor with initial value', (done) => {
    const service = interpret(
      config('1', 'Jeo', (v) => string().parseAsync(v)).withConfig({
        actions: mockActions,
      })
    ).start();

    service.onTransition((state) => {
      if (state.matches('idle')) {
        expect(state.context.value).toBe('Joe');
        done();
      }
    });
  });

  it('validation should fail', (done) => {
    service.onTransition((state) => {
      if (state.matches('error')) {
        expect(state.context.error).not.toBeNull();
        done();
      }
    });

    service.send({ type: 'validate', value: null, values: {} });
  });

  it('validation should pass', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.error).toBeNull();
        done();
      }
    });

    service.send({ type: 'validate', value: 'Joe', values: {} });
  });

  it('validation should pass and resolve with new value', (done) => {
    const service = interpret(
      config('1', null, () => 'Jane').withConfig({ actions: mockActions })
    ).start();

    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.value).toBe('Jane');
        done();
      }
    });

    service.send({ type: 'validate', value: 'Joe', values: {} });
  });
});
