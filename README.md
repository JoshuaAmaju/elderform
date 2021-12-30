# Popform

> Form handling without tears and predictable form state based on defined parameters

### Popform gives you everything you need to create robust forms and stays out of your way, while still having a small footprint.

### Features

- Async validation
- Predictable form state
- Full typescript support
- Lazy schema initialisation
- Tiny: fully packed in just ~5kb
- Framework agnostic <!-- (with wrappers for X) -->
- Ships with sensible defaults for form handling
- > No more "how do I prevent multple submission while currently submitting"

### Quick start

```
pnpm add xstate zod popform
```

```ts
import * as z from 'zod';
import {createForm} from 'popform';

const form = createForm({
  schema: z.object({
    name: z.string(),
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
- [Examples](#examples)

## API

`createForm(config)`

- `config` (object) - config object from creating the form state machine (see below)

### Returns:

An object which providess

- `form.state` (idle) - the form's initial state
- `form.submit` ((...ignore?: string[]) => void) - a function to submit the form
- `form.subscribe` ((stateListener) => () => void) - a state listener with the current state of the form (see below for [stateListener](#state-listener))
- `form.__service` - the base service (xstate interpreter), made available for library authors to creating wrappers for frameworks
- `form.validate` ((field) => void) - function to validate given field
- `form.set` ((name, value) => void) - function to set values for `data`, `error`, `errors`, `schema` or `values`
- `form.setField` ((name, value) => void) - function to set value of given fields in schema

### Config:

- `schema?` (boolean | object) - a zod object (see [here](https://www.npmjs.com/package/zod) for documentation) or `false` to disable schema validation
- `onSubmit(values: object)` - an async function that handles form submission

---

### State Listener

`form.subscribe(`[currentState](#currentState), [handlers](#handlers)`)`

#### `currentState`

- state - [Form State](#form-state)

- Boolean flags derived from form `state`

  - `isIdle`
  - `isValidating`
  - `isSubmitting`
  - `isSuccess`
  - `submitted` - similar to `isSuccess`
  - `isError`
  - `validatedWithErrors` - derived from validating state and if errors property is not empty
  - `submittedWithoutError` - derived from submitted state and if errors property is empty
  - `submittedWithError` - derived from error state and if errors property is not empty.

- Others
  - `values` (object) - form values (Defaults to an empty object)
  - `data` (TData | null)
    - Defaults to `undefined`
    - The last data returned from successfully submission
  - `error` (TError | null)
    - Defaults to `undefined`
    - The error object last from submission, if an error was thrown
  - `errors` (Map<string, string>) - a map containing errors for each field after validation
  - `dataUpdatedAt` (number) -
    The timestamp for when the form most recently submitted successfully and returned data (Defaults to `0`)
  - `errorUpdatedAt` (number) -
    The timestamp for when the form most recently failed to submit successfully and returned error (Defaults to `0`).

#### `handlers`

An `object` containing handlers for each field present in the schema

| key                        | type                        |
| -------------------------- | --------------------------- |
| `state`                    | [Field State](#field-state) |
| `value`                    | `T` or `null`               |
| `set` or `setWithValidate` | `(value: T) => void`        |
| `validate`                 | `() => void`                |

---

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
