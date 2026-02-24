import { spawn } from 'child_process';
import { resolve } from 'path';

console.log("Starting runner...");
const runnerPath = resolve('./src/runner.js');
const runner = spawn('bun', [runnerPath, '--yolo', '-o', 'stream-json'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
});

runner.stdout.on('data', (data) => console.log(`STDOUT: ${data.toString()}`));
runner.stderr.on('data', (data) => console.error(`STDERR: ${data.toString()}`));

runner.on('message', (msg) => {
    console.log("Received IPC message:", msg);
    if (msg.type === 'ready') {
        console.log("Sending run prompt...");
        runner.send({ type: 'run', input: "今何時ですか？あなたの持っているツールで時間を調べて教えてください。" });
    }
});

runner.on('exit', (code) => {
    console.log(`Runner exited with code ${code}`);
});
