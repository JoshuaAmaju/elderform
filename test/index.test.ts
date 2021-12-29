import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { Context, Events, EventTypes, machine, States } from '../src/machine';

const schema = z.object({
  name: z.string(),
});

type Form = z.infer<typeof schema>;

const def = machine<Form, any, any>();

const ctx: Context<Form, any, any> = def.context;

let service: Interpreter<
  Context<Form, any, any>,
  any,
  Events<Form, any, any>,
  States<Form, any, any>
> | null;

const submit = () => Promise.resolve({});

describe('machine', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterAll(() => {
    service = null;
  });

  it('should initialise to waitingInit state given no schema provided', (done) => {
    service?.onTransition((state) => {
      if (state.matches('waitingInit')) done();
    });
  });

  it('should initialise to idle state', (done) => {
    const service = interpret(def.withContext({ ...ctx, schema })).start();

    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('should lazily initialise idle state with schema', (done) => {
    service?.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('waitingInit')) {
        expect(state.context.schema).toBeDefined();
        done();
      }
    });

    setTimeout(() => {
      service?.send({ type: EventTypes.Set, name: 'schema', value: schema });
    }, 1000);
  });

  it('should have default values', (done) => {
    const service = interpret(
      def.withContext({ ...ctx, schema, values: { name: 'Joe' } })
    ).start();

    service.onTransition(({ context: ctx }) => {
      expect(ctx.values).toBeDefined();
      expect(ctx.values).toMatchObject({ name: 'Joe' });
      done();
    });
  });
});

describe('field validation', () => {
  beforeEach(() => {
    service = interpret(def.withContext({ ...ctx, schema })).start();
  });

  afterAll(() => {
    service = null;
  });

  it('should validate field with error', (done) => {
    service?.onTransition(({ context }, e) => {
      if (e.type === 'FAIL') {
        expect(context.errors.get('name')).toBeDefined();
        done();
      }
    });

    service?.send({ type: EventTypes.Validate, id: 'name' });
  });

  it('should validate field without error', (done) => {
    service?.onTransition(({ context }, e) => {
      if (e.type === 'SUCCESS') {
        expect(context.errors.get('name')).not.toBeDefined();
        done();
      }
    });

    service?.send({
      id: 'name',
      value: 'Joe',
      type: EventTypes.ChangeWithValidate,
    });
  });
});

describe('submission', () => {
  let _ctx: Context<Form>;

  beforeEach(() => {
    _ctx = { ...ctx, schema };
  });

  it('should submit without error', (done) => {
    const service = interpret(
      def.withContext({ ..._ctx, values: { name: 'Joe' } }).withConfig({
        services: { submit },
      })
    ).start();

    service.onTransition((state) => {
      if (state.matches('submitted')) {
        expect(state.context.error).toBeNull();
        done();
      }
    });

    service.send(EventTypes.Submit);
  });

  it('should submit with error', (done) => {
    const service = interpret(
      def.withContext({ ..._ctx, values: { name: 'Joe' } }).withConfig({
        services: { submit: () => Promise.reject(new Error()) },
      })
    ).start();

    service.onTransition((state) => {
      if (state.matches('error')) {
        expect(state.context.error).toBeDefined();
        expect(state.context.error).toBeInstanceOf(Error);
        done();
      }
    });

    service.send(EventTypes.Submit);
  });

  it('should not submit due to validation error', (done) => {
    const service = interpret(def.withContext(_ctx)).start();

    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.errors.get('name')).toBeDefined();
        done();
      }
    });

    service.send(EventTypes.Submit);
  });

  it('should bailout on submission if any field has error', (done) => {
    const service = interpret(
      def.withContext(_ctx).withConfig({
        actions: { onSubmitWithErrors: () => done() },
      })
    ).start();

    service.onTransition((_, e) => {
      if (e.type === 'FAIL') service.send(EventTypes.Submit);
    });

    service.send({ id: 'name', type: EventTypes.Validate });
  });

  it('should ignore specified fields', (done) => {
    const service = interpret(
      def.withContext(_ctx).withConfig({
        services: { submit },
      })
    ).start();

    service.onTransition((state) => {
      console.log(state.value);
      expect(state.context.states.name).toBe('idle');
      if (state.matches('submitted')) done();
    });

    service.send({ type: EventTypes.Submit, ignore: ['name'] });
  });

  it('should skip verification given we are skipping all fields', (done) => {
    const schema = z.object({
      age: z.number(),
      name: z.string(),
    });

    type Form = z.infer<typeof schema>;

    const def = machine<Form, any, any>();

    let service = interpret(
      def.withContext({ ...def.context, schema })
    ).start();

    service.onTransition((state) => {
      expect(state.context.states).toMatchObject({ age: 'idle', name: 'idle' });
      expect(state.matches('validating')).toBe(false);
      if (state.matches('submitted')) done();
    });

    service.send({ type: EventTypes.Submit, ignore: ['name', 'age'] });
  });
});

describe('setting values', () => {
  beforeEach(() => {
    service = interpret(def).start();
  });

  afterAll(() => {
    service = null;
  });

  it('should set values', (done) => {
    const schema = z.object({
      age: z.number(),
      name: z.string(),
    });

    type Form = z.infer<typeof schema>;

    const def = machine<Form, any, any>();

    let value: Form = { age: 20, name: 'John' };

    let service = interpret(
      def.withContext({ ...def.context, schema, errors: new Map() })
    ).start();

    service.onChange((ctx) => {
      expect(ctx.values).toMatchObject(value);
      done();
    });

    service.send({ value, name: 'values', type: EventTypes.Set });
  });

  it('should set errors', (done) => {
    service?.onChange((ctx) => {
      expect(ctx.errors).toMatchObject(new Map([['name', 'some error']]));
      done();
    });

    service?.send({
      name: 'errors',
      type: EventTypes.Set,
      value: new Map([['name', 'some error']]),
    });
  });

  it('should set error', (done) => {
    service?.onChange((ctx) => {
      expect(ctx.error).toBeInstanceOf(Error);
      done();
    });

    service?.send({ value: new Error(), name: 'error', type: EventTypes.Set });
  });

  it('should set data', (done) => {
    service?.onChange((ctx) => {
      expect(ctx.data).toMatchObject({ status: 200 });
      done();
    });

    service?.send({
      name: 'data',
      type: EventTypes.Set,
      value: { status: 200 },
    });
  });

  it('should not unset schema', (done) => {
    const service = interpret(def.withContext({ ...ctx, schema })).start();

    service.onChange((ctx) => {
      expect(ctx.schema).toBeDefined();
      expect(ctx.schema).toMatchObject(schema);
      done();
    });

    service.send({
      name: 'schema',
      value: null as any,
      type: EventTypes.Set,
    });
  });
});

describe('disable schema', () => {
  beforeEach(() => {
    service = interpret(
      def.withContext({ ...ctx, schema: false }).withConfig({
        services: { submit },
      })
    ).start();
  });

  // afterAll(() => {
  //   service = null;
  // });

  it('should disable schema and not create actors', (done) => {
    service?.onTransition((state) => {
      expect(state.value).toBe('idle');
      expect(state.context.schema).toBe(false);
      expect(state.context.actors).toBeUndefined();
      expect(state.context.states).toBeUndefined();
      done();
    });
  });

  it('should never validate', (done) => {
    service?.onTransition((state) => {
      expect(state.matches('validating')).toBe(false);
      if (state.matches('submitted')) done();
    });

    service?.send(EventTypes.Submit);
  });
});
