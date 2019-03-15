import { MapFn, toArray, toMap } from './aggregates.ts';

// Helpers types.

/**
 * A function that maps one type to another, and is given the index that
 * the iterator is currently on.
 */
export type IndexMapFn<TSource, TResult> = (
  source: TSource,
  index: number,
) => TResult;
/**
 * A function that combines 2 types into another.
 */
export type CombineFn<TFirst, TSecond, TResult> = (
  first: TFirst,
  second: TSecond,
) => TResult;
/**
 * A function that takes in 2 values and returns the sorting number.
 */
export type SortFn<TSource> = (a: TSource, b: TSource) => number;
/**
 * A function that takes in a value and an index and returns a boolean.
 */
export type IndexPredicate<TSource> = (
  element: TSource,
  index: number,
) => boolean;
/**
 * A function that takes in a value and an index and returns whether the
 * value is of a given type.
 */
export type IndexIsPredicate<TSource, TResult extends TSource> = (
  element: TSource,
  index: number,
) => element is TResult;

/**
 * A grouping of elements based on the key.
 */
export interface IGrouping<TKey, TElement> {
  key: TKey;
  elements: Iterable<TElement>;
}

// Helper classes.

/**
 * @hidden
 */
class Queue<T> {
  /**
   * For smaller iterators, we can leave the indices behind, but just
   * with a value of undefined, as this is much quicker.
   * However, for larger iterators, we need to make sure the indices
   * don't build up too much, so we delete indices after this point.
   */
  private static readonly maxLeftOverIndices = 10000;

  private _buffer: T[] = [];
  private _front = 0;

  public get length(): number {
    return this._buffer.length - this._front;
  }

  public enqueue(element: T): void {
    this._buffer.push(element);
  }

  public dequeue(): T {
    const length = this._buffer.length;
    if (length === 0) {
      throw new Error('Cannot dequeue an empty queue');
    }

    const element = this._buffer[this._front];

    if (length >= Queue.maxLeftOverIndices) {
      delete this._buffer[this._front];
    } else {
      this._buffer[this._front] = undefined as any;
    }

    this._front++;
    return element;
  }
}

// Base Iterators

/**
 * @hidden
 */
export class LazyRangeIterator implements Iterator<number> {
  private _index: number;
  private readonly _direction: number;

  public constructor(_start: number, private readonly _end: number) {
    this._index = _start;
    this._direction = _end < _start ? -1 : 1;
  }

  public next(): IteratorResult<number> {
    if (
      this._direction > 0 ? this._index >= this._end : this._index <= this._end
    ) {
      return { done: true, value: undefined as any };
    } else {
      const nextResult = { done: false, value: this._index };
      this._index += this._direction;
      return nextResult;
    }
  }
}

/**
 * @hidden
 */
export class LazyRepeatIterator<TElement> implements Iterator<TElement> {
  private _index = 0;

  public constructor(
    private readonly _element: TElement,
    private readonly _count: number,
  ) {}

  public next(): IteratorResult<TElement> {
    if (this._index >= this._count) {
      return { done: true, value: undefined as any };
    } else {
      const nextResult = { done: false, value: this._element };
      this._index++;
      return nextResult;
    }
  }
}

// Iterators

/**
 * @hidden
 */
export class LazyAppendPrependIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _started = false;
  private _finished = false;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _element: TElement,
    private readonly _atStart: boolean,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    if (!this._started) {
      this._started = true;

      if (this._atStart) {
        return { done: false, value: this._element };
      }
    }

    if (this._finished) {
      return { done: true, value: undefined as any };
    }

    const result = this._iterator.next();

    if (result.done) {
      this._finished = true;

      if (!this._atStart) {
        return { done: false, value: this._element };
      } else {
        return { done: true, value: undefined as any };
      }
    } else {
      return result;
    }
  }
}

/**
 * @hidden
 */
export class LazyConcatIterator<TElement> implements Iterator<TElement> {
  private readonly _iterators: Array<Iterator<TElement>> = [];
  private _current = 0;

  public constructor(iterables: Array<Iterable<TElement>>) {
    for (const iterable of iterables) {
      this._iterators.push(iterable[Symbol.iterator]());
    }
  }

