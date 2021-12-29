import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { Context, Events, EventTypes, machine, States } from '../src/machine';

const schema = z.object({
  name: z.string(),
});

type Form = z.infer<typeof schema>;

const def = machine<Form, any, any>();

const ctx: Context<Form, any, any> = {
  ...def.context,
  values: {},
};

let service: Interpreter<
  Context<Form, any, any>,
  any,
  Events<Form, any, any>,
  States<Form, any, any>
>;

describe('machine', () => {
  beforeEach(() => {
    service = interpret(def.withContext({ ...ctx, errors: new Map() })).start();
  });

  it('should initialise to waitingInit state given no schema provided', (done) => {
    service.onTransition((state) => {
      if (state.matches('waitingInit')) done();
    });
  });

  it('should initialise to idle state', (done) => {
    service = interpret(
      def.withContext({ ...ctx, schema, errors: new Map() })
    ).start();

    service.onTransition((state) => {
      if (state.matches('idle')) done();
    });
  });

  it('should lazily initialise idle state with schema', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('waitingInit')) {
        expect(state.context.schema).toBeDefined();
        done();
      }
    });

    setTimeout(() => {
      service.send({ type: EventTypes.SET, name: 'schema', value: schema });
    }, 1000);
  });

  it('should have default values', (done) => {
    service = interpret(
      def.withContext({
        ...ctx,
        schema,
        errors: new Map(),
        values: { name: 'Joe' },
      })
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
    service = interpret(
      def.withContext({ ...ctx, schema, errors: new Map() })
    ).start();
  });

  it('should validate field with error', (done) => {
    service.onTransition(({ context }, e) => {
      if (e.type === 'FAIL') {
        expect(context.errors.get('name')).toBeDefined();
        done();
      }
    });

    service.send({ type: EventTypes.VALIDATE, id: 'name' });
  });

  it('should validate field without error', (done) => {
    service.onTransition(({ context }, e) => {
      if (e.type === 'SUCCESS') {
        expect(context.errors.get('name')).not.toBeDefined();
        done();
      }
    });

    service.send({
      id: 'name',
      value: 'Joe',
      type: EventTypes.CHANGE_WITH_VALIDATE,
    });
  });
});

describe('submission', () => {
  let _ctx: Context<Form>;

  beforeEach(() => {
    _ctx = {
      ...ctx,
      schema,
      errors: new Map(),
      __validationMarker: new Set(),
    };
  });

  it('should submit without error', (done) => {
    service = interpret(
      def.withContext({ ..._ctx, values: { name: 'Joe' } }).withConfig({
        services: {
          submit: () => Promise.resolve({}),
        },
      })
    ).start();

    service.onTransition((state) => {
      if (state.matches('submitted')) {
        expect(state.context.error).toBeNull();
        done();
      }
    });

    service.send(EventTypes.SUBMIT);
  });

  it('should submit with error', (done) => {
    service = interpret(
      def.withContext({ ..._ctx, values: { name: 'Joe' } }).withConfig({
        services: {
          submit: () => Promise.reject(new Error()),
        },
      })
    ).start();

    service.onTransition((state, e) => {
      if (state.matches('error')) {
        expect(state.context.error).toBeDefined();
        expect(state.context.error).toBeInstanceOf(Error);
        done();
      }
    });

    service.send(EventTypes.SUBMIT);
  });

  it('should not submit due to validation error', (done) => {
    service = interpret(def.withContext(_ctx)).start();

    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('validating')) {
        expect(state.context.errors.get('name')).toBeDefined();
        done();
      }
    });

    service.send(EventTypes.SUBMIT);
  });

  it('should bailout on submission if any field has error', (done) => {
    service = interpret(
      def.withContext(_ctx).withConfig({
        actions: {
          onSubmitWithErrors: () => done(),
        },
      })
    ).start();

    service.onTransition((_, e) => {
      if (e.type === 'FAIL') service.send(EventTypes.SUBMIT);
    });

    service.send({ id: 'name', type: EventTypes.VALIDATE });
  });
});

describe('setting values', () => {
  beforeEach(() => {
    service = interpret(def.withContext(ctx)).start();
  });

  it('should set values', (done) => {
    const schema = z.object({
      age: z.number(),
      name: z.string(),
    });

    type Form = z.infer<typeof schema>;

    const def = machine<Form, any, any>();

    const ctx: Context<Form, any, any> = {
      ...def.context,
      values: {},
    };

    let value: Form = { age: 20, name: 'John' };

    let service = interpret(def.withContext({ ...ctx, schema })).start();

    service.onChange((ctx) => {
      expect(ctx.values).toMatchObject(value);
      done();
    });

    service.send({ value, name: 'values', type: EventTypes.SET });
  });

  it('should set errors', (done) => {
    service = interpret(def.withContext(ctx)).start();

    service.onChange((ctx) => {
      expect(ctx.errors).toMatchObject(new Map([['name', 'some error']]));
      done();
    });

    service.send({
      name: 'errors',
      type: EventTypes.SET,
      value: new Map([['name', 'some error']]),
    });
  });

  it('should set error', (done) => {
    service = interpret(def.withContext(ctx)).start();

    service.onChange((ctx) => {
      expect(ctx.error).toBeInstanceOf(Error);
      done();
    });

    service.send({ value: new Error(), name: 'error', type: EventTypes.SET });
  });

  it('should set data', (done) => {
    service = interpret(def.withContext(ctx)).start();

    service.onChange((ctx) => {
      expect(ctx.data).toMatchObject({ status: 200 });
      done();
    });

    service.send({
      name: 'data',
      type: EventTypes.SET,
      value: { status: 200 },
    });
  });

  it('should not unset schema', (done) => {
    service = interpret(def.withContext({ ...ctx, schema })).start();

    service.onChange((ctx) => {
      expect(ctx.schema).toBeDefined();
      expect(ctx.schema).toMatchObject(schema);
      done();
    });

    service.send({
      name: 'schema',
      value: null as any,
      type: EventTypes.SET,
    });
  });
});

describe('disable schema', () => {
  beforeEach(() => {
    service = interpret(def.withContext({ ...ctx, schema: false })).start();
  });

  it('should disable schema and not create actors', (done) => {
    service.onTransition((state) => {
      expect(state.value).toBe('idle');
      expect(state.context.schema).toBe(false);
      expect(state.context.actors).toBeUndefined();
      expect(state.context.states).toBeUndefined();
      done();
    });
  });

  it('should never validate', (done) => {
    service = interpret(
      def
        .withContext({
          ...ctx,
          schema: false,
          errors: new Map(),
        })
        .withConfig({
          services: {
            submit: () => Promise.resolve({}),
          },
        })
    ).start();

    service.onTransition((state) => {
      expect(state.matches('validating')).toBe(false);
      if (state.matches('submitted')) done();
    });

    service.send(EventTypes.SUBMIT);
  });
});
