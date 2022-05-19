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
