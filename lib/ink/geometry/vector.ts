/**
 * A two-dimensional vector, immutable, with just the operations the pen and
 * highlighter geometry needs.
 *
 * It stands in for js-draw's `Vec2`, so the geometry can run without js-draw
 * (and in Node). The arithmetic is written the way `Vec2` does it -- a unit
 * vector divides by the length rather than multiplying by its inverse -- so a
 * stroke comes out to the last bit as it did when it was drawn with `Vec2`.
 * `tests/ink-geometry-golden.test.ts` holds that to account.
 */
export type InkVector = { readonly x: number; readonly y: number };

export class Vec {
  private constructor(
    readonly x: number,
    readonly y: number
  ) {}

  static of(x: number, y: number): Vec {
    return new Vec(x, y);
  }

  plus(other: InkVector): Vec {
    return new Vec(this.x + other.x, this.y + other.y);
  }

  minus(other: InkVector): Vec {
    return new Vec(this.x - other.x, this.y - other.y);
  }

  times(factor: number): Vec {
    return new Vec(this.x * factor, this.y * factor);
  }

  dot(other: InkVector): number {
    return this.x * other.x + this.y * other.y;
  }

  magnitude(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  distanceTo(other: InkVector): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  normalized(): Vec {
    const length = this.magnitude();
    return new Vec(this.x / length, this.y / length);
  }
}

/**
 * The points a stroke's bounding box is the box of, and how far it is grown
 * past them: half the stroke's width for a pen, the nib's half-width for a
 * highlighter.
 */
export type InkExtent = {
  points: readonly InkVector[];
  margin: number;
};
