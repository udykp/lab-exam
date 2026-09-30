const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sandbox = require('./sandbox');

const venvPath = path.join(os.homedir(), '.securemlexam-venv');
let pythonExecutable = 'python3';
let runningProcess = null;
let resetExecutionTimer = null;
let tempFiles = [];

function getUnifiedPythonPath() {
  const paths = [];
  const homeDir = os.homedir();

  if (process.env.PYTHONPATH) {
    paths.push(...process.env.PYTHONPATH.split(path.delimiter));
  }

  const systemPaths = [
    '/usr/lib/python3/dist-packages',
    '/usr/local/lib/python3/dist-packages',
    '/usr/lib/python3.10/dist-packages',
    '/usr/lib/python3.11/dist-packages',
    '/usr/lib/python3.12/dist-packages',
    '/usr/lib/python3.13/dist-packages',
    '/usr/lib/python3.14/dist-packages',
    '/usr/local/lib/python3.10/dist-packages',
    '/usr/local/lib/python3.11/dist-packages',
    '/usr/local/lib/python3.12/dist-packages',
    '/usr/local/lib/python3.13/dist-packages',
    '/usr/local/lib/python3.14/dist-packages',
  ];

  for (const ver of ['3.10', '3.11', '3.12', '3.13', '3.14', '3.8', '3.9']) {
    systemPaths.push(path.join(homeDir, '.local', 'lib', `python${ver}`, 'site-packages'));
    systemPaths.push(path.join(venvPath, 'lib', `python${ver}`, 'site-packages'));
  }

  const condaDirs = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge'];
  for (const cd of condaDirs) {
    for (const ver of ['3.12', '3.11', '3.10', '3.9']) {
      systemPaths.push(path.join(homeDir, cd, 'lib', `python${ver}`, 'site-packages'));
    }
  }

  const uniquePaths = new Set();
  paths.forEach(p => { if (p && fs.existsSync(p)) uniquePaths.add(p); });
  systemPaths.forEach(p => { if (p && fs.existsSync(p)) uniquePaths.add(p); });

  return Array.from(uniquePaths).join(path.delimiter);
}

function ensureVenv() {
  return new Promise((resolve) => {
    const venvBin = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python3');

    const checkAndInstallPackages = (pythonBin) => {
      const testCmd = `"${pythonBin}" -c "import numpy, pandas, matplotlib, scipy, sklearn"`;
      const envWithPythonPath = { ...process.env, PYTHONPATH: getUnifiedPythonPath() };

      exec(testCmd, { env: envWithPythonPath }, (err) => {
        if (!err) {
          console.log(`[Venv] Core data science packages verified for ${pythonBin}.`);
          resolve(pythonBin);
          return;
        }

        console.log(`[Venv] Missing core packages. Running background self-healing installation...`);
        exec(`"${pythonBin}" -m pip install numpy pandas matplotlib scipy scikit-learn openpyxl --no-warn-script-location`, { env: envWithPythonPath }, (pipErr) => {
          if (pipErr) {
            console.warn('[Venv] Self-healing pip install notice:', pipErr.message);
          } else {
            console.log('[Venv] Self-healing pip install completed successfully!');
          }
          resolve(pythonBin);
        });
      });
    };

    if (fs.existsSync(venvBin)) {
      console.log(`[Venv] Virtual environment found at: ${venvBin}`);
      checkAndInstallPackages(venvBin);
      return;
    }

    console.log(`[Venv] Creating virtual environment at: ${venvPath}...`);
    exec(`python3 -m venv --system-site-packages "${venvPath}"`, (err) => {
      if (err || !fs.existsSync(venvBin)) {
        console.warn('[Venv] Virtual environment creation skipped/failed. Using system python3 with unified PYTHONPATH:', err ? err.message : 'no binary');
        resolve('python3');
      } else {
        console.log(`[Venv] Virtual environment created successfully.`);
        checkAndInstallPackages(venvBin);
      }
    });
  });
}

// Initialize virtual environment
ensureVenv().then(bin => {
  pythonExecutable = bin;
});

function getJavaBinaries() {
  let javacBin = 'javac';
  let javaBin = 'java';

  try {
    if (fs.existsSync('/usr/bin/javac')) {
      const realJavac = fs.realpathSync('/usr/bin/javac');
      const jdkBinDir = path.dirname(realJavac);
      const siblingJava = path.join(jdkBinDir, 'java');
      if (fs.existsSync(siblingJava)) {
        javacBin = realJavac;
        javaBin = siblingJava;
        return { javacBin, javaBin };
      }
    }
  } catch (_) {}

  return { javacBin, javaBin };
}