  public next(): IteratorResult<TElement> {
    if (this._current >= this._iterators.length) {
      return { done: true, value: undefined as any };
    }

    while (this._current < this._iterators.length) {
      const result = this._iterators[this._current].next();

      if (!result.done) {
        return result;
      } else {
        this._current++;
      }
    }

    return { done: true, value: undefined as any };
  }
}

/**
 * @hidden
 */
export class LazyDefaultIfEmptyIterator<TElement>
  implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _started = false;
  private _done = false;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _defaultValue: TElement,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    if (this._done) {
      return { done: true, value: undefined as any };
    }

    const result = this._iterator.next();

    if (!this._started) {
      this._started = true;

      if (result.done) {
        this._done = true;

        return { done: false, value: this._defaultValue };
      } else {
        return result;
      }
    } else {
      return result;
    }
  }
}

/**
 * @hidden
 */
export class LazyDistinctIterator<TElement, TKey>
  implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private readonly _found = new Set<TKey>();

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _compareOn: MapFn<TElement, TKey>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._iterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const key = this._compareOn(result.value);

        if (!this._found.has(key)) {
          this._found.add(key);

          return result;
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyExceptIterator<TElement, TKey> implements Iterator<TElement> {
  private readonly _firstIterator: Iterator<TElement>;
  private readonly _set = new Set<TKey>();

  public constructor(
    firstIterable: Iterable<TElement>,
    secondIterable: Iterable<TElement>,
    private readonly _compareOn: MapFn<TElement, TKey>,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();

    for (const element of secondIterable) {
      this._set.add(_compareOn(element));
    }
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._firstIterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const key = this._compareOn(result.value);

        if (!this._set.has(key)) {
          this._set.add(key);

          return result;
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyGroupByIterator<
  TSource,
  TKey,
  TElement = TSource,
  TResult = IGrouping<TKey, TElement>
> implements Iterator<TResult> {
  private readonly _elementMapIterator: Iterator<[TKey, TElement[]]>;

  public constructor(
    iterable: Iterable<TSource>,
    keyFn: MapFn<TSource, TKey>,
    elementSelector: MapFn<TSource, TElement>,
    private readonly _resultSelector: CombineFn<
      TKey,
      Iterable<TElement>,
      TResult
    >,
  ) {
    const elementMap = new Map<TKey, TElement[]>();
    for (const element of iterable) {
      const key = keyFn(element);
      const result = elementSelector(element);

      const arr = elementMap.get(key);
      if (!arr) {
        elementMap.set(key, [result]);
      } else {
        arr.push(result);
      }
    }

    this._elementMapIterator = elementMap[Symbol.iterator]();
  }

  public next(): IteratorResult<TResult> {
    const result = this._elementMapIterator.next();

    if (result.done) {
      return { done: true, value: undefined as any };
    } else {
      const element = this._resultSelector(result.value[0], result.value[1]);

      return { done: false, value: element };
    }
  }
}

/**
 * @hidden
 */
export class LazyGroupJoinIterator<TFirst, TSecond, TKey, TResult>
  implements Iterator<TResult> {
  private readonly _firstIterator: Iterator<TFirst>;
  private readonly _secondMap = new Map<TKey, TSecond[]>();

  public constructor(
    firstIterable: Iterable<TFirst>,
    secondIterable: Iterable<TSecond>,
    private readonly _firstKeyFn: MapFn<TFirst, TKey>,
    secondKeyFn: MapFn<TSecond, TKey>,
    private readonly _joinFn: CombineFn<TFirst, Iterable<TSecond>, TResult>,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();

    for (const secondElement of secondIterable) {
      const key = secondKeyFn(secondElement);

      const arr = this._secondMap.get(key);
      if (!arr) {
        this._secondMap.set(key, [secondElement]);
      } else {
        arr.push(secondElement);
      }
    }
  }

  public next(): IteratorResult<TResult> {
    while (true) {
      const result = this._firstIterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const key = this._firstKeyFn(result.value);
        const secondElements = this._secondMap.get(key);

        if (secondElements) {
          return {
            done: false,
            value: this._joinFn(result.value, secondElements),
          };
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyIntersectIterator<TElement, TKey = TElement>
  implements Iterator<TElement> {
  private readonly _firstIterator: Iterator<TElement>;
  private readonly _set = new Set<TKey>();

  public constructor(
    firstIterable: Iterable<TElement>,
    secondIterable: Iterable<TElement>,
    private readonly _compareOn: MapFn<TElement, TKey>,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();

    for (const element of secondIterable) {
      const key = _compareOn(element);
      this._set.add(key);
    }
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._firstIterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const key = this._compareOn(result.value);

        if (this._set.has(key)) {
          this._set.delete(key);

          return result;
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyJoinIterator<TFirst, TSecond, TKey, TResult>
  implements Iterator<TResult> {
  private readonly _firstIterator: Iterator<TFirst>;
  private readonly _secondMap: Map<TKey, TSecond>;

  public constructor(
    firstIterable: Iterable<TFirst>,
    secondIterable: Iterable<TSecond>,
    private readonly _firstKeyFn: MapFn<TFirst, TKey>,
    secondKeyFn: MapFn<TSecond, TKey>,
    private readonly _joinFn: CombineFn<TFirst, TSecond, TResult>,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();
    this._secondMap = toMap(secondIterable, secondKeyFn);
  }

  public next(): IteratorResult<TResult> {
    while (true) {
      const result = this._firstIterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const key = this._firstKeyFn(result.value);
        const secondElement = this._secondMap.get(key);

        if (secondElement) {
          return {
            done: false,
            value: this._joinFn(result.value, secondElement),
          };
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyReverseIterator<TElement> implements Iterator<TElement> {
  private readonly _arr: TElement[];
  private _index: number;

  public constructor(iterable: Iterable<TElement>) {
    this._arr = toArray(iterable);
    this._index = this._arr.length - 1;
  }

  public next(): IteratorResult<TElement> {
    if (this._index < 0) {
      return { done: true, value: undefined as any };
    } else {
      const nextResult = { done: false, value: this._arr[this._index] };
      this._index--;
      return nextResult;
    }
  }
}

/**
 * @hidden
 */
export class LazySelectIterator<TSource, TResult> implements Iterator<TResult> {
  private readonly _iterator: Iterator<TSource>;
  private _index = 0;

  public constructor(
    iterable: Iterable<TSource>,
    private readonly _selector: IndexMapFn<TSource, TResult>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next() {
    const result = this._iterator.next();

    if (result.done) {
      return { done: true, value: undefined as any };
    } else {
      const nextResult = {
        done: false,
        value: this._selector(result.value, this._index),
      };
      this._index++;

      return nextResult;
    }
  }
}

/**
 * @hidden
 */
export class LazySelectManyIterator<TSource, TResult>
  implements Iterator<TResult> {
  private readonly _iterator: Iterator<TSource>;
  private _internalIterator: Iterator<TResult> | undefined;
  private _index = 0;

  public constructor(
    iterable: Iterable<TSource>,
    private readonly _selector: IndexMapFn<TSource, Iterable<TResult>>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TResult> {
    while (true) {
      if (!this._internalIterator) {
        const result = this._iterator.next();

        if (result.done) {
          return { done: true, value: undefined as any };
        } else {
          const element = this._selector(result.value, this._index);
          this._index++;

          this._internalIterator = element[Symbol.iterator]();
        }
      }

      const internalResult = this._internalIterator.next();

      if (internalResult.done) {
        this._internalIterator = undefined;
      } else {
        return internalResult;
      }
    }
  }
}

/**
 * @hidden
 */
export class LazySkipIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _skipped = 0;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _count: number,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._iterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        if (this._skipped < this._count) {
          this._skipped++;
        } else {
          return result;
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazySkipLastIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private readonly _queue = new Queue<TElement>();

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _count: number,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._iterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        this._queue.enqueue(result.value);

        if (this._queue.length > this._count) {
          return { done: false, value: this._queue.dequeue() };
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazySkipWhile<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _index = 0;
  private _yielding = false;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _predicate: IndexPredicate<TElement>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._iterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        if (!this._yielding) {
          this._yielding = !this._predicate(result.value, this._index);
          this._index++;
        }

        if (this._yielding) {
          return result;
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyTakeIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _taken = 0;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _count: number,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    if (this._taken >= this._count) {
      return { done: true, value: undefined as any };
    }

    const result = this._iterator.next();
    this._taken++;
    return result;
  }
}

/**
 * @hidden
 */
export class LazyTakeLastIterator<TElement> implements Iterator<TElement> {
  private _queue = new Queue<TElement>();

  public constructor(iterable: Iterable<TElement>, count: number) {
    if (count > 0) {
      for (const element of iterable) {
        if (this._queue.length < count) {
          this._queue.enqueue(element);
        } else {
          this._queue.dequeue();
          this._queue.enqueue(element);
        }
      }
    }
  }

  public next(): IteratorResult<TElement> {
    if (this._queue.length === 0) {
      return { done: true, value: undefined as any };
    } else {
      return { done: false, value: this._queue.dequeue() };
    }
  }
}

/**
 * @hidden
 */
export class LazyTakeWhileIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _index = 0;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _predicate: IndexPredicate<TElement>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    const result = this._iterator.next();

    if (result.done) {
      return { done: true, value: undefined as any };
    } else {
      if (!this._predicate(result.value, this._index)) {
        return { done: true, value: undefined as any };
      } else {
        this._index++;

        return result;
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyUnionIterator<TElement, TKey = TElement>
  implements Iterator<TElement> {
  private readonly _firstIterator: Iterator<TElement>;
  private readonly _secondIterator: Iterator<TElement>;
  private readonly _set = new Set<TKey>();
  private _onSecond = false;

  public constructor(
    firstIterable: Iterable<TElement>,
    secondIterable: Iterable<TElement>,
    private readonly _compareOn: MapFn<TElement, TKey>,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();
    this._secondIterator = secondIterable[Symbol.iterator]();
  }

  public next() {
    while (true) {
      const result = this._onSecond
        ? this._secondIterator.next()
        : this._firstIterator.next();

      if (result.done) {
        if (this._onSecond) {
          return { done: true, value: undefined as any };
        } else {
          this._onSecond = true;
        }
      } else {
        const key = this._compareOn(result.value);

        if (!this._set.has(key)) {
          this._set.add(key);

          return { done: false, value: result.value };
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyWhereIterator<TElement> implements Iterator<TElement> {
  private readonly _iterator: Iterator<TElement>;
  private _index = 0;

  public constructor(
    iterable: Iterable<TElement>,
    private readonly _predicate: IndexPredicate<TElement>,
  ) {
    this._iterator = iterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TElement> {
    while (true) {
      const result = this._iterator.next();

      if (result.done) {
        return { done: true, value: undefined as any };
      } else {
        const shouldYield = this._predicate(result.value, this._index);
        this._index++;

        if (shouldYield) {
          return { done: false, value: result.value };
        }
      }
    }
  }
}

/**
 * @hidden
 */
export class LazyZipIterator<TFirst, TSecond, TResult = [TFirst, TSecond]>
  implements Iterator<TResult> {
  private readonly _firstIterator: Iterator<TFirst>;
  private readonly _secondIterator: Iterator<TSecond>;

  public constructor(
    firstIterable: Iterable<TFirst>,
    secondIterable: Iterable<TSecond>,
    private readonly _selector: CombineFn<TFirst, TSecond, TResult> = (
      first,
      second,
    ) => [first, second] as any,
  ) {
    this._firstIterator = firstIterable[Symbol.iterator]();
    this._secondIterator = secondIterable[Symbol.iterator]();
  }

  public next(): IteratorResult<TResult> {
    const firstResult = this._firstIterator.next();

    if (firstResult.done) {
      return { done: true, value: undefined as any };
    }

    const secondResult = this._secondIterator.next();

    if (secondResult.done) {
      return { done: true, value: undefined as any };
    }

    return {
      done: false,
      value: this._selector(firstResult.value, secondResult.value),
    };
  }
}
