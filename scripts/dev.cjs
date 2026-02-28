const { spawn } = require('node:child_process')
const path = require('node:path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js')
const child = spawn(process.execPath, [viteBin], {
  stdio: 'inherit',
  env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
