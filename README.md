# Elderform

> Form handling without tears and predictable form state based on defined parameters. Elderform gives you everything you need to create robust forms and stays out of your way.

![npm bundle size](https://img.shields.io/bundlephobia/minzip/elderform) ![npm](https://img.shields.io/npm/v/elderform) ![npm](https://img.shields.io/npm/dt/elderform)

### Features

- Async validation
- Create reusable forms
- Predictable form state
- Cancel form submission
- Full typescript support
- Lazy schema initialisation
- Tiny: fully packed in just ~5kb
- Framework agnostic <!-- (with wrappers for X) -->
- Ships with sensible defaults for form handling
- > No more "how do I prevent multple submission while currently submitting"

### Quick start

```
pnpm add xstate elderform
```

```ts
import * as z from 'zod';
import {createForm, object} from 'elderform';

const form = createForm({
  schema: object({
    name: val => z.string().parse(val),
  }),
  onSubmit: () => {
    return Promise.resolve();
  },
});

form.subscribe((state) => {
  ...
});

form.submit();
```

- [Quick start](#quick-start)
- [API](#api)
- [Nested schema](#nested-schema)
- [Examples](#examples)

## API

`createForm(config)`

- `config` (object) - config object from creating the form state machine (see below)

### Config:

- `schema?` (boolean | object) - object containing functions or `false` to disable schema validation
  - The schema by default is immutable, you can't change the schema after setting it initialy or by calling `form.set("schema", {...})`.
- `initialValues?` (object) - initial form values
- `onSubmit(values: object)` - an async function that handles form submission

### Returns:

An object which provides

- `submit` ((...ignore?: string[]) => void) - a function to submit the form
- `reset` - a function to reset the form state to its initial state
- `cancelSubmit` (() => void) - function to cancel the current form submission
- `submitAsync` - async version of submit and resolves with the submission result
- `subscribe` ((stateListener) => () => void) - a state listener with the current state of the form (see below for [stateListener](#state-listener))
- `__service` - the base service (xstate interpreter), made available for library authors to creating wrappers for frameworks
- `validate` ((field, value?) => void) - function to validate given field
<!-- - `set` ((name, value) => void) - function to set values for `data`, `error`, `errors`, `schema` or `values` -->
- `spawn` ((name, value, validator) => void) - An escape hatch to spawn new fields not specified in the schema. (useful for creating dynamic forms)
- `kill` ((name) => void) - A function to kill a `spawned` field

---

### State Listener

`subscribe(`[currentState](#currentState)`)`

#### `currentState`

- state - [Form State](#form-state)

- Boolean flags derived from form `state` value

  - `isIdle`
  - `isValidating`
  - `isSubmitting`
  - `submitted`
  - `isError`
  - `isSuccess` - similar to `submitted`

- Others
  - `values` (object) - form values (Defaults to an empty object)
  - `data` (TData | null)
    - Defaults to `undefined`
    - The last data returned from successfully submission
  - `error` (TError | null)
    - Defaults to `undefined`
    - The error object last from submission, if an error was thrown
  - `errors` (Record<string, TErrors>) - an object of errors for each field after validation
  - `dataUpdatedAt` (number) -
    The timestamp for when the form most recently submitted successfully and returned data (Defaults to `0`)
  - `errorUpdatedAt` (number) -
    The timestamp for when the form most recently failed to submit successfully and returned error (Defaults to `0`).

### Form State

- `idle` - when the form isn't actively performing any operation
- `validating` - when the defined schema is being validated
- `submitting` - when the is being submitted
- `submitted` - if the form submitted successfully without any error
- `error` - if the submission attempt resulted in an error. The error is contained in the corresponding error property

### Field State

- `idle` - when the field is not performing any action
- `validating` - when the field is validating
- `success` - if the field was validated successfully
- `failed` - if the field failed validation

## Examples

- [Basic](https://codesandbox.io/s/elderform-basic-jtwff)
- [Async validation](https://codesandbox.io/s/elderform-async-validation-e1twr?file=/src/index.ts)

## Nested schema

```ts
const form = createForm({
  initialValues: {
    age: 10,
    name: {
      last: '',
      first: '',
      middle: '',
    },
    mother: {
      name: {
        last: '',
        first: '',
        middle: '',
      },
    },
  },
  onSubmit: () => {
    return Promise.resolve();
  },
});

form.subscribe((state) => {
  ...
});
```
