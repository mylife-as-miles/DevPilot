const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DESKTOP_ROOT = path.resolve(__dirname, '..');
const REPOSITORY_ROOT = path.resolve(DESKTOP_ROOT, '..', '..');
const STAGED_RUNTIME_ROOT = path.join(DESKTOP_ROOT, 'runtime');

function requireDirectory(candidate, label) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw new Error(`${label} was not found: ${candidate}`);
  }
  return candidate;
}

function readPythonHome(venvRoot) {
  const configured = String(process.env.DEVPILOT_PYTHON_HOME || '').trim();
  if (configured) return path.resolve(configured);

  const configPath = path.join(venvRoot, 'pyvenv.cfg');
  const content = fs.readFileSync(configPath, 'utf8');
  const match = content.match(/^home\s*=\s*(.+)$/mi);
  if (!match) throw new Error(`Unable to determine Python home from ${configPath}. Set DEVPILOT_PYTHON_HOME to continue.`);
  return path.resolve(match[1].trim());
}

function shouldCopy(source) {
  const normalized = source.replace(/\\/g, '/');
  return !normalized.includes('/__pycache__/')
    && !normalized.endsWith('/__pycache__')
    && !normalized.includes('/.pytest_cache/');
}

function copyDirectory(source, destination) {
  if (process.platform === 'win32') {
    fs.mkdirSync(destination, { recursive: true });
    const result = spawnSync('robocopy.exe', [
      source,
      destination,
      '/MIR',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
      '/XD',
      '__pycache__',
      '.pytest_cache',
    ], { windowsHide: true });
    // Robocopy uses 0-7 for successful copies (including "nothing changed").
    if (result.error || result.status > 7) {
      throw result.error ?? new Error(`robocopy failed while staging ${source} (exit ${result.status})`);
    }
    return;
  }
  fs.cpSync(source, destination, { recursive: true, filter: shouldCopy, force: true });
}

function preparePythonRuntime() {
  const venvRoot = requireDirectory(
    path.resolve(String(process.env.DEVPILOT_PYTHON_VENV || path.join(REPOSITORY_ROOT, '.venv'))),
    'DevPilot build virtual environment',
  );
  const pythonHome = requireDirectory(readPythonHome(venvRoot), 'Base Python runtime');
  const venvSitePackages = requireDirectory(path.join(venvRoot, 'Lib', 'site-packages'), 'DevPilot Python dependencies');
  const sourcePackage = requireDirectory(path.join(REPOSITORY_ROOT, 'src'), 'DevPilot Python source package');
  const destinationPython = path.join(STAGED_RUNTIME_ROOT, 'python');

  fs.mkdirSync(STAGED_RUNTIME_ROOT, { recursive: true });
  copyDirectory(pythonHome, destinationPython);
  copyDirectory(venvSitePackages, path.join(destinationPython, 'Lib', 'site-packages'));
  copyDirectory(sourcePackage, path.join(destinationPython, 'Lib', 'site-packages', 'devpilot'));

  const bundledPython = path.join(destinationPython, 'python.exe');
  if (!fs.existsSync(bundledPython)) throw new Error(`Bundled Python executable was not staged: ${bundledPython}`);
  return bundledPython;
}

if (require.main === module) {
  const runtime = preparePythonRuntime();
  process.stdout.write(`Prepared bundled DevPilot Python runtime: ${runtime}\n`);
}

module.exports = { preparePythonRuntime };
