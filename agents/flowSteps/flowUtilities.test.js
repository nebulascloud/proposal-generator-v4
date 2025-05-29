const { parseJson, deepClone, removeUndefined } = require('./flowUtilities');

describe('flowUtilities', () => {
  describe('parseJson', () => {
    it('throws on invalid JSON', () => {
      expect(() => parseJson('{a:1}')).toThrow();
    });
    it('throws on non-string input', () => {
      expect(() => parseJson(123)).toThrow();
    });
    it('throws on empty string', () => {
      expect(() => parseJson('')).toThrow();
    });
    it('parses valid JSON', () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    });
  });

  describe('deepClone', () => {
    it('clones objects deeply', () => {
      const obj = { a: 1, b: { c: 2 } };
      const clone = deepClone(obj);
      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.b).not.toBe(obj.b);
    });
    it('clones arrays deeply', () => {
      const arr = [1, { a: 2 }];
      const clone = deepClone(arr);
      expect(clone).toEqual(arr);
      expect(clone).not.toBe(arr);
      expect(clone[1]).not.toBe(arr[1]);
    });
  });

  describe('removeUndefined', () => {
    it('removes undefined from objects', () => {
      const obj = { a: 1, b: undefined, c: { d: undefined, e: 2 } };
      expect(removeUndefined(obj)).toEqual({ a: 1, c: { e: 2 } });
    });
    it('removes undefined from arrays', () => {
      const arr = [1, undefined, 2, undefined, 3];
      expect(removeUndefined(arr)).toEqual([1, 2, 3]);
    });
    it('handles nested structures', () => {
      const data = [{ a: undefined, b: 2 }, undefined, { c: 3 }];
      expect(removeUndefined(data)).toEqual([{ b: 2 }, { c: 3 }]);
    });
    it('returns primitives unchanged', () => {
      expect(removeUndefined(5)).toBe(5);
      expect(removeUndefined(null)).toBe(null);
      expect(removeUndefined(undefined)).toBe(undefined);
    });
  });
});
