import { canonicalJson } from '../src/audit/canonical-json';

describe('canonicalJson (spec 0007 hash-input contract)', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('is independent of key insertion order', () => {
    const one = canonicalJson({ x: 1, y: [{ b: 2, a: 3 }] });
    const two = canonicalJson({ y: [{ a: 3, b: 2 }], x: 1 });
    expect(one).toBe(two);
  });

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('drops undefined object members, nulls undefined array slots', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([1, undefined, 2])).toBe('[1,null,2]');
  });

  it('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(0)).toBe('0');
    expect(canonicalJson(false)).toBe('false');
  });

  it('emits no structural whitespace (string contents untouched)', () => {
    expect(canonicalJson({ a: [1, { b: 'c d' }] })).toBe('{"a":[1,{"b":"c d"}]}');
  });
});
