/**
 * Prepares an embedding for storage, and checks it is worth storing.
 *
 * The shape check is the load-bearing part. A `halfvec(3072)` column rejects
 * the wrong length, but only once the statement runs — and nothing rejects a
 * vector of the right length full of noise. Checking here turns a silent
 * retrieval failure, discovered weeks later as "the assistant cannot find
 * things in my document", into an ingestion error naming the document.
 */

import { EMBEDDING_DIMENSIONS } from '../config';

/** Euclidean length. One for a normalized vector. */
export function vectorMagnitude(values: number[]): number {
  let sumOfSquares = 0;
  for (const value of values) sumOfSquares += value * value;
  return Math.sqrt(sumOfSquares);
}

export function assertEmbeddingShape(values: number[]): void {
  if (values.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${values.length} dimensions, expected ${EMBEDDING_DIMENSIONS}. ` +
        'Storing it would leave the index ranking against a different space.',
    );
  }

  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      // One non-finite component poisons every distance the vector takes part
      // in, so the damage is not limited to the chunk that carries it.
      throw new Error(
        `Embedding contains a non-finite value at position ${index}: ${values[index]}.`,
      );
    }
  }
}

/**
 * pgvector's text form: a bracketed, comma-separated list. Spaces are legal but
 * pure overhead at 3072 values a row.
 */
export function toHalfvecLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
