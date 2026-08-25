import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../config';
import { assertEmbeddingShape, toHalfvecLiteral, vectorMagnitude } from './vector-encoding';

const embeddingOf = (fill: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);

describe('the literal Postgres accepts', () => {
  it('renders as a bracketed comma-separated list with no spaces', () => {
    expect(toHalfvecLiteral([0.5, -0.25, 0])).toBe('[0.5,-0.25,0]');
  });

  it('round-trips the values it was given', () => {
    const values = [0.125, -0.5, 0.0625];

    const parsed = JSON.parse(toHalfvecLiteral(values)) as number[];

    expect(parsed).toEqual(values);
  });
});

describe('shape checking before storage', () => {
  it('rejects the wrong number of dimensions', () => {
    // The column would accept a plausible-looking wrong vector and only reveal
    // the mistake as poor retrieval, long after the document was ingested.
    expect(() => assertEmbeddingShape([0.1, 0.2, 0.3])).toThrow(/3 /);
  });

  it('accepts the right number of dimensions', () => {
    expect(() => assertEmbeddingShape(embeddingOf(0.01))).not.toThrow();
  });

  it('rejects a non-finite value, which would poison every distance it takes part in', () => {
    const withNaN = embeddingOf(0.01);
    withNaN[7] = Number.NaN;

    expect(() => assertEmbeddingShape(withNaN)).toThrow(/finite/i);
  });

  it('rejects an infinite value', () => {
    const withInfinity = embeddingOf(0.01);
    withInfinity[3] = Number.POSITIVE_INFINITY;

    expect(() => assertEmbeddingShape(withInfinity)).toThrow(/finite/i);
  });
});

describe('magnitude', () => {
  it('is one for a unit vector', () => {
    expect(vectorMagnitude([1, 0, 0])).toBeCloseTo(1, 10);
    expect(vectorMagnitude([0.6, 0.8])).toBeCloseTo(1, 10);
  });

  it('is zero for a zero vector', () => {
    expect(vectorMagnitude([0, 0, 0])).toBe(0);
  });

  it('lets a caller confirm the provider really returned a normalized vector', () => {
    // Inner product only ranks like cosine while vectors are unit length. If
    // the provider ever stops normalizing, the index silently ranks by
    // magnitude instead of direction.
    const almostUnit = [0.6, 0.8000001];

    expect(vectorMagnitude(almostUnit)).toBeCloseTo(1, 5);
  });
});
