/**
 * One violation per rule in `tsTypeAwareRulesOxlint`. The rule-ownership test
 * asserts that Oxlint (via tsgolint) reports every one of them and that
 * ESLint reports none. Extra diagnostics from unrelated rules are fine.
 */

declare const anyValue: any;

// typescript/no-floating-promises
Promise.resolve('floating');

// typescript/no-confusing-void-expression
export const confusingVoid = console.log('void');

/**
 * typescript/no-deprecated
 *
 * @deprecated use somethingElse instead
 */
export function deprecatedFunction(): void {}
deprecatedFunction();

// typescript/no-misused-promises (promise-returning callback in a void position)
export function runEach(items: number[]): void {
  items.forEach(async (item) => {
    await Promise.resolve(item);
  });
}

// typescript/no-mixed-enums
export enum MixedEnum {
  Numeric = 0,
  Text = 'text',
}

// typescript/no-unnecessary-boolean-literal-compare
export function booleanLiteralCompare(flag: boolean): boolean {
  return flag === true;
}

// typescript/no-unnecessary-condition
export function unnecessaryCondition(text: string): string {
  return text ?? 'fallback';
}

// typescript/no-unnecessary-template-expression
export const unnecessaryTemplate = `${'literal'}`;

// typescript/no-unnecessary-type-arguments
export function defaultedGeneric<T = number>(value: T): T {
  return value;
}

export const explicitDefaultTypeArgument = defaultedGeneric<number>(1);

// typescript/no-unnecessary-type-assertion
declare const definitelyString: string;

export const unnecessaryAssertion = definitelyString as string;

// typescript/no-unnecessary-type-conversion
export const unnecessaryConversion = String('already a string');

// typescript/no-unnecessary-type-parameters
export function singleUseTypeParameter<T>(values: T[]): number {
  return values.length;
}

// typescript/no-unsafe-argument
export function takesString(text: string): void {
  console.log(text);
}

takesString(anyValue);

// typescript/no-unsafe-assignment
export const unsafeAssignment: string = anyValue;

// typescript/no-unsafe-call
anyValue();

// typescript/no-unsafe-member-access
console.log(anyValue.property);

// typescript/no-unsafe-return
export function unsafeReturn(): string {
  return anyValue;
}

// typescript/no-unsafe-enum-comparison
export enum Fruit {
  Apple,
  Banana,
}

declare const fruit: Fruit;

export const enumComparison = fruit === 0;

// typescript/non-nullable-type-assertion-style
export function nonNullableAssertionStyle(maybe: string | undefined): string {
  return maybe as string;
}

// typescript/only-throw-error
export function throwsString(): never {
  throw 'not an error';
}

// typescript/prefer-find
export const firstMatch = [1, 2, 3].filter((n) => n > 1)[0];

// typescript/prefer-includes
export const hasItem = [1, 2, 3].indexOf(2) !== -1;

// typescript/prefer-nullish-coalescing (with ignorePrimitives, objects still report)
export interface FallbackShape {
  name: string;
}

export function nullishCoalescing(input: FallbackShape | null | undefined, fallback: FallbackShape): FallbackShape {
  return input || fallback;
}

// typescript/prefer-optional-chain
export interface Nested {
  child?: {
    value: number;
  };
}

export function optionalChain(nested: Nested): number | undefined {
  return nested.child && nested.child.value;
}

// typescript/prefer-promise-reject-errors
export const rejected = Promise.reject('reason');

// typescript/prefer-reduce-type-parameter
export const reduced = [1, 2, 3].reduce((accumulator: number[], current) => {
  return [...accumulator, current];
}, [] as number[]);

// typescript/prefer-regexp-exec
export const matched = 'input text'.match(/text/);

// typescript/prefer-return-this-type
export class FluentBuilder {
  private _count = 0;

  increment(): FluentBuilder {
    this._count += 1;

    return this;
  }
}

// typescript/prefer-string-starts-ends-with
export function startsWithHash(text: string): boolean {
  return text.charAt(0) === '#';
}

// typescript/related-getter-setter-pairs
export class GetterSetter {
  private _stored = '';

  get value(): string {
    return this._stored;
  }

  set value(next: number) {
    this._stored = String(next);
  }
}

// typescript/restrict-plus-operands
export function plusOperands(count: number, label: string): string {
  return count + label;
}

// typescript/return-await (error-handling-correctness-only: must await inside try)
export async function returnInsideTry(): Promise<string> {
  try {
    return Promise.resolve('inside try');
  } catch {
    return 'caught';
  }
}

// typescript/use-unknown-in-catch-callback-variable
export const caught = Promise.resolve('ok').catch((error: Error) => {
  console.error(error);
});
