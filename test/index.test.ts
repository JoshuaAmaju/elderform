import { interpret, Interpreter } from 'xstate';
import * as z from 'zod';
import { Context, Events, machine, States, EventTypes } from '../src/machine';
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

  it('should lazily initialise idle state with schema', (done) => {
    service.onTransition((state) => {
      if (state.matches('idle') && state.history?.matches('waitingInit')) {
        expect(state.context.schema).toBeDefined();
        done();
      }
    });

    setTimeout(() => {
      service.send({ type: EventTypes.SET, name: 'schema', value: schema });
    }, 2000);
  });

  it('should have default values', (done) => {
    service = interpret(
      def.withContext({
        ...ctx,
        schema,
        values: { name: 'Joe' },
      })
    ).start();

    service.onTransition(({ context: ctx }) => {
      expect(ctx.values).toBeDefined();
      expect(ctx.values).toMatchObject({ name: 'Joe' });
      done();
    });
  });

  describe('field validation', () => {
    beforeEach(() => {
      service = interpret(def.withContext({ ...ctx, schema })).start();
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
    it('should submit without error', (done) => {
      service = interpret(
        def.withContext({ ...ctx, schema }).withConfig({
          services: {
            submit: () => Promise.resolve({}),
          },
        })
      ).start();
    });

    it('should submit with error', (done) => {});
  });
});
