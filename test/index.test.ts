import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { machine, Ctx, Events, States } from '../src/machine';

let service: Interpreter<Ctx, any, Events, States> | null;

const def = machine({ onSubmit: () => {} });

describe('machine', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterEach(() => {
    service = null;
  });

  it('should initialise machine', (done) => {
    service?.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('should initialize with default values', (done) => {
    const def = machine({
      onSubmit: async () => {},
      initialValues: { name: 'Joe' },
    });

    const service = interpret(def).start();

    service?.onTransition(({ context: ctx }) => {
      expect(ctx.values).toBeDefined();
      expect(ctx.values).toMatchObject({ name: 'Joe' });
      done();
    });
  });
});

describe('field validation', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterEach(() => {
    service = null;
  });

  it('should validate field with error', (done) => {
    service?.send({
      value: 100,
      id: 'name',
      type: 'spawn',
      onValidate: (v) => z.string().parseAsync(v),
    });

    service?.onTransition(({ context }) => {
      if (context.states.name === 'error') {
        expect(context.errors.name).toBeDefined();
        done();
      }
    });

    service?.send({ type: 'validate', id: 'name' });
  });

  it('should validate field without error', (done) => {
    service?.send({
      id: 'name',
      value: 'Joe',
      type: 'spawn',
      onValidate: (v) => z.string().parseAsync(v),
    });

    service?.onTransition(({ context }) => {
      if (context.states.name === 'success') {
        expect(context.errors.name).not.toBeDefined();
        done();
      }
    });

    service?.send({ id: 'name', type: 'validate' });
  });

  it('should unset value if validator returns null', (done) => {
    service?.send({
      id: 'name',
      value: 'John',
      type: 'spawn',
      onValidate: async (v) => {
        const res = await z.string().parseAsync(v);
        return null;
      },
    });

    service?.onTransition(({ context }) => {
      console.log(context.values);

      if (context.states.name === 'idle') {
        expect(context.values.name).toBe('John');
      }

      if (context.states.name === 'success') {
        expect(context.values.name).toBeNull();
        done();
      }
    });

    service?.send({ type: 'validate', id: 'name' });
  });

  it('should retain previous value if validator returns void or undefined', (done) => {
    service?.send({
      id: 'name',
      value: 'John',
      type: 'spawn',
      onValidate: async (v) => {
        const res = await z.string().parseAsync(v);
      },
    });

    service?.onTransition(({ context }) => {
      if (context.states.name === 'success') {
        expect(context.values.name).toBe('John');
        done();
      }
    });

    service?.send({ type: 'validate', id: 'name' });
  });
});

describe('submission', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterEach(() => {
    service = null;
  });

  it('should cancel submission at validation state', (done) => {
    service?.send({
      id: 'name',
      value: 'Joe',
      type: 'spawn',
      onValidate: (v) => z.string().parseAsync(v),
    });

    service?.onTransition((state) => {
      if (state.matches('validating')) {
        service?.send('cancel');
      }

      if (state.matches('idle') && state.history?.matches('validating')) {
        done();
      }
    });

    service?.send('submit');
  });

  it('should cancel submission at submitting state', (done) => {
    service?.onTransition((state) => {
      if (state.matches('submitting')) {
        service?.send('cancel');
      }

      if (state.matches('idle') && state.history?.matches('submitting')) {
        done();
      }
    });

    service?.send('submit');
  });

  it('should skip validation if there are no actors', (done) => {
    service?.onTransition((state) => {
      expect(state.value).not.toEqual('validating');
      if (state.matches('submitted')) done();
    });

    service?.send('submit');
  });

  it('should submit without error', (done) => {
    service?.onTransition((state) => {
      if (state.matches('submitted')) {
        expect(state.context.error).not.toBeDefined();
        done();
      }
    });

    service?.send('submit');
  });

  it('should submit with error', (done) => {
    const def = machine({
      initialValues: {},
      onSubmit: async () => {
        throw new Error('error');
      },
    });

    const service = interpret(def).start();

    service.onTransition((state) => {
      if (state.matches('error')) {
        expect(state.context.error).toBeDefined();
        done();
      }
    });

    service.send('submit');
  });

  it('should not submit due to validation error', (done) => {
    service?.send({
      value: 1,
      id: 'name',
      type: 'spawn',
      onValidate: (v) => z.string().parseAsync(v),
    });

    service?.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.errors.name).toBeDefined();
        done();
      }
    });

    service?.send('submit');
  });

  // it('should bailout on submission if any field has error', (done) => {
  //   const def = machine<Form, any, any, any>();

  //   const service = interpret(
  //     def.withContext({ ...def.context, schema }).withConfig({
  //       actions: { onSubmitWithErrors: () => done() },
  //     })
  //   ).start();

  //   service.onTransition((_, e) => {
  //     if (e.type === 'FAIL') service.send(EventTypes.Submit);
  //   });

  //   service.send({ id: 'name', type: EventTypes.Validate });
  // });
});

describe('dynamic schema', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterEach(() => {
    service = null;
  });

  it('should spawn and kill actor', (done) => {
    let id = '1';
    let killed = false;

    service?.onChange(({ actors }) => {
      if (actors[id]) {
        service?.send({ id, type: 'kill' });
      }

      if (killed) {
        expect(actors[id]).not.toBeDefined();
        done();
      }

      killed = !actors[id];
    });

    service?.send({
      id,
      value: 'Joe',
      type: 'spawn',
      onValidate: (v) => z.string().parse(v),
    });
  });
});

describe('nested schemas', () => {
  const values = {
    name: 'Jane',
    address: {
      line: 'No 4',
      city: 'Alausa',
      state: 'Lagos',
    },
  };

  beforeEach(() => {
    const def = machine({ initialValues: values, onSubmit: async () => {} });
    service = interpret(def).start();
  });

  afterEach(() => {
    service?.stop();
    service = null;
  });

  it('should support nested values', (done) => {
    service?.onTransition((state) => {
      expect(state.context.values).toMatchObject(values);
      done();
    });
  });

  it('should support setting value using dot notation', (done) => {
    service?.onChange(({ values }) => {
      expect(values.address.line).toBe('No 15');
      done();
    });

    service?.send({
      type: 'set',
      name: 'values',
      value: 'No 15',
      id: 'address.line',
    });
  });
});
