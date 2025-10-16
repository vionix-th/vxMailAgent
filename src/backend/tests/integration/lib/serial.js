const queue = [];
let running = false;

async function processQueue() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { fn, resolve, reject } = queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }
  running = false;
}

async function runSerial(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    void processQueue();
  });
}

module.exports = { runSerial };
