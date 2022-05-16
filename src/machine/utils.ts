import { Validator } from './types';

export type FlattenKeys<T> = {
  [K in keyof T & (string | number)]: RecursiveKeyOfHandleValue<T[K], `${K}`>;
}[keyof T & (string | number)];

type RecursiveKeyOfInner<T> = {
  [K in keyof T & (string | number)]: RecursiveKeyOfHandleValue<T[K], `.${K}`>;
}[keyof T & (string | number)];

type RecursiveKeyOfHandleValue<
  TValue,
  Text extends string
> = TValue extends any[]
  ? Text
  : TValue extends object
  ? Text | `${Text}${RecursiveKeyOfInner<TValue>}`
  : Text;

export type FlattenValues<T> = {
  [K in keyof T & (string | number)]: RecursiveValueOfHandleValue<T[K]>;
}[keyof T & (string | number)];

type RecursiveValueOfInner<T> = {
  [K in keyof T & (string | number)]: RecursiveValueOfHandleValue<T[K]>;
}[keyof T & (string | number)];

type RecursiveValueOfHandleValue<TValue> = TValue extends object
  ? RecursiveValueOfInner<TValue>
  : TValue;

export const isValidator = (x: any): x is Validator<any, any> => {
  return typeof x === 'function';
};

export const flatten = <T>(
  obj: T,
  roots: (keyof T)[] = [],
  sep = '.'
): { [K in keyof T]: Validator } => {
  return Object.keys(obj).reduce((accumulator, k) => {
    const key = k as keyof T;
    const value = obj[key];

    return {
      ...accumulator,
      ...(Object.prototype.toString.call(value) === '[object Object]'
        ? // keep working if value is an object
          flatten(value as any, roots.concat([key]), sep)
        : // include current prop and value and prefix prop with the roots
          { [roots.concat([key]).join(sep)]: value }),
    };
  }, {} as any);
};
