import { actor, Ctx, Events, States } from '../src/machine/actor';
import { interpret, Interpreter } from 'xstate';
import { string } from 'zod';

describe('actor', () => {
  let service: Interpreter<Ctx, any, Events, States>;

  const mockActions = {
    notifyIdle: () => {},
    notifyError: () => {},
    notifySuccess: () => {},
    notifyValidating: () => {},
  };

  beforeEach(() => {
    service = interpret(
      actor({ id: '1', validator: (v) => string().parseAsync(v) }).withConfig({
        actions: mockActions,
      })
    ).start();
  });

  it('should create actor', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('should initialise actor to error state', (done) => {
    const service = interpret(
      actor({
        id: '1',
        value: 'Joe',
        error: new Error(''),
        validator: (v) => string().parseAsync(v),
      }).withConfig({ actions: mockActions })
    ).start();

    service.onTransition((state) => {
      expect(state.value).toBe('error');
      expect(state.matches('error')).toBeTruthy();
      done();
    });
  });

  it('should create actor with initial value', (done) => {
    const service = interpret(
      actor({
        id: '1',
        value: 'Joe',
        validator: (v) => string().parseAsync(v),
      }).withConfig({
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
    service?.onTransition((state) => {
      if (state.matches('error')) {
        expect(state.context.error).not.toBeNull();
        done();
      }
    });

    service?.send({ type: 'validate', value: null, values: {} });
  });

  it('validation should pass', (done) => {
    service?.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.error).toBeUndefined();
        done();
      }
    });

    service?.send({ type: 'validate', value: 'Joe', values: {} });
  });

  it('validation should pass and resolve with new value', (done) => {
    const service = interpret(
      actor({ id: '1', validator: () => 'Jane' }).withConfig({
        actions: mockActions,
      })
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
