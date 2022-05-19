import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { config, Ctx, Events, States } from '../src/machine';

let service: Interpreter<Ctx, any, Events, States> | null;

const def = config({}, async () => {});

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
    const def = config({ name: 'Joe' }, async () => {});
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
      value: 1,
      id: 'name',
      type: 'spawn',
      validator: (v) => z.string().parseAsync(v),
    });

    service?.onTransition(({ context, value }) => {
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
      validator: (v) => z.string().parseAsync(v),
    });

    service?.onTransition(({ context }) => {
      if (context.states.name === 'success') {
        expect(context.errors.name).not.toBeDefined();
        done();
      }
    });

    service?.send({ id: 'name', type: 'validate' });
  });
});

describe('submission', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterEach(() => {
    service = null;
  });

  it('should submit without error', (done) => {
    service?.onTransition((state) => {
      if (state.matches('submitted')) {
        expect(state.context.error).toBeNull();
        done();
      }
    });

    service?.send('submit');
  });

  it('should submit with error', (done) => {
    const def = config({}, async () => {
      throw new Error('error');
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
      validator: (v) => z.string().parseAsync(v),
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
    let defined = false;

    service?.onChange(({ actors }) => {
      if (defined) {
        expect(actors[id]).toBeUndefined();
        done();
        return;
      }

      defined = true;
      service?.send({ id, type: 'kill' });
    });

    service?.send({
      id,
      value: 'Joe',
      type: 'spawn',
      validator: (v) => z.string().parse(v),
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
    const def = config(values, async () => {});
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

    service?.send({ type: 'set', value: 'No 15', id: 'address.line' });
  });
});
