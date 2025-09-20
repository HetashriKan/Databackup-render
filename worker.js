const {parentPort} = require("worker_threads");
// simulating CPU heavy task

let total = 0;
for(let i=0; i<=1e9; i++) {
    total += i;
}

parentPort.postMessage(total);