function cleanupTempFiles() {
  tempFiles.forEach(f => { try { fs.unlinkSync(f); } catch (_) {} });
  tempFiles = [];
}

function sendOutput(event, data, stream = 'stdout') {
  let processedData = data;
  if (stream === 'stderr' && typeof data === 'string') {
    // Filter out Matplotlib cache directory notices
    if (processedData.includes('matplotlib') && (processedData.includes('not a writable directory') || processedData.includes('temporary cache directory'))) {
      processedData = processedData
        .replace(/.*matplotlib is not a writable directory.*\n?/gi, '')
        .replace(/.*Matplotlib created a temporary cache directory.*(?:\n.*MPLCONFIGDIR.*\n?)?/gi, '')
        .trim();
      if (!processedData) return;
    }

    const regex = /File "solution\.py", line (\d+)/g;
    processedData = processedData.replace(regex, (match, lineNum) => {
      const correctedLine = Math.max(1, parseInt(lineNum) - 14);
      return `File "solution.py", line ${correctedLine}`;
    });
    const rRegex = /solution\.R:(\d+):/g;
    processedData = processedData.replace(rRegex, (match, lineNum) => {
      const correctedLine = Math.max(1, parseInt(lineNum) - 1);
      return `solution.R:${correctedLine}:`;
    });
  }
  event.sender.send('code-output', { stream, data: processedData });
}

