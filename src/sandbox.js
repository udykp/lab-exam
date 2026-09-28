const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class SandboxManager {
  constructor() {
    this._bwrapAvailable = null;
    this._bwrapPath = '/usr/bin/bwrap';
  }

  /**
   * Check if bubblewrap (bwrap) is available and functional on this system.
   * Caches result after first check.
   */
  isAvailable() {
    if (this._bwrapAvailable !== null) {
      return this._bwrapAvailable;
    }

    // First check if bwrap binary exists
    if (!fs.existsSync(this._bwrapPath)) {
      try {
        const check = spawnSync('which', ['bwrap'], { encoding: 'utf8' });
        if (check.status === 0 && check.stdout.trim()) {
          this._bwrapPath = check.stdout.trim();
        } else {
          this._bwrapAvailable = false;
          console.log('[Sandbox] bubblewrap (bwrap) not found. Using process-group isolation.');
          return false;
        }
      } catch (_) {
        this._bwrapAvailable = false;
        return false;
      }
    }

    // Verify if unprivileged user namespaces are allowed for bwrap in this environment
    try {
      const probe = spawnSync(this._bwrapPath, [
        '--ro-bind', '/', '/',
        '--dev', '/dev',
        '--proc', '/proc',
        '--tmpfs', '/tmp',
        'true'
      ], { timeout: 1500 });

      if (probe.status === 0) {
        this._bwrapAvailable = true;
        console.log('[Sandbox] Hardware-level container sandbox (bwrap) verified and ACTIVE.');
      } else {
        this._bwrapAvailable = false;
        console.log('[Sandbox] bwrap namespace creation restricted by host kernel. Falling back to process isolation.');
      }
    } catch (err) {
      this._bwrapAvailable = false;
      console.log('[Sandbox] bwrap probe exception:', err.message);
    }

    return this._bwrapAvailable;
  }

  /**
   * Wrap an executable command with sandbox constraints if bwrap is active.
   * Returns { cmd, args, opts, sandboxed }
   */
  wrap(cmd, args, opts = {}, extraBinds = []) {
    if (!this.isAvailable()) {
      return { cmd, args, opts, sandboxed: false };
    }

    const runDir = opts.cwd || os.tmpdir();
    const bwrapArgs = [
      // Read-only system filesystem
      '--ro-bind', '/', '/',
      // Mount virtual filesystems
      '--dev', '/dev',
      '--proc', '/proc',
      // Ephemeral /tmp in memory
      '--tmpfs', '/tmp',
      // Allow read-write ONLY to the specific run directory
      '--bind', runDir, runDir,
    ];

    // Add any extra explicit read-only or read-write binds (e.g. venv)
    for (const bindPath of extraBinds) {
      if (bindPath && fs.existsSync(bindPath)) {
        bwrapArgs.push('--ro-bind', bindPath, bindPath);
      }
    }

    // Unshare process namespace so student code cannot see or signal host processes
    bwrapArgs.push(
      '--unshare-pid',
      '--die-with-parent',
      '--chdir', runDir,
      '--',
      cmd,
      ...args
    );

    return {
      cmd: this._bwrapPath,
      args: bwrapArgs,
      opts,
      sandboxed: true
    };
  }
}

module.exports = new SandboxManager();
