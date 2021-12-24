import { Schema } from './types';

export const object = <T, S extends Schema<T>>(shape: S): S => shape;
