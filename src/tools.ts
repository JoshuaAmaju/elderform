type Config<TError> = {
  retries?: number;
  delay?: number | ((n: number) => number);
  onRetry?: (error: TError, attempts: number) => boolean;
};

type Fn<T> = (...args: any[]) => Promise<T>;

export const retry = <T, E = any>(
  fn: Fn<T>,
  config?: Config<E>
): Promise<T> => {
  let count = 0;

  const { retries = 1, delay = 100, onRetry = () => true } = config ?? {};

  let delayFn = typeof delay === 'function' ? delay : () => delay;

  return new Promise((resolve, reject) => {
    const run = () => {
      fn()
        .then(resolve)
        .catch((err) => {
          const tryAgain = onRetry(err, count);

          if (count < retries && tryAgain) {
            setTimeout(() => {
              count++;
              run();
            }, delayFn(count));
          } else {
            reject(err);
          }
        });
    };

    run();
  });
};
