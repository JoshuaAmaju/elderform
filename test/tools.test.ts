import { retry } from '../src/tools';

const delay = (time = 200) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

class NotFound extends Error {}

let alwaysFails: jest.Mock<Promise<never>, []>;

let alwaysPass: jest.Mock<Promise<unknown>, []>;

let mayFail: jest.Mock<Promise<number>, []>;

beforeEach(() => {
  alwaysPass = jest.fn(() => delay());
  alwaysFails = jest.fn(() => delay().then(() => Promise.reject()));
  mayFail = jest.fn(() => delay().then(() => Promise.reject(new NotFound())));
});

describe('autoretry async function', () => {
  it('should be called once', (done) => {
    retry(alwaysPass, { retries: 1, delay: 10 }).then(() => {
      expect(alwaysPass.mock.calls.length).toBe(1);
      done();
    });
  });

  it('should be called 2 times', (done) => {
    retry(alwaysFails, { retries: 1, delay: 10 }).catch(() => {
      expect(alwaysFails.mock.calls.length).toBe(2);
      done();
    });
  });

  it('should be called 11 times', (done) => {
    retry(alwaysFails, { retries: 10, delay: 1 }).catch(() => {
      expect(alwaysFails.mock.calls.length).toBe(11);
      done();
    });
  });

  it('abort after being called 2 times', (done) => {
    retry(mayFail, {
      delay: 1,
      retries: 10,
      onRetry: (e, attempts) => {
        return e instanceof NotFound && attempts < 1;
      },
    }).catch(() => {
      expect(mayFail.mock.calls.length).toBe(2);
      done();
    });
  });
});
