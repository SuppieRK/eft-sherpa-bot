export const sharedTextEncoder = new TextEncoder();

export interface LastValueAsyncCache<Value, Result> {
  get(value: Value): Promise<Result>;
}

export function createLastValueAsyncCache<Value, Result>(
  load: (value: Value) => Promise<Result>,
): LastValueAsyncCache<Value, Result> {
  let current: { value: Value; promise: Promise<Result> } | undefined;
  return {
    get(value) {
      if (current?.value === value) return current.promise;
      const promise = load(value);
      current = { value, promise };
      void promise.catch(() => {
        if (current?.promise === promise) current = undefined;
      });
      return promise;
    },
  };
}
