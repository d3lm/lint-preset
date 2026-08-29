/**
 * One violation per rule in `tsSyntaxRulesOxlint`. The rule-ownership test
 * asserts that Oxlint reports every one of them natively and that ESLint
 * reports none. Extra diagnostics from unrelated rules are fine.
 */

// typescript/adjacent-overload-signatures
export interface AdjacentOverloads {
  first(): void;
  second(): void;
  first(input: string): void;
}

// typescript/ban-tslint-comment
/* tslint:disable:no-unused-variable */

// typescript/class-literal-property-style
export class LiteralProperty {
  get literalValue(): string {
    return 'literal';
  }
}

// typescript/consistent-generic-constructors
export const genericConstructor: Map<string, number> = new Map();

// typescript/consistent-indexed-object-style
export interface IndexedObject {
  [key: string]: number;
}

// typescript/consistent-type-assertions (angle-bracket instead of `as`)
declare const unknownInput: unknown;

export const angleBracketAssertion = <string>unknownInput;

// typescript/consistent-type-definitions (prefers interface)
export type TypeAliasShape = {
  name: string;
};

// typescript/no-array-constructor
export const arrayConstructor = new Array(1, 2, 3);

// typescript/no-confusing-non-null-assertion
declare const maybeText: string | null;

export const confusingNonNull = maybeText! === 'text';

// typescript/no-empty-object-type
export type EmptyObject = {};

// typescript/no-extraneous-class
export class StaticOnly {
  static helper(): void {
    console.log('static');
  }
}

// typescript/no-inferrable-types
export const inferrableType: number = 10;

// typescript/no-invalid-void-type
export type InvalidVoidUnion = void | number;

// typescript/no-namespace
export namespace LegacyNamespace {
  export const inside = 1;
}

// typescript/no-non-null-asserted-nullish-coalescing
export function nonNullNullish(input: { source: string | null }): string {
  return input.source! ?? 'fallback';
}

/**
 * typescript/no-require-imports
 *
 * Inside a function so tsserver doesn't offer its convert-to-import
 * suggestion (ts 80005) on the fixture.
 */
export function loadsViaRequire(): unknown {
  return require('node:path');
}

// typescript/no-unnecessary-type-constraint
export function unnecessaryConstraint<T extends any>(value: T): T {
  return value;
}

// typescript/no-unsafe-function-type
export type UnsafeFunctionAlias = Function;

// typescript/no-useless-constructor
export class UselessConstructor {
  constructor() {}
}

// typescript/prefer-for-of
export function forOfCandidate(items: string[]): void {
  for (let index = 0; index < items.length; index += 1) {
    console.log(items[index]);
  }
}

// typescript/prefer-function-type
export interface CallableInterface {
  (input: string): number;
}

// typescript/prefer-literal-enum-member
const computedValue = 2;

export enum ComputedEnum {
  Literal = 1,
  Computed = computedValue,
}

// typescript/unified-signatures
export function unifiable(input: string): void;
export function unifiable(input: string, extra: number): void;
export function unifiable(input: string, extra?: number): void {
  console.log(input, extra);
}

// eslint/no-var
export var varDeclaration = 'var';

// eslint/prefer-const
let neverReassigned = 'constant';
console.log(neverReassigned);

// eslint/prefer-rest-params (`arguments.length` alone is not reported)
export function usesArguments(): string {
  return arguments[0] as string;
}

// eslint/prefer-spread
export function applyCall(items: number[]): number {
  return Math.max.apply(Math, items);
}