function spawnAndStream(event, originalCmd, originalArgs, opts = {}, extraBinds = []) {
  const startHrTime = process.hrtime.bigint();
  
  // Wrap with sandbox container if available
  const wrapped = sandbox.wrap(originalCmd, originalArgs, opts, [venvPath, ...extraBinds]);
  const cmd = wrapped.cmd;
  const args = wrapped.args;
  
  // Detach so we can cleanly terminate the entire process group if needed
  const proc = spawn(cmd, args, { env: process.env, detached: process.platform !== 'win32', ...opts });
  runningProcess = proc;

  let peakMemoryKb = 0;
  let memPollInterval = null;
  if (process.platform === 'linux' && proc.pid) {
    memPollInterval = setInterval(() => {
      try {
        if (!proc.pid) return;
        const statusPath = `/proc/${proc.pid}/status`;
        if (fs.existsSync(statusPath)) {
          const statusContent = fs.readFileSync(statusPath, 'utf8');
          const vmrssMatch = statusContent.match(/VmHWM:\s+(\d+)\s+kB/) || statusContent.match(/VmRSS:\s+(\d+)\s+kB/);
          if (vmrssMatch) {
            const memKb = parseInt(vmrssMatch[1], 10);
            if (memKb > peakMemoryKb) peakMemoryKb = memKb;
          }
        }
      } catch (_) {}
    }, 40);
  }

  let watcher = null;
  const runDir = opts.cwd;
  if (runDir && fs.existsSync(runDir)) {
    try {
      watcher = fs.watch(runDir, (eventType, filename) => {
        if (filename) {
          const lower = filename.toLowerCase();
          if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
            const filePath = path.join(runDir, filename);
            setTimeout(() => {
              if (fs.existsSync(filePath)) {
                try {
                  const content = fs.readFileSync(filePath).toString('base64');
                  event.sender.send('plot-updated', {
                    filename,
                    content,
                    type: `image/${lower.split('.').pop()}`
                  });
                } catch (_) {}
              }
            }, 100);
          }
        }
      });
    } catch (err) {
      console.error('[Runner] Failed to start folder watcher:', err.message);
    }
  }

  let totalOutputLength = 0;
  const maxOutputLength = 100000; // 100 KB limit
  let killed = false;

  const INACTIVITY_TIMEOUT_MS = 60000; // 60s idle window without input/output
  const HARD_CAP_TIMEOUT_MS = 180000;  // 180s (3 minutes) maximum safety ceiling

  let inactivityTimerId = null;

  const killProcessGroup = () => {
    if (!proc || !proc.pid) return;
    try {
      if (process.platform !== 'win32') {
        process.kill(-proc.pid, 'SIGKILL');
      } else {
        proc.kill('SIGKILL');
      }
    } catch (_) {
      try { proc.kill('SIGKILL'); } catch (_) {}
    }
  };

  const resetInactivityTimer = () => {
    if (inactivityTimerId) clearTimeout(inactivityTimerId);
    if (killed) return;
    inactivityTimerId = setTimeout(() => {
      if (runningProcess === proc) {
        killed = true;
        sendOutput(event, '\n\n[Execution timed out after 60 seconds of inactivity]\n', 'stderr');
        killProcessGroup();
      }
    }, INACTIVITY_TIMEOUT_MS);
  };

  // Start the initial inactivity countdown & expose the reset hook for stdin
  resetInactivityTimer();
  resetExecutionTimer = resetInactivityTimer;

  // Enforce the 3-minute hard global safety ceiling
  const hardCapTimerId = setTimeout(() => {
    if (runningProcess === proc) {
      killed = true;
      sendOutput(event, '\n\n[Execution terminated: Maximum limit of 3 minutes reached]\n', 'stderr');
      killProcessGroup();
    }
  }, HARD_CAP_TIMEOUT_MS);

  proc.stdout.on('data', (d) => {
    if (killed) return;
    const str = d.toString();
    totalOutputLength += str.length;
    if (totalOutputLength > maxOutputLength) {
      killed = true;
      sendOutput(event, '\n\n[Output limit exceeded. Process terminated.]\n', 'stderr');
      killProcessGroup();
      return;
    }
    resetInactivityTimer();
    sendOutput(event, str, 'stdout');
  });

  proc.stderr.on('data', (d) => {
    if (killed) return;
    const str = d.toString();
    totalOutputLength += str.length;
    if (totalOutputLength > maxOutputLength) {
      killed = true;
      sendOutput(event, '\n\n[Output limit exceeded. Process terminated.]\n', 'stderr');
      killProcessGroup();
      return;
    }
    resetInactivityTimer();
    sendOutput(event, str, 'stderr');
  });

  return new Promise((resolve) => {
    proc.on('close', (code) => {
      if (inactivityTimerId) clearTimeout(inactivityTimerId);
      if (hardCapTimerId) clearTimeout(hardCapTimerId);
      resetExecutionTimer = null;
      if (memPollInterval) clearInterval(memPollInterval);
      if (watcher) { try { watcher.close(); } catch (_) {} }
      const endHrTime = process.hrtime.bigint();
      const durationMs = Number(endHrTime - startHrTime) / 1e6;
      runningProcess = null;
      resolve({
        exitCode: code,
        executionTimeMs: Math.round(durationMs),
        peakMemoryMb: peakMemoryKb > 0 ? (peakMemoryKb / 1024).toFixed(1) : null
      });
    });
    proc.on('error', (err) => {
      if (inactivityTimerId) clearTimeout(inactivityTimerId);
      if (hardCapTimerId) clearTimeout(hardCapTimerId);
      resetExecutionTimer = null;
      if (memPollInterval) clearInterval(memPollInterval);
      if (watcher) { try { watcher.close(); } catch (_) {} }
      const endHrTime = process.hrtime.bigint();
      const durationMs = Number(endHrTime - startHrTime) / 1e6;
      runningProcess = null;
      sendOutput(event, err.message, 'stderr');
      resolve({
        exitCode: 1,
        executionTimeMs: Math.round(durationMs),
        peakMemoryMb: peakMemoryKb > 0 ? (peakMemoryKb / 1024).toFixed(1) : null
      });
    });
  });
}

async function runCode(event, { code, language, attachments }) {
  // Kill any previous run
  if (runningProcess) {
    try {
      if (process.platform !== 'win32') {
        process.kill(-runningProcess.pid, 'SIGKILL');
      } else {
        runningProcess.kill('SIGKILL');
      }
    } catch (_) {}
    runningProcess = null;
  }
  cleanupTempFiles();

  const lang = (language || 'python').toLowerCase();
  const ts = Date.now();
  let runResult = { exitCode: 0, executionTimeMs: 0, peakMemoryMb: null };

  // Create a dedicated directory for execution
  const runDir = path.join(os.tmpdir(), `exam_run_${ts}`);
  fs.mkdirSync(runDir, { recursive: true });

  try {
    // Download data attachments (CSVs, JSON, TSV, TXT) silently to runDir
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (!att || !att.filename) continue;
        const lower = att.filename.toLowerCase();
        const isDocOrImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.docx');
        if (isDocOrImage) continue;

        try {
          if (att.isLocal && att.content) {
            const fileBuf = Buffer.from(att.content, 'base64');
            fs.writeFileSync(path.join(runDir, att.filename), fileBuf);
            if (att.rawFilename && att.rawFilename !== att.filename) {
              fs.writeFileSync(path.join(runDir, att.rawFilename), fileBuf);
            }
          } else if (att.url) {
            let response = null;
            let downloadSuccess = false;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                response = await fetch(att.url);
                if (response.ok) {
                  downloadSuccess = true;
                  break;
                }
              } catch (fetchErr) {
                console.warn(`[Runner] Download attempt ${attempt} network error:`, fetchErr.message);
              }
              if (attempt < 3) {
                await new Promise(r => setTimeout(r, 800));
              }
            }

            if (downloadSuccess && response) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              fs.writeFileSync(path.join(runDir, att.filename), buffer);
              if (att.rawFilename && att.rawFilename !== att.filename) {
                fs.writeFileSync(path.join(runDir, att.rawFilename), buffer);
              }
            }
          }
        } catch (err) {
          console.warn(`[Runner] Failed to load data file ${att.filename}: ${err.message}`);
        }
      }
    }

    // ── Python ──────────────────────────────────────────────────────────────
    if (lang.includes('python')) {
      const pyFile = path.join(runDir, `solution.py`);
      const overridePrefix = `_show_counter = 0
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    def _custom_show(*args, **kwargs):
        global _show_counter
        _show_counter += 1
        plt.savefig(f'plot_{_show_counter}.png', bbox_inches='tight')
        plt.close()
    plt.show = _custom_show
except:
    pass
`;
      fs.writeFileSync(pyFile, overridePrefix + code, 'utf8');
      const mplConfigDir = path.join(runDir, '.matplotlib');
      try { fs.mkdirSync(mplConfigDir, { recursive: true }); } catch (_) {}
      const pythonEnv = {
        ...process.env,
        MPLBACKEND: 'Agg',
        MPLCONFIGDIR: mplConfigDir,
        PYTHONPATH: getUnifiedPythonPath(),
        PYTHONUNBUFFERED: '1'
      };
      runResult = await spawnAndStream(event, pythonExecutable, ['-u', 'solution.py'], {
        cwd: runDir,
        env: pythonEnv
      });
    }

    // ── Java ────────────────────────────────────────────────────────────────
    else if (lang.includes('java')) {
      const classMatch = code.match(/public\s+class\s+(\w+)/);
      const className = classMatch ? classMatch[1] : 'ExamCode';
      const javaFile = path.join(runDir, `${className}.java`);
      fs.writeFileSync(javaFile, code, 'utf8');

      const { javacBin, javaBin } = getJavaBinaries();

      sendOutput(event, `Compiling ${className}.java...\n`);
      const compileRes = await spawnAndStream(event, javacBin, [`${className}.java`], { cwd: runDir });
      if (compileRes.exitCode === 0) {
        sendOutput(event, `Running ${className}...\n`);
        runResult = await spawnAndStream(event, javaBin, [className], { cwd: runDir });
      } else {
        runResult = compileRes;
      }
    }

    // ── C ───────────────────────────────────────────────────────────────────
    else if (lang === 'c') {
      const cFile = path.join(runDir, `solution.c`);
      fs.writeFileSync(cFile, code, 'utf8');

      sendOutput(event, 'Compiling C code...\n');
      const compileRes = await spawnAndStream(event, 'gcc', ['solution.c', '-o', 'solution.out', '-lm'], { cwd: runDir });
      if (compileRes.exitCode === 0) {
        sendOutput(event, 'Running...\n');
        runResult = await spawnAndStream(event, 'stdbuf', ['-o0', '-e0', './solution.out'], { cwd: runDir });
      } else {
        runResult = compileRes;
      }
    }

    // ── C++ ─────────────────────────────────────────────────────────────────
    else if (lang.includes('c++') || lang.includes('cpp')) {
      const cppFile = path.join(runDir, `solution.cpp`);
      fs.writeFileSync(cppFile, code, 'utf8');

      sendOutput(event, 'Compiling C++ code...\n');
      const compileRes = await spawnAndStream(event, 'g++', ['solution.cpp', '-o', 'solution.out', '-lm', '-std=c++17'], { cwd: runDir });
      if (compileRes.exitCode === 0) {
        sendOutput(event, 'Running...\n');
        runResult = await spawnAndStream(event, 'stdbuf', ['-o0', '-e0', './solution.out'], { cwd: runDir });
      } else {
        runResult = compileRes;
      }
    }

    // ── R ───────────────────────────────────────────────────────────────────
    else if (lang === 'r' || lang.includes('rscript')) {
      const rFile = path.join(runDir, `solution.R`);
      fs.writeFileSync(rFile, code, 'utf8');
      const rRunnerFile = path.join(runDir, `_runner.R`);
      const rRunnerCode = `options(device = function(...) png("plot_%03d.png", width = 800, height = 600, res = 100))
tryCatch({
  source("solution.R", print.eval = TRUE, echo = FALSE)
}, finally = {
  invisible(graphics.off())
})
`;
      fs.writeFileSync(rRunnerFile, rRunnerCode, 'utf8');
      runResult = await spawnAndStream(event, 'Rscript', ['--vanilla', '_runner.R'], { cwd: runDir });
    }

    // ── MySQL ────────────────────────────────────────────────────────────────
    else if (lang.includes('mysql') || lang.includes('sql')) {
      const sqlFile = path.join(runDir, `solution.sql`);
      fs.writeFileSync(sqlFile, code, 'utf8');
      runResult = await spawnAndStream(event, 'mysql', [
        '-u', 'exam_user',
        '-pexam_password',
        'labexam',
        '--table',
        '-e', code
      ], { cwd: runDir });
    }

    // ── Unknown ──────────────────────────────────────────────────────────────
    else {
      sendOutput(event, `[Error]: Language "${language}" is not supported.\nSupported: Python, Java, C, C++, R, MySQL\n`, 'stderr');
      runResult = { exitCode: 1, executionTimeMs: 0, peakMemoryMb: null };
    }
  } catch (err) {
    sendOutput(event, `[Runner Error]: ${err.message}\n`, 'stderr');
    runResult = { exitCode: 1, executionTimeMs: 0, peakMemoryMb: null };
  }

  // Look for generated files before cleanup
  const generatedFiles = [];
  try {
    if (fs.existsSync(runDir)) {
      const files = fs.readdirSync(runDir);
      const sourceFiles = ['solution.py', 'solution.R', '_runner.R', 'solution.c', 'solution.cpp', 'solution.out', 'solution.java', 'solution.class', 'solution.sql', 'Rplots.pdf'];
      const attachmentNames = attachments ? attachments.map(a => a.filename) : [];

      for (const file of files) {
        if (sourceFiles.includes(file) || attachmentNames.includes(file)) continue;

        const filePath = path.join(runDir, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && stat.size > 0) {
          const lower = file.toLowerCase();
          if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.pdf')) {
            const content = fs.readFileSync(filePath).toString('base64');
            generatedFiles.push({
              filename: file,
              content: content,
              type: lower.endsWith('.pdf') ? 'application/pdf' : `image/${lower.split('.').pop()}`
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to read runDir files:', err);
  }

  // Cleanup run directory recursively
  try { fs.rmSync(runDir, { recursive: true, force: true }); } catch (_) {}
  event.sender.send('code-exit', {
    exitCode: runResult.exitCode,
    generatedFiles,
    executionTimeMs: runResult.executionTimeMs || 0,
    peakMemoryMb: runResult.peakMemoryMb || null
  });
}

function stopCode(event) {
  if (runningProcess) {
    try {
      if (process.platform !== 'win32') {
        process.kill(-runningProcess.pid, 'SIGKILL');
      } else {
        runningProcess.kill('SIGKILL');
      }
    } catch (_) {}
    runningProcess = null;
    event.sender.send('code-exit', { exitCode: -1, error: 'Stopped by user.' });
  }
  if (typeof resetExecutionTimer === 'function') {
    resetExecutionTimer = null;
  }
  cleanupTempFiles();
}

function sendStdin(text) {
  if (runningProcess && runningProcess.stdin && !runningProcess.stdin.destroyed) {
    try {
      runningProcess.stdin.write(text + '\n');
      if (typeof resetExecutionTimer === 'function') {
        resetExecutionTimer();
      }
    } catch (_) {}
  }
}

function runPipInstall(event, packages) {
  sendOutput(event, `\n[System]: Terminal package installation is disabled. All required course packages are pre-installed.\n`, 'stderr');
  event.sender.send('pip-exit', { exitCode: 1 });
}

function registerRunnerIPC(ipcMain) {
  ipcMain.on('run-code', (event, payload) => runCode(event, payload));
  ipcMain.on('stop-code', (event) => stopCode(event));
  ipcMain.on('code-stdin', (event, text) => sendStdin(text));
  ipcMain.on('run-pip-install', (event, packages) => runPipInstall(event, packages));
}

module.exports = {
  runCode,
  stopCode,
  sendStdin,
  runPipInstall,
  registerRunnerIPC,
  ensureVenv,
  getUnifiedPythonPath
};
