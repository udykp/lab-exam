// Helper: Get element by ID
const el = (id) => document.getElementById(id);

const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const cleanAttachmentFilename = (filename) => {
  if (!filename) return '';
  const match = filename.match(/^(.+?)_[a-z0-9]{8,24}(?:_[a-z0-9]{8,24})*\.([a-zA-Z0-9]+)$/i);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return filename;
};

const BOILERPLATES = {
  python: `# Write your Python 3 code here\n`,
  c: `#include <stdio.h>\n\nint main() {\n    // Write your C code here\n    return 0;\n}\n`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your C++ code here\n    return 0;\n}\n`,
  java: `public class Main {\n    public static void main(String[] args) {\n        // Write your Java code here\n    }\n}\n`,
  r: `# Write your R code here\n`,
  mysql: `-- Write your SQL query here\n`
};

const PRESETS = {
  python_basic: {
    title: 'Python 3 Playground',
    language: 'python',
    prompt: 'Write and test Python code. Standard library modules (math, random, collections, etc.) are available.',
    code: `# Python 3 Sandbox\nimport math\n\ndef calculate_primes(n):\n    primes = []\n    for num in range(2, n + 1):\n        if all(num % i != 0 for i in range(2, int(math.sqrt(num)) + 1)):\n            primes.append(num)\n    return primes\n\nprint("First 15 primes:", calculate_primes(50))\n`
  },
  data_analysis: {
    title: 'Data Science & CSV Analysis',
    language: 'python',
    prompt: 'Read and analyze the student scores dataset. Compute summary metrics and department statistics.',
    code: `# Data Analysis Demo\nimport pandas as pd\nimport io\n\ncsv_data = """student_id,name,department,score,attendance\n101,Alice,CS,92,96\n102,Bob,ECE,78,85\n103,Charlie,CS,88,90\n104,Diana,ME,95,98\n105,Evan,ECE,64,72\n"""\n\ndf = pd.read_csv(io.StringIO(csv_data))\nprint("Dataset Summary:")\nprint(df.describe())\nprint("\\nAverage Score by Department:")\nprint(df.groupby('department')['score'].mean())\n`,
    files: [
      {
        filename: 'students.csv',
        content: btoa('student_id,name,department,score,attendance\n101,Alice,CS,92,96\n102,Bob,ECE,78,85\n103,Charlie,CS,88,90\n104,Diana,ME,95,98\n105,Evan,ECE,64,72\n'),
        dataUrl: 'data:text/csv;base64,' + btoa('student_id,name,department,score,attendance\n101,Alice,CS,92,96\n102,Bob,ECE,78,85\n103,Charlie,CS,88,90\n104,Diana,ME,95,98\n105,Evan,ECE,64,72\n')
      }
    ]
  },
  matplotlib_plot: {
    title: 'Data Visualization (Matplotlib)',
    language: 'python',
    prompt: 'Generate charts and plots. Saved images (e.g. plt.savefig) are automatically rendered in the Plots tab.',
    code: `# Matplotlib Visualization Demo\nimport matplotlib.pyplot as plt\nimport numpy as np\n\nx = np.linspace(0, 10, 100)\ny1 = np.sin(x)\ny2 = np.cos(x)\n\nplt.figure(figsize=(8, 4.5))\nplt.plot(x, y1, label='Sin(x)', color='#3b82f6', linewidth=2)\nplt.plot(x, y2, label='Cos(x)', color='#10b981', linewidth=2, linestyle='--')\nplt.title('Sine & Cosine Waveforms', fontsize=13, fontweight='bold')\nplt.xlabel('X Axis')\nplt.ylabel('Y Axis')\nplt.legend()\nplt.grid(True, alpha=0.3)\n\n# Save the plot image so it appears in the Plots tab viewer\nplt.tight_layout()\nplt.savefig('sine_wave.png', dpi=150)\nprint("Plot generated and saved to sine_wave.png.")\n`
  },
  cpp_algo: {
    title: 'C++ Algorithm Challenge',
    language: 'cpp',
    prompt: 'Implement a binary search algorithm in C++ and test it with a vector.',
    code: `#include <iostream>\n#include <vector>\n\nusing namespace std;\n\nint binarySearch(const vector<int>& arr, int target) {\n    int low = 0, high = arr.size() - 1;\n    while (low <= high) {\n        int mid = low + (high - low) / 2;\n        if (arr[mid] == target) return mid;\n        if (arr[mid] < target) low = mid + 1;\n        else high = mid - 1;\n    }\n    return -1;\n}\n\nint main() {\n    vector<int> numbers = {12, 24, 35, 47, 53, 68, 79, 88, 95};\n    int target = 53;\n    int index = binarySearch(numbers, target);\n    cout << "Found target " << target << " at index " << index << endl;\n    return 0;\n}\n`
  },
  sql_sandbox: {
    title: 'MySQL Database Sandbox',
    language: 'mysql',
    prompt: 'Write and test SQL queries in the interactive notebook cells below.',
    code: `-- Create a sample table\nCREATE TABLE students (\n    id INT PRIMARY KEY,\n    name VARCHAR(50),\n    major VARCHAR(30),\n    gpa DECIMAL(3,2)\n);\n\n-- Insert sample records\nINSERT INTO students VALUES \n(1, 'Alice Smith', 'Computer Science', 3.85),\n(2, 'Bob Jones', 'Data Science', 3.62),\n(3, 'Charlie Brown', 'Mathematics', 3.91);\n\n-- Query top students\nSELECT name, major, gpa FROM students WHERE gpa >= 3.70 ORDER BY gpa DESC;\n`
  }
};

const isBoilerplateOrEmpty = (code) => {
  if (!code || !code.trim()) return true;
  const trimmed = code.trim();
  return Object.values(BOILERPLATES).some(b => b.trim() === trimmed);
};

const formatCurrentCode = () => {
  if (!monacoEditorInstance) return;
  const action = monacoEditorInstance.getAction('editor.action.formatDocument');
  if (action) {
    action.run();
  }
};

// ── Interactive Dataset Table Parser & Viewer ──────────────────────────────
let currentDatasets = [];
let activeDatasetIndex = 0;

function parseCSV(text) {
  if (!text || !text.trim()) return { headers: [], rows: [] };
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { headers: [], rows: [] };

  const firstLine = lines[0];
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  let delimiter = ',';
  if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';
  else if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';

  const parseLine = (line) => {
    const values = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === delimiter && !inQuotes) {
        values.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    values.push(cur.trim());
    return values;
  };

  const headers = parseLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(parseLine(lines[i]));
  }
  return { headers, rows };
}

function renderDatasetTable(filterQuery = '') {
  const tableWrapper = el('datasetTableContent');
  const placeholder = el('datasetPlaceholder');
  const metaSummary = el('datasetMetaSummary');
  if (!tableWrapper || !placeholder) return;

  if (currentDatasets.length === 0) {
    placeholder.classList.remove('hidden');
    tableWrapper.classList.add('hidden');
    if (metaSummary) metaSummary.textContent = '';
    return;
  }

  const ds = currentDatasets[activeDatasetIndex];
  if (!ds || !ds.data || !ds.data.headers || ds.data.headers.length === 0) {
    placeholder.classList.remove('hidden');
    tableWrapper.classList.add('hidden');
    if (metaSummary) metaSummary.textContent = '';
    return;
  }

  placeholder.classList.add('hidden');
  tableWrapper.classList.remove('hidden');

  const { headers, rows } = ds.data;
  const q = filterQuery.toLowerCase().trim();
  const filteredRows = q ? rows.filter(r => r.some(c => String(c).toLowerCase().includes(q))) : rows;

  if (metaSummary) {
    metaSummary.textContent = `${filteredRows.length} of ${rows.length} rows × ${headers.length} cols`;
  }

  let html = '<table class="dataset-modern-table">';
  html += '<thead><tr>';
  html += '<th class="index-col">#</th>';
  headers.forEach(h => {
    html += `<th>${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';

  const maxDisplayRows = 200;
  const slice = filteredRows.slice(0, maxDisplayRows);
  slice.forEach((row, rIdx) => {
    html += '<tr>';
    html += `<td class="index-col">${rIdx + 1}</td>`;
    headers.forEach((_, cIdx) => {
      const val = row[cIdx] !== undefined ? row[cIdx] : '';
      html += `<td>${escapeHtml(String(val))}</td>`;
    });
    html += '</tr>';
  });

  if (filteredRows.length > maxDisplayRows) {
    html += `<tr><td colspan="${headers.length + 1}" class="dataset-pagination-notice">Showing first ${maxDisplayRows} of ${filteredRows.length} rows. Filter above to narrow down.</td></tr>`;
  }
  html += '</tbody></table>';

  tableWrapper.innerHTML = html;
}

const loadDatasetsForDemoQuestion = (localFiles) => {
  currentDatasets = [];
  activeDatasetIndex = 0;
  const fileSelect = el('datasetFileSelect');
  const datasetBadge = el('datasetBadge');

  if (!localFiles || localFiles.length === 0) {
    if (fileSelect) fileSelect.innerHTML = '<option value="">No datasets</option>';
    if (datasetBadge) {
      datasetBadge.textContent = '0';
      datasetBadge.style.display = 'none';
    }
    renderDatasetTable();
    return;
  }

  const dataFiles = localFiles.filter(file => {
    const lower = file.filename.toLowerCase();
    return lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt') || lower.endsWith('.json') || lower.endsWith('.dat');
  });

  if (dataFiles.length === 0) {
    if (fileSelect) fileSelect.innerHTML = '<option value="">No tabular datasets</option>';
    if (datasetBadge) {
      datasetBadge.textContent = '0';
      datasetBadge.style.display = 'none';
    }
    renderDatasetTable();
    return;
  }

  if (fileSelect) {
    fileSelect.innerHTML = '';
  }

  dataFiles.forEach((file, idx) => {
    try {
      let rawText = '';
      if (file.content) {
        rawText = atob(file.content);
      }
      const parsed = parseCSV(rawText);
      currentDatasets.push({
        filename: file.filename,
        data: parsed
      });
      if (fileSelect) {
        const opt = document.createElement('option');
        opt.value = currentDatasets.length - 1;
        opt.textContent = file.filename;
        fileSelect.appendChild(opt);
      }
    } catch (e) {
      console.warn('Failed to parse demo dataset:', file.filename, e);
    }
  });

  if (datasetBadge) {
    if (currentDatasets.length > 0) {
      datasetBadge.textContent = currentDatasets.length;
      datasetBadge.style.display = 'inline-block';
    } else {
      datasetBadge.textContent = '0';
      datasetBadge.style.display = 'none';
    }
  }

  renderDatasetTable();
};

// State management for local demo environment
const state = {
  demoMode: true,
  questions: [],
  activeQuestionIndex: 0,
  drafts: {},
  runWs: null,
  sqlNotebook: {}
};

function initSqlNotebookForQuestion(questionId, initialCode) {
  if (!state.sqlNotebook) state.sqlNotebook = {};
  if (state.sqlNotebook[questionId] && state.sqlNotebook[questionId].length === 1) {
    const singleQuery = (state.sqlNotebook[questionId][0].query || '').trim();
    const isOtherBoilerplate = Object.entries(BOILERPLATES).some(([l, b]) => l !== 'mysql' && b.trim() === singleQuery);
    if (isOtherBoilerplate || singleQuery.startsWith('# Write your') || singleQuery.startsWith('public class') || singleQuery.startsWith('#include')) {
      state.sqlNotebook[questionId][0].query = '-- Write your SQL query here\n';
    }
    return;
  }
  if (state.sqlNotebook[questionId] && state.sqlNotebook[questionId].length > 0) {
    return;
  }
  let code = (initialCode || '').trim();
  const isOtherBoilerplate = Object.entries(BOILERPLATES).some(([l, b]) => l !== 'mysql' && b.trim() === code);
  if (!code || isOtherBoilerplate || code.startsWith('#') || code.startsWith('public class') || code.startsWith('#include')) {
    code = '-- Write your SQL query here\n';
  } else {
    code = initialCode;
  }
  state.sqlNotebook[questionId] = [
    {
      id: 'cell_' + Date.now() + '_0',
      query: code,
      output: null
    }
  ];
}

function getMergedSqlCode(questionId) {
  if (!questionId) return '';
  if (!state.sqlNotebook || !state.sqlNotebook[questionId] || state.sqlNotebook[questionId].length === 0) {
    return (state.drafts && state.drafts[questionId]?.code) || '';
  }
  const cells = state.sqlNotebook[questionId];
  return cells
    .map((c, idx) => {
      const q = (c.query || '').trim();
      if (!q) return '';
      return `-- Cell ${idx + 1}\n${q}${q.endsWith(';') ? '' : ';'}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

// Event logging helper
const logEvent = (value) => {
  console.log('[Demo Log]:', value);
  const term = el('terminalOutput');
  if (term) {
    term.textContent += (term.textContent ? '\n' : '') + (typeof value === 'string' ? value : JSON.stringify(value));
    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
  }
};

// Save current tab state to memory drafts
const saveCurrentTabState = () => {
  const activeQ = state.questions[state.activeQuestionIndex];
  if (activeQ) {
    const lang = el('languageSelect') ? el('languageSelect').value : 'python';
    const code = (lang === 'mysql') ? getMergedSqlCode(activeQ.id) : getEditorValue();
    state.drafts[activeQ.id] = {
      code,
      language: lang,
      sqlCells: (state.sqlNotebook && state.sqlNotebook[activeQ.id]) ? state.sqlNotebook[activeQ.id] : null,
      terminal: el('terminalOutput') ? el('terminalOutput').textContent : '',
      terminalColor: el('terminalOutput') ? el('terminalOutput').style.color : '#10b981',
    };
  }
};

// PDF Document Cache: map of url/source -> Promise<pdfDoc>
const pdfDocCache = new Map();

async function getPdfDocument(pdfSource) {
  if (pdfDocCache.has(pdfSource)) {
    return await pdfDocCache.get(pdfSource);
  }

  const loadPromise = (async () => {
    if (typeof pdfSource === 'object' && pdfSource && pdfSource.numPages) {
      return pdfSource;
    }

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js';
    } else {
      throw new Error('PDF.js library is not loaded');
    }

    let sourceParam = pdfSource;
    if (typeof pdfSource === 'string') {
      if (pdfSource.startsWith('data:application/pdf;base64,') || pdfSource.startsWith('data:application/octet-stream;base64,')) {
        const b64 = pdfSource.split(',')[1];
        const binaryString = atob(b64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        sourceParam = { data: bytes };
      } else if (pdfSource.startsWith('http://') || pdfSource.startsWith('https://')) {
        let loadedBytes = null;
        if (window.electronAPI && window.electronAPI.fetchBinaryUrl) {
          try {
            const res = await window.electronAPI.fetchBinaryUrl(pdfSource);
            if (res && res.success && res.base64) {
              const binaryString = atob(res.base64);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              loadedBytes = bytes;
            }
          } catch (e) {
            console.warn('Electron binary fetch fallback:', e);
          }
        }
        if (loadedBytes) {
          sourceParam = { data: loadedBytes };
        } else {
          sourceParam = { url: pdfSource, withCredentials: true };
        }
      }
    }

    const task = window.pdfjsLib.getDocument(sourceParam);
    return await task.promise;
  })();

  pdfDocCache.set(pdfSource, loadPromise);
  return await loadPromise;
}

async function renderPdfPagesToContainer(container, pdfDoc, scale = 1.0, fitWidth = true) {
  if (!container || !pdfDoc) return;

  // Concurrency & Cancellation Management
  const renderId = (container._currentRenderId = (container._currentRenderId || 0) + 1);

  if (container._activeRenderTasks && Array.isArray(container._activeRenderTasks)) {
    for (const task of container._activeRenderTasks) {
      try {
        if (task && typeof task.cancel === 'function') task.cancel();
      } catch (e) {
        // ignore cancellation errors
      }
    }
  }
  container._activeRenderTasks = [];

  container.innerHTML = '<div class="pdf-loading-indicator"><div class="pdf-loading-spinner"></div><span>Rendering document...</span></div>';

  try {
    const numPages = pdfDoc.numPages;
    if (numPages === 0) {
      container.innerHTML = '<div style="padding: 24px; color: var(--muted); text-align: center;">Empty document</div>';
      return;
    }

    // Determine container available width upfront before DOM changes or scrollbar shifts
    const parent = container.closest('.pdf-frame-wrapper') || container.parentElement || container;
    const parentWidth = parent ? parent.clientWidth : container.clientWidth;
    const availableWidth = Math.max(280, (parentWidth || 600) - 36);

    const firstPage = await pdfDoc.getPage(1);
    if (container._currentRenderId !== renderId) return;

    const firstPageBaseViewport = firstPage.getViewport({ scale: 1.0 });
    const uniformFitRatio = fitWidth ? (availableWidth / firstPageBaseViewport.width) : 1.0;

    const outputScale = Math.min(2.0, window.devicePixelRatio || 1);
    const renderedCards = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (container._currentRenderId !== renderId) return;

      const page = (pageNum === 1) ? firstPage : await pdfDoc.getPage(pageNum);
      if (container._currentRenderId !== renderId) return;

      const baseViewport = page.getViewport({ scale: 1.0 });
      const pageScale = (fitWidth ? (availableWidth / baseViewport.width) : 1.0) * scale;
      const viewport = page.getViewport({ scale: pageScale });

      const pageCard = document.createElement('div');
      pageCard.className = 'pdf-page-card no-copy-zone';
      pageCard.style.width = `${Math.floor(viewport.width)}px`;
      pageCard.style.height = `${Math.floor(viewport.height)}px`;

      if (numPages > 1) {
        const pageBadge = document.createElement('div');
        pageBadge.style.cssText = 'position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.75); color: #fff; font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 4px; pointer-events: none; z-index: 10;';
        pageBadge.textContent = `Page ${pageNum} of ${numPages}`;
        pageCard.appendChild(pageBadge);
      }

      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas no-copy-zone';
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      canvas.setAttribute('draggable', 'false');
      canvas.oncontextmenu = (e) => { e.preventDefault(); return false; };

      const ctx = canvas.getContext('2d');
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      pageCard.appendChild(canvas);
      renderedCards.push({ page, pageCard, ctx, transform, viewport });
    }

    if (container._currentRenderId !== renderId) return;

    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const item of renderedCards) {
      fragment.appendChild(item.pageCard);
    }
    container.appendChild(fragment);

    for (const item of renderedCards) {
      if (container._currentRenderId !== renderId) return;

      const renderTask = item.page.render({
        canvasContext: item.ctx,
        transform: item.transform,
        viewport: item.viewport
      });

      container._activeRenderTasks.push(renderTask);

      try {
        await renderTask.promise;
      } catch (err) {
        if (err && (err.name === 'RenderingCancelledException' || err.message === 'Rendering cancelled')) {
          return;
        }
        throw err;
      }
    }
  } catch (err) {
    if (container._currentRenderId !== renderId) return;
    if (err && (err.name === 'RenderingCancelledException' || err.message === 'Rendering cancelled')) {
      return;
    }
    console.error('Failed to render PDF pages:', err);
    container.innerHTML = `<div style="padding: 24px; color: #ef4444; text-align: center;">Failed to render document: ${err.message || err}</div>`;
  }
}

const renderDemoFiles = () => {
  const container = el('demoFilesList');
  const countBadge = el('attachedFilesCountBadge');
  if (!container) return;

  const q = state.questions[state.activeQuestionIndex];
  const files = (q && q.localFiles) ? q.localFiles : [];

  if (countBadge) countBadge.textContent = files.length;

  if (files.length === 0) {
    container.innerHTML = `
      <div id="noFilesPlaceholder" style="text-align: center; padding: 24px 12px; color: var(--muted); font-size: 0.8rem; border: 1.5px dashed var(--panel-border); border-radius: 8px;">
        No files attached yet.<br>Click <strong>+ Add Files</strong> to upload CSV, PDF, or images.
      </div>
    `;
    return;
  }

  container.innerHTML = files.map((file, idx) => {
    const isCsv = file.filename.endsWith('.csv') || file.filename.endsWith('.tsv');
    const isPdf = file.filename.endsWith('.pdf');
    const isImg = file.filename.match(/\.(png|jpe?g|gif|webp|svg)$/i);
    
    let tag = 'FILE';
    let tagBg = 'rgba(100, 116, 139, 0.15)';
    let tagColor = '#94a3b8';

    if (isCsv) {
      tag = 'CSV';
      tagBg = 'rgba(59, 130, 246, 0.15)';
      tagColor = '#3b82f6';
    } else if (isPdf) {
      tag = 'PDF';
      tagBg = 'rgba(239, 68, 68, 0.15)';
      tagColor = '#ef4444';
    } else if (isImg) {
      tag = 'IMAGE';
      tagBg = 'rgba(16, 185, 129, 0.15)';
      tagColor = '#10b981';
    }

    return `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; background: var(--bg-2); border: 1px solid var(--panel-border); border-radius: 8px;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; flex: 1; cursor: pointer;" class="demo-file-open-action" data-index="${idx}">
          <span style="font-size: 0.68rem; font-weight: 800; padding: 2px 5px; border-radius: 4px; background: ${tagBg}; color: ${tagColor};">${tag}</span>
          <span style="font-size: 0.82rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.filename)}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="demo-file-delete-btn" data-index="${idx}" title="Delete file" style="background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 2px 6px; font-size: 0.8rem; border-radius: 4px; transition: all 0.15s;">✕</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.demo-file-open-action').forEach(elItem => {
    elItem.addEventListener('click', () => {
      const idx = parseInt(elItem.getAttribute('data-index'), 10);
      const file = files[idx];
      if (!file) return;

      if (file.filename.endsWith('.csv') || file.filename.endsWith('.tsv')) {
        switchBottomTab('dataset');
        const select = el('datasetFileSelect');
        if (select) {
          select.value = file.filename;
          select.dispatchEvent(new Event('change'));
        }
      } else if (file.filename.endsWith('.pdf')) {
        if (typeof window.openPdfModal === 'function') {
          const pdfUrl = file.dataUrl || `data:application/pdf;base64,${file.content}`;
          window.openPdfModal(pdfUrl, file.filename);
        }
      } else if (file.filename.match(/\.(png|jpe?g|gif|webp|svg)$/i)) {
        const imgSrc = file.dataUrl || `data:image/png;base64,${file.content}`;
        openImageLightbox(imgSrc);
      }
    });
  });

  container.querySelectorAll('.demo-file-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-index'), 10);
      files.splice(idx, 1);
      q.localFiles = files;
      loadDatasetsForDemoQuestion(q.localFiles);
      renderDemoFiles();
    });
  });
};

// Switch Active Tab State
const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  renderDemoFiles();

  // Load datasets if attached
  loadDatasetsForDemoQuestion(q.localFiles);

  const draft = state.drafts[q.id] || {
    code: '',
    language: q.language || 'python',
    terminal: 'Terminal ready. Write code and click Run Code.',
    terminalColor: '#10b981',
  };

  if (draft.sqlCells && Array.isArray(draft.sqlCells)) {
    state.sqlNotebook[q.id] = draft.sqlCells;
  }

  if (!draft.code || !draft.code.trim()) {
    draft.code = BOILERPLATES[draft.language] || '';
  }

  setEditorValue(draft.code);
  el('languageSelect').value = draft.language;
  setEditorLanguage(draft.language);
  updateLanguageWorkspace(draft.language);
  el('terminalOutput').textContent = draft.terminal;
  el('terminalOutput').style.color = draft.terminalColor;

  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });
};

function createNewProgram(title = null, lang = 'python') {
  const nextNum = state.questions.length + 1;
  const newQ = {
    id: `demo-q-${Date.now()}`,
    number: nextNum,
    title: title || `Program ${nextNum}`,
    prompt: '',
    language: lang,
    localFiles: []
  };

  saveCurrentTabState();
  state.questions.push(newQ);
  state.drafts[newQ.id] = {
    code: BOILERPLATES[newQ.language] || '',
    language: newQ.language,
    terminal: 'Terminal ready. Write code and click Run Code.',
    terminalColor: '#10b981',
  };

  state.activeQuestionIndex = state.questions.length - 1;
  renderTabs();
  loadTabState(state.activeQuestionIndex);
}

// Render program tab bar
const renderTabs = () => {
  const tabsContainer = el('studentTabs');
  const splitContainer = el('workspaceSplitContainer');

  if (state.questions.length === 0) {
    createNewProgram('Program 1', 'python');
    return;
  }

  if (splitContainer) splitContainer.classList.remove('hidden');
  if (!tabsContainer) return;

  tabsContainer.innerHTML = '';

  state.questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.style.position = 'relative';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    if (idx === state.activeQuestionIndex) btn.classList.add('active');

    const label = document.createElement('span');
    label.textContent = q.title || `Program ${idx + 1}`;
    btn.appendChild(label);

    if (state.questions.length > 1) {
      const closeBtn = document.createElement('span');
      closeBtn.textContent = '✕';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.fontSize = '0.75rem';
      closeBtn.style.opacity = '0.6';
      closeBtn.style.padding = '2px 4px';
      closeBtn.style.borderRadius = '4px';
      closeBtn.style.transition = 'all 0.2s';
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.opacity = '1';
        closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        closeBtn.style.color = '#ef4444';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.opacity = '0.6';
        closeBtn.style.background = 'transparent';
        closeBtn.style.color = 'inherit';
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();

        if (!confirm(`Are you sure you want to close ${q.title || `Program ${idx + 1}`}? All draft code for this program will be lost.`)) {
          return;
        }

        state.questions.splice(idx, 1);
        delete state.drafts[q.id];

        if (state.activeQuestionIndex === idx) {
          state.activeQuestionIndex = Math.max(0, idx - 1);
        } else if (state.activeQuestionIndex > idx) {
          state.activeQuestionIndex--;
        }

        renderTabs();
        if (state.questions.length > 0) {
          loadTabState(state.activeQuestionIndex);
        }
      });
      btn.appendChild(closeBtn);
    }

    btn.addEventListener('click', (e) => {
      if (e.target.textContent === '✕') return;
      saveCurrentTabState();
      loadTabState(idx);
      renderTabs();
    });
    tabsContainer.appendChild(btn);
  });

  // Add '+ New Program' button if tabs count < 10
  if (state.questions.length < 10) {
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-btn-add';
    addBtn.textContent = '+ New Program';
    addBtn.type = 'button';
    addBtn.style.padding = '6px 12px';
    addBtn.style.background = 'var(--bg-2)';
    addBtn.style.border = '1px dashed var(--panel-border)';
    addBtn.style.borderRadius = '8px';
    addBtn.style.color = 'var(--accent-2)';
    addBtn.style.fontWeight = '700';
    addBtn.style.cursor = 'pointer';
    addBtn.style.fontSize = '0.8rem';
    addBtn.style.marginLeft = '4px';
    addBtn.style.transition = 'all 0.15s ease';
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.background = 'var(--panel)';
      addBtn.style.borderColor = 'var(--accent)';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.background = 'var(--bg-2)';
      addBtn.style.borderColor = 'var(--panel-border)';
    });
    addBtn.addEventListener('click', () => {
      createNewProgram();
    });
    tabsContainer.appendChild(addBtn);
  }
};

// Lightbox image viewer controllers
const openImageLightbox = (src) => {
  if (el('lightboxImage')) el('lightboxImage').src = src;
  if (el('lightboxDownloadBtn')) el('lightboxDownloadBtn').href = src;
  if (el('imageLightboxModal')) el('imageLightboxModal').classList.remove('hidden');
};

if (el('closeLightboxBtn')) {
  el('closeLightboxBtn').addEventListener('click', () => {
    if (el('imageLightboxModal')) el('imageLightboxModal').classList.add('hidden');
    if (el('lightboxImage')) el('lightboxImage').src = '';
  });
}

// PDF Viewer Modal Controller
let pdfModalZoomScale = 1.0;
let currentModalPdfDoc = null;
const pdfModal = el('pdfViewerModal');
const pdfModalTitle = el('pdfModalTitle');
const pdfModalZoomLabel = el('pdfModalZoomLabel');
const pdfModalFrameWrapper = el('pdfModalFrameWrapper');
const pdfModalCanvasContainer = el('pdfModalCanvasContainer');

window.openPdfModal = async (source, title) => {
  if (!pdfModal || !pdfModalCanvasContainer) return;
  if (pdfModalTitle) pdfModalTitle.textContent = `Document: ${title || 'Document'}`;
  pdfModalZoomScale = 1.0;
  if (pdfModalZoomLabel) pdfModalZoomLabel.textContent = '100%';
  pdfModal.classList.remove('hidden');
  if (pdfModalFrameWrapper) {
    pdfModalFrameWrapper.scrollLeft = 0;
    pdfModalFrameWrapper.scrollTop = 0;
  }

  try {
    currentModalPdfDoc = await getPdfDocument(source);
    await renderPdfPagesToContainer(pdfModalCanvasContainer, currentModalPdfDoc, 1.0, true);
  } catch (e) {
    console.error('Modal PDF load failed:', e);
    pdfModalCanvasContainer.innerHTML = `<div style="padding: 24px; color: #ef4444;">Failed to load PDF: ${e.message || e}</div>`;
  }
};

const closePdfModal = () => {
  if (pdfModal) {
    pdfModal.classList.add('hidden');
    if (pdfModalCanvasContainer) pdfModalCanvasContainer.innerHTML = '';
    currentModalPdfDoc = null;
  }
};

if (el('closePdfModalBtn')) {
  el('closePdfModalBtn').addEventListener('click', closePdfModal);
}

const updatePdfModalZoom = async (newScale) => {
  if (!currentModalPdfDoc || !pdfModalCanvasContainer) return;
  pdfModalZoomScale = Math.min(2.5, Math.max(0.6, Math.round(newScale * 100) / 100));
  if (pdfModalZoomLabel) pdfModalZoomLabel.textContent = `${Math.round(pdfModalZoomScale * 100)}%`;
  await renderPdfPagesToContainer(pdfModalCanvasContainer, currentModalPdfDoc, pdfModalZoomScale, true);
};

if (el('pdfModalZoomIn')) {
  el('pdfModalZoomIn').addEventListener('click', () => updatePdfModalZoom(pdfModalZoomScale + 0.25));
}
if (el('pdfModalZoomOut')) {
  el('pdfModalZoomOut').addEventListener('click', () => updatePdfModalZoom(pdfModalZoomScale - 0.25));
}
if (el('pdfModalZoomReset')) {
  el('pdfModalZoomReset').addEventListener('click', () => updatePdfModalZoom(1.0));
}

// Keyboard shortcut (Escape) to close lightbox or PDF modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (pdfModal && !pdfModal.classList.contains('hidden')) {
      closePdfModal();
    }
    if (el('imageLightboxModal') && !el('imageLightboxModal').classList.contains('hidden')) {
      el('imageLightboxModal').classList.add('hidden');
    }
  }
});

// Anti-copy protection specifically targeted on PDF documents
// Ensures Monaco editor, SQL cells, terminal, etc. are 100% unaffected
document.addEventListener('copy', (e) => {
  const target = e.target;
  if (target && (target.closest('.pdf-viewer-deck-card') || target.closest('#pdfViewerModal') || target.closest('.no-copy-zone'))) {
    e.preventDefault();
    e.stopPropagation();
    if (e.clipboardData) e.clipboardData.clearData();
    return false;
  }
}, true);

document.addEventListener('cut', (e) => {
  const target = e.target;
  if (target && (target.closest('.pdf-viewer-deck-card') || target.closest('#pdfViewerModal') || target.closest('.no-copy-zone'))) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}, true);

document.addEventListener('contextmenu', (e) => {
  const target = e.target;
  if (target && (target.closest('.pdf-viewer-deck-card') || target.closest('#pdfViewerModal') || target.closest('.no-copy-zone'))) {
    e.preventDefault();
    return false;
  }
}, true);

let monacoEditorInstance = null;
let pendingEditorValue = '';

function getEditorValue() {
  if (monacoEditorInstance) {
    return monacoEditorInstance.getValue();
  }
  return pendingEditorValue;
}

function setEditorValue(val) {
  if (monacoEditorInstance) {
    monacoEditorInstance.setValue(val || '');
  } else {
    pendingEditorValue = val || '';
  }
}

function setEditorLanguage(lang) {
  if (monacoEditorInstance) {
    const model = monacoEditorInstance.getModel();
    if (model) {
      let monacoLang = lang;
      if (lang === 'cpp') monacoLang = 'cpp';
      if (lang === 'c') monacoLang = 'c';
      if (lang === 'java') monacoLang = 'java';
      if (lang === 'r') monacoLang = 'r';
      if (lang === 'mysql') monacoLang = 'sql';
      monaco.editor.setModelLanguage(model, monacoLang);
    }
  }
}

// Add or Update Plot inside Sidebar split gallery
function addOrUpdatePlot(data) {
  const plotsSidebar = el('plotsSidebar');
  const plotsPlaceholder = el('plotsPlaceholder');
  const plotsActiveDisplay = el('plotsActiveDisplay');
  const plotsActiveImg = el('plotsActiveImg');
  const plotsActiveTitle = el('plotsActiveTitle');

  if (!plotsSidebar) return;

  // Clear placeholder if it exists
  if (plotsSidebar.querySelector('div[style*="text-align"]')) {
    plotsSidebar.innerHTML = '';
  }

  state.currentPlots = state.currentPlots || {};
  state.currentPlots[data.filename] = data;

  const btnId = `plots-btn-${data.filename.replace(/[^a-zA-Z0-9]/g, '_')}`;
  let btn = document.getElementById(btnId);

  if (btn) {
    // Update thumbnail image
    const thumbImg = btn.querySelector('img');
    if (thumbImg) {
      thumbImg.src = `data:${data.type};base64,${data.content}`;
    }
    // Update active display if it's currently active
    if (state.activePlotFilename === data.filename && plotsActiveImg) {
      plotsActiveImg.src = `data:${data.type};base64,${data.content}`;
    }
  } else {
    // Create new thumbnail button
    btn = document.createElement('div');
    btn.id = btnId;
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    btn.style.padding = '8px';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.background = 'transparent';
    btn.style.color = '#e4e4e7';
    btn.style.transition = 'background 0.2s';
    btn.style.fontFamily = 'system-ui, sans-serif';
    btn.style.fontSize = '0.8rem';
    btn.style.overflow = 'hidden';
    btn.style.textOverflow = 'ellipsis';
    btn.style.whiteSpace = 'nowrap';

    const img = document.createElement('img');
    img.src = `data:${data.type};base64,${data.content}`;
    img.style.width = '40px';
    img.style.height = '30px';
    img.style.objectFit = 'contain';
    img.style.borderRadius = '3px';
    img.style.background = '#000000';
    btn.appendChild(img);

    const label = document.createElement('span');
    label.textContent = data.filename;
    label.style.overflow = 'hidden';
    label.style.textOverflow = 'ellipsis';
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      // Un-select all buttons
      plotsSidebar.querySelectorAll('div').forEach(d => {
        if (d.id && d.id.startsWith('plots-btn-')) {
          d.style.background = 'transparent';
          d.style.borderLeft = 'none';
          d.style.paddingLeft = '8px';
        }
      });
      // Select this button
      btn.style.background = 'rgba(255, 255, 255, 0.1)';
      btn.style.borderLeft = '3px solid #10b981';
      btn.style.paddingLeft = '5px';

      state.activePlotFilename = data.filename;

      if (plotsPlaceholder) plotsPlaceholder.classList.add('hidden');
      if (plotsActiveDisplay) {
        plotsActiveDisplay.classList.remove('hidden');
        plotsActiveImg.src = `data:${data.type};base64,${data.content}`;
        plotsActiveTitle.textContent = data.filename;
      }
    });

    btn.addEventListener('mouseenter', () => {
      if (state.activePlotFilename !== data.filename) {
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      if (state.activePlotFilename !== data.filename) {
        btn.style.background = 'transparent';
      }
    });

    plotsSidebar.appendChild(btn);
  }

  if (!state.activePlotFilename || state.activePlotFilename === data.filename) {
    btn.click();
  }
}

if (el('plotsActiveImg')) {
  el('plotsActiveImg').addEventListener('click', () => {
    if (typeof openImageLightbox !== 'undefined') {
      openImageLightbox(el('plotsActiveImg').src);
    }
  });
}

// ── Theme Management (Dark Mode Default + Light Mode Toggle) ──
const getActiveTheme = () => localStorage.getItem('labexam_theme') || 'dark';

const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('labexam_theme', theme);
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.innerHTML = theme === 'dark' ? 'Light' : 'Dark';
    btn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  });
  if (typeof monaco !== 'undefined' && monaco.editor) {
    monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
  }
};

const toggleTheme = () => {
  const current = getActiveTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
};

// Initialize theme on evaluation
applyTheme(getActiveTheme());
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.theme-toggle-btn');
  if (btn) {
    toggleTheme();
  }
});

// Initialize Monaco Editor
if (typeof require !== 'undefined') {
  require(['vs/editor/editor.main'], function () {
    const container = el('codeEditor');
    if (container) {
      monacoEditorInstance = monaco.editor.create(container, {
        value: pendingEditorValue || '',
        language: 'python',
        theme: getActiveTheme() === 'dark' ? 'vs-dark' : 'vs',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'monospace',
        minimap: { enabled: false },
        lineNumbers: 'on',
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: 'always',
        autoClosingQuotes: 'always',
        folding: true,
      });

      // Register Ctrl+Shift+F formatting command
      monacoEditorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
        formatCurrentCode();
      });

      // Sync editor content in real-time to the current draft
      monacoEditorInstance.onDidChangeModelContent(() => {
        const q = state.questions[state.activeQuestionIndex];
        if (q && state.drafts[q.id]) {
          state.drafts[q.id].code = monacoEditorInstance.getValue();
        }
      });
    }
  });
}

// ── MySQL Interactive Cell Notebook Engine ────────────────────────────────
function parseMysqlAsciiTable(text) {
  if (!text || typeof text !== 'string') return null;
  const lines = text.trim().split(/\r?\n/);
  const borderIndices = [];
  lines.forEach((line, idx) => {
    if (/^\+[-+]+\+$/.test(line.trim())) {
      borderIndices.push(idx);
    }
  });

  if (borderIndices.length >= 3) {
    const headerLineIdx = borderIndices[0] + 1;
    if (headerLineIdx < borderIndices[1]) {
      const headerLine = lines[headerLineIdx];
      const headers = headerLine.split('|').slice(1, -1).map(h => h.trim());
      const rows = [];
      for (let i = borderIndices[1] + 1; i < borderIndices[2]; i++) {
        const rowLine = lines[i];
        if (rowLine.trim().startsWith('|')) {
          const cells = rowLine.split('|').slice(1, -1).map(c => c.trim());
          rows.push(cells);
        }
      }
      return { isTable: true, headers, rows, rawText: text };
    }
  }
  return { isTable: false, rawText: text };
}

function attachOutputViewSwitchers(container) {
  if (!container) return;
  const switchers = container.querySelectorAll('.sql-view-switch');
  switchers.forEach(sw => {
    const tableBtn = sw.querySelector('[data-view="table"]');
    const rawBtn = sw.querySelector('[data-view="raw"]');
    const cardParent = sw.closest('.sql-output-card');
    if (!cardParent) return;
    const tableContainer = cardParent.querySelector('.sql-table-view-container');
    const rawContainer = cardParent.querySelector('.sql-raw-view-container');

    if (tableBtn && rawBtn && tableContainer && rawContainer) {
      tableBtn.onclick = (e) => {
        e.stopPropagation();
        tableBtn.classList.add('active');
        rawBtn.classList.remove('active');
        tableContainer.style.display = 'block';
        rawContainer.style.display = 'none';
      };
      rawBtn.onclick = (e) => {
        e.stopPropagation();
        rawBtn.classList.add('active');
        tableBtn.classList.remove('active');
        tableContainer.style.display = 'none';
        rawContainer.style.display = 'block';
      };
    }
  });
}

function updateCellLineNumbers(textarea, lineNumbersEl) {
  if (!textarea || !lineNumbersEl) return;
  const lineCount = (textarea.value.match(/\n/g) || []).length + 1;
  let nums = '';
  for (let i = 1; i <= lineCount; i++) {
    nums += i + '\n';
  }
  lineNumbersEl.textContent = nums;
}

const renderCellOutputHtml = (output, cellId) => {
  if (!output) return '';
  if (output.success) {
    const raw = (output.output || '').trim();
    if (!raw) {
      return `
        <div class="sql-output-success" style="display: flex; align-items: center; justify-content: space-between; background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 8px; padding: 10px 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1rem;">✅</span>
            <span style="font-size: 0.82rem; font-weight: 600; color: #15803d;">Query executed successfully (no rows returned)</span>
          </div>
          <span style="font-size: 0.72rem; font-family: monospace; color: #047857;">⏱️ ${output.executionTimeMs || 0}ms</span>
        </div>
      `;
    }

    const tableData = parseMysqlAsciiTable(raw);
    if (tableData && tableData.isTable) {
      const headerThs = `
        <th class="row-num-th" style="width: 42px; text-align: center; color: #94a3b8; font-size: 0.72rem;">#</th>
        ${tableData.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')}
      `;
      const rowTds = tableData.rows.map((row, rIdx) => `
        <tr>
          <td class="row-num-td" style="text-align: center; color: #94a3b8; font-size: 0.72rem; background: #fafafa;">${rIdx + 1}</td>
          ${row.map(cellVal => `<td>${escapeHtml(cellVal)}</td>`).join('')}
        </tr>
      `).join('');

      return `
        <div class="sql-output-card" data-output-cell-id="${cellId || ''}">
          <div class="sql-output-meta">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sql-table-tag">📊 Result Table</span>
              <span class="sql-row-count">${tableData.rows.length} row${tableData.rows.length === 1 ? '' : 's'}</span>
              <span class="sql-exec-time">${output.executionTimeMs || 0}ms</span>
            </div>
            <div class="sql-view-switch">
              <button type="button" class="sql-view-btn active" data-view="table" title="View formatted HTML table">Table</button>
              <button type="button" class="sql-view-btn" data-view="raw" title="View raw MySQL ASCII table">Raw</button>
            </div>
          </div>
          <div class="sql-table-view-container">
            <div class="sql-table-scroll">
              <table class="sql-modern-table">
                <thead><tr>${headerThs}</tr></thead>
                <tbody>${rowTds.length > 0 ? rowTds : `<tr><td colspan="${tableData.headers.length + 1}" style="text-align:center; color:#94a3b8; padding:12px;">(Empty set)</td></tr>`}</tbody>
              </table>
            </div>
          </div>
          <div class="sql-raw-view-container" style="display: none;">
            <div class="sql-table-scroll" style="padding: 10px;">
              <pre class="sql-output-pre" style="margin: 0; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px; color: var(--text);">${escapeHtml(raw)}</pre>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="sql-output-card" data-output-cell-id="${cellId || ''}">
          <div class="sql-output-meta">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="sql-table-tag">Output</span>
              <span class="sql-exec-time">${output.executionTimeMs || 0}ms</span>
            </div>
          </div>
          <div class="sql-table-scroll" style="padding: 10px;">
            <pre class="sql-output-pre" style="margin: 0; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12px; color: var(--text);">${escapeHtml(raw)}</pre>
          </div>
        </div>
      `;
    }
  } else {
    return `
      <div class="sql-output-error">
        <div class="sql-output-error-head">MySQL Execution Error</div>
        <div class="sql-output-error-body">${escapeHtml(output.error || 'Unknown MySQL error')}</div>
      </div>
    `;
  }
};

const updateCellOutputDisplay = (card, cell) => {
  const outputContainer = card.querySelector('.sql-cell-output-container');
  const clearBtn = card.querySelector('[data-action="clear-output"]');
  const statusSpan = card.querySelector('.sql-status-badge');

  if (outputContainer) {
    if (cell.output) {
      outputContainer.classList.remove('empty');
      outputContainer.innerHTML = renderCellOutputHtml(cell.output, cell.id);
      attachOutputViewSwitchers(outputContainer);
      if (clearBtn) clearBtn.style.display = 'inline-flex';
      if (statusSpan) {
        if (cell.output.success) {
          statusSpan.className = 'sql-status-badge success';
          statusSpan.textContent = `Success (${cell.output.executionTimeMs || 0}ms)`;
        } else {
          statusSpan.className = 'sql-status-badge error';
          statusSpan.textContent = 'Failed';
        }
      }
    } else {
      outputContainer.classList.add('empty');
      outputContainer.innerHTML = '';
      if (clearBtn) clearBtn.style.display = 'none';
      if (statusSpan) {
        statusSpan.className = 'sql-status-badge ready';
        statusSpan.textContent = 'Ready';
      }
    }
  }
};

const renderSqlNotebook = (questionId) => {
  const container = el('sqlCellsList');
  if (!container) return;

  initSqlNotebookForQuestion(questionId, state.drafts[questionId]?.code || '');
  const cells = state.sqlNotebook[questionId] || [];

  if (cells.length === 1) {
    const singleQuery = (cells[0].query || '').trim();
    const isOtherBoilerplate = Object.entries(BOILERPLATES).some(([l, b]) => l !== 'mysql' && b.trim() === singleQuery);
    if (isOtherBoilerplate || singleQuery.startsWith('# Write your') || singleQuery.startsWith('public class') || singleQuery.startsWith('#include')) {
      cells[0].query = '-- Write your SQL query here\n';
    }
  }

  container.innerHTML = '';

  cells.forEach((cell, index) => {
    const card = document.createElement('div');
    card.className = 'sql-cell-card';
    card.dataset.cellId = cell.id;

    card.innerHTML = `
      <div class="sql-cell-topbar">
        <div style="display: flex; align-items: center; gap: 8px;">
          ${cell.output ? (
            cell.output.success
              ? `<span class="sql-status-badge success">Success (${cell.output.executionTimeMs || 0}ms)</span>`
              : `<span class="sql-status-badge error">Failed</span>`
          ) : `<span class="sql-status-badge ready">Ready</span>`}
        </div>
        <div class="sql-cell-actions">
          <button class="sql-action-btn" type="button" title="Insert cell below" data-action="insert-below" style="color: #2563eb; font-weight: 700;">
            <span>+</span> Below
          </button>
          <button class="sql-action-btn" type="button" title="Clear cell output" data-action="clear-output" ${!cell.output ? 'style="display:none;"' : ''}>
            Clear
          </button>
          ${cells.length > 1 ? `
          <button class="sql-action-btn delete" type="button" title="Delete cell" data-action="delete" style="font-size: 0.78rem;">
            Delete
          </button>` : ''}
        </div>
      </div>
      <div class="sql-cell-body">
        <div class="sql-cell-gutter">
          <button class="sql-gutter-run-btn" type="button" title="Run cell (Ctrl+Enter)" data-action="run">▶</button>
          <span class="sql-gutter-index">[ ${index + 1} ]</span>
        </div>
        <div class="sql-editor-container">
          <div class="sql-line-numbers">1</div>
          <div class="sql-code-area">
            <textarea class="sql-cell-textarea" spellcheck="false" placeholder="-- Write SQL query here (e.g. SELECT * FROM students;)" rows="2">${escapeHtml(cell.query || '')}</textarea>
          </div>
        </div>
      </div>
      <div class="sql-cell-output-container ${!cell.output ? 'empty' : ''}">
        ${renderCellOutputHtml(cell.output, cell.id)}
      </div>
    `;

    const textarea = card.querySelector('.sql-cell-textarea');
    const lineNumbersEl = card.querySelector('.sql-line-numbers');

    if (textarea) {
      const autoResize = () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.max(64, textarea.scrollHeight) + 'px';
        updateCellLineNumbers(textarea, lineNumbersEl);
      };
      textarea.addEventListener('input', () => {
        cell.query = textarea.value;
        autoResize();
      });
      textarea.addEventListener('scroll', () => {
        if (lineNumbersEl) lineNumbersEl.scrollTop = textarea.scrollTop;
      });
      textarea.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          runSqlNotebookCell(questionId, cell.id);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value = textarea.value.substring(0, start) + '    ' + textarea.value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + 4;
          cell.query = textarea.value;
          autoResize();
        }
      });
      setTimeout(autoResize, 10);
    }

    const gutterRunBtn = card.querySelector('.sql-gutter-run-btn');
    if (gutterRunBtn) {
      gutterRunBtn.addEventListener('click', () => runSqlNotebookCell(questionId, cell.id));
    }
    const clearBtn = card.querySelector('[data-action="clear-output"]');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        cell.output = null;
        updateCellOutputDisplay(card, cell);
      });
    }
    const insertBtn = card.querySelector('[data-action="insert-below"]');
    if (insertBtn) {
      insertBtn.addEventListener('click', () => addSqlNotebookCell(questionId, index));
    }
    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => deleteSqlNotebookCell(questionId, cell.id));
    }

    attachOutputViewSwitchers(card);
    container.appendChild(card);
  });
};

const addSqlNotebookCell = (questionId, afterIndex = -1) => {
  if (!state.sqlNotebook[questionId]) {
    state.sqlNotebook[questionId] = [];
  }
  const newCell = {
    id: 'cell_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    query: '',
    output: null
  };
  if (afterIndex >= 0 && afterIndex < state.sqlNotebook[questionId].length) {
    state.sqlNotebook[questionId].splice(afterIndex + 1, 0, newCell);
  } else {
    state.sqlNotebook[questionId].push(newCell);
  }
  renderSqlNotebook(questionId);
  setTimeout(() => {
    const card = document.querySelector(`.sql-cell-card[data-cell-id="${newCell.id}"]`);
    if (card) {
      const ta = card.querySelector('.sql-cell-textarea');
      if (ta) ta.focus();
    }
  }, 40);
};

const deleteSqlNotebookCell = (questionId, cellId) => {
  const cells = state.sqlNotebook[questionId];
  if (!cells || cells.length <= 1) return;
  state.sqlNotebook[questionId] = cells.filter(c => c.id !== cellId);
  renderSqlNotebook(questionId);
};

function getActiveDatabaseForCell(questionId, cellId) {
  const cells = (state.sqlNotebook && state.sqlNotebook[questionId]) ? state.sqlNotebook[questionId] : [];
  let activeDb = 'labexam';
  for (const c of cells) {
    const q = c.query || '';
    const matches = [...q.matchAll(/(?:^|[\s;])USE\s+[`"']?([a-zA-Z0-9_$]+)[`"']?/gi)];
    if (matches.length > 0) {
      activeDb = matches[matches.length - 1][1];
    }
    if (c.id === cellId) break;
  }
  return activeDb;
}

const runSqlNotebookCell = async (questionId, cellId) => {
  const cells = state.sqlNotebook[questionId];
  if (!cells) return;
  const cell = cells.find(c => c.id === cellId);
  if (!cell) return;

  const card = document.querySelector(`.sql-cell-card[data-cell-id="${cellId}"]`);
  const textarea = card ? card.querySelector('.sql-cell-textarea') : null;
  if (textarea) {
    cell.query = textarea.value;
  }

  if (!cell.query || !cell.query.trim()) {
    return;
  }

  if (!window.electronAPI || !window.electronAPI.runSqlCell) {
    cell.output = {
      success: false,
      output: '',
      error: 'SQL execution is only available in the desktop app.',
      executionTimeMs: 0
    };
    if (card) updateCellOutputDisplay(card, cell);
    return;
  }

  const gutterRunBtn = card ? card.querySelector('.sql-gutter-run-btn') : null;
  if (gutterRunBtn) {
    gutterRunBtn.disabled = true;
    gutterRunBtn.classList.add('running');
    gutterRunBtn.innerHTML = '⟳';
  }

  try {
    const activeDb = getActiveDatabaseForCell(questionId, cell.id);
    const res = await window.electronAPI.runSqlCell(cell.query, activeDb);
    cell.output = {
      success: !!res.success,
      output: res.output || '',
      error: res.error || '',
      executionTimeMs: res.executionTimeMs || 0
    };
    if (card) updateCellOutputDisplay(card, cell);
  } catch (err) {
    cell.output = {
      success: false,
      output: '',
      error: err.message || 'Execution failed',
      executionTimeMs: 0
    };
    if (card) updateCellOutputDisplay(card, cell);
  } finally {
    if (gutterRunBtn) {
      gutterRunBtn.disabled = false;
      gutterRunBtn.classList.remove('running');
      gutterRunBtn.innerHTML = '▶';
    }
  }
};

const runAllSqlNotebookCells = async (questionId) => {
  const cells = state.sqlNotebook[questionId];
  if (!cells || cells.length === 0) return;
  const runAllBtn = el('runAllSqlCellsBtn');
  const origText = runAllBtn ? runAllBtn.innerHTML : '▶ Run All Cells';
  if (runAllBtn) {
    runAllBtn.disabled = true;
    runAllBtn.innerHTML = '⏳ Running Cells...';
  }
  try {
    for (const cell of cells) {
      if (cell.query && cell.query.trim()) {
        await runSqlNotebookCell(questionId, cell.id);
      }
    }
  } finally {
    if (runAllBtn) {
      runAllBtn.disabled = false;
      runAllBtn.innerHTML = origText;
    }
  }
};

let resetConfirmTimer = null;
const resetSqlDatabaseAction = async () => {
  const btn = el('resetSqlDbBtn');
  if (!btn) return;
  if (!window.electronAPI || !window.electronAPI.resetSqlDatabase) {
    logEvent('Database reset is only supported in the desktop app.');
    return;
  }

  if (!btn.dataset.confirming) {
    btn.dataset.confirming = 'true';
    btn.innerHTML = '⚠️ Click again to confirm wipe';
    btn.style.background = '#dc2626';
    btn.style.color = '#ffffff';
    btn.style.borderColor = '#b91c1c';
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = setTimeout(() => {
      btn.dataset.confirming = '';
      btn.innerHTML = '🔄 Reset Database';
      btn.style.background = '#ffffff';
      btn.style.color = '#dc2626';
      btn.style.borderColor = '#fca5a5';
    }, 4000);
    return;
  }

  clearTimeout(resetConfirmTimer);
  btn.dataset.confirming = '';
  btn.disabled = true;
  btn.textContent = 'Resetting...';

  try {
    const res = await window.electronAPI.resetSqlDatabase();
    if (res && res.success) {
      logEvent('MySQL database reset: all tables cleaned.');
      btn.textContent = 'Database Cleaned';
      btn.style.background = '#10b981';
      btn.style.color = '#ffffff';
      btn.style.borderColor = '#059669';
      const q = state.questions[state.activeQuestionIndex];
      if (q && state.sqlNotebook[q.id]) {
        state.sqlNotebook[q.id].forEach(c => c.output = null);
        renderSqlNotebook(q.id);
      }
    } else {
      throw new Error(res ? res.error : 'Reset failed');
    }
  } catch (err) {
    logEvent(`Failed to reset MySQL database: ${err.message}`);
    btn.textContent = 'Reset Failed';
    btn.style.background = '#fee2e2';
    btn.style.color = '#b91c1c';
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Reset Database';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2500);
  }
};

const updateLanguageWorkspace = (lang) => {
  const isSql = lang === 'mysql';
  const standardSec = el('standardEditorSection');
  const sqlSec = el('sqlNotebookSection');

  if (isSql) {
    if (standardSec) standardSec.classList.add('hidden');
    if (sqlSec) {
      sqlSec.classList.remove('hidden');
      const q = state.questions[state.activeQuestionIndex];
      if (q) {
        renderSqlNotebook(q.id);
      }
    }
  } else {
    if (sqlSec) sqlSec.classList.add('hidden');
    if (standardSec) standardSec.classList.remove('hidden');
    if (monacoEditorInstance) {
      setTimeout(() => {
        monacoEditorInstance.layout();
      }, 50);
    }
  }
};

// Track language selection changes with boilerplate injection and workspace toggling
const languageSelect = el('languageSelect');
if (languageSelect) {
  languageSelect.addEventListener('change', (e) => {
    const lang = e.target.value;
    setEditorLanguage(lang);
    if (state.questions.length > 0) {
      const q = state.questions[state.activeQuestionIndex];
      if (q) {
        if (!state.drafts[q.id]) state.drafts[q.id] = {};
        const previousLang = state.drafts[q.id].language;
        state.drafts[q.id].language = lang;
        if (previousLang === 'mysql' && lang !== 'mysql') {
          const currentVal = (getEditorValue() || '').trim();
          if (isBoilerplateOrEmpty(currentVal) || currentVal.startsWith('--')) {
            setEditorValue(BOILERPLATES[lang] || '');
          }
          state.drafts[q.id].code = getEditorValue();
        } else if (lang === 'mysql') {
          initSqlNotebookForQuestion(q.id, '');
        } else {
          if (isBoilerplateOrEmpty(getEditorValue())) {
            setEditorValue(BOILERPLATES[lang] || '');
          }
          state.drafts[q.id].code = getEditorValue();
        }
      }
    } else {
      if (isBoilerplateOrEmpty(getEditorValue())) {
        setEditorValue(BOILERPLATES[lang] || '');
      }
    }
    updateLanguageWorkspace(lang);
  });
}

  // Draggable Splitter (VS Code Style vertical resizing)
  const splitter = el('verticalSplitter');
  const editorWrapper = el('editorResizableWrapper');
  const terminalWrapper = el('terminalResizableWrapper');

  if (splitter && editorWrapper && terminalWrapper) {
    splitter.addEventListener('mousedown', (e) => {
      e.preventDefault();
      
      const startY = e.clientY;
      const startH_ed = editorWrapper.offsetHeight;
      const startH_term = terminalWrapper.offsetHeight;
      
      splitter.classList.add('dragging');
      
      const onMouseMove = (moveEvent) => {
        const dY = moveEvent.clientY - startY;
        const newH_ed = startH_ed + dY;
        const newH_term = startH_term - dY;
        
        if (newH_ed >= 150 && newH_term >= 150) {
          editorWrapper.style.setProperty('height', newH_ed + 'px');
          terminalWrapper.style.setProperty('height', newH_term + 'px');
          
          if (monacoEditorInstance) {
            monacoEditorInstance.layout();
          }
        }
      };
      
      const onMouseUp = () => {
        splitter.classList.remove('dragging');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // Tab Switching between Console, Plots, and Dataset
  const tabConsoleBtn = el('tabConsoleBtn');
  const tabPlotsBtn = el('tabPlotsBtn');
  const tabDatasetBtn = el('tabDatasetBtn');
  const consoleContainer = el('terminalOutputContainer');
  const plotsContainer = el('plotsTabContainer');
  const datasetContainer = el('datasetTabContainer');
  const plotsBadge = el('plotsBadge');
  const datasetBadge = el('datasetBadge');

  const switchBottomTab = (activeTab) => {
    [tabConsoleBtn, tabPlotsBtn, tabDatasetBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('active');
        btn.style.borderBottom = '';
        btn.style.color = '';
      }
    });
    [consoleContainer, plotsContainer, datasetContainer].forEach(c => {
      if (c) c.classList.add('hidden');
    });

    if (activeTab === 'console' && tabConsoleBtn && consoleContainer) {
      tabConsoleBtn.classList.add('active');
      consoleContainer.classList.remove('hidden');
    } else if (activeTab === 'plots' && tabPlotsBtn && plotsContainer) {
      tabPlotsBtn.classList.add('active');
      plotsContainer.classList.remove('hidden');
      if (plotsBadge) plotsBadge.style.display = 'none';
    } else if (activeTab === 'dataset' && tabDatasetBtn && datasetContainer) {
      tabDatasetBtn.classList.add('active');
      datasetContainer.classList.remove('hidden');
      if (datasetBadge) datasetBadge.style.display = 'none';
    }
  };

  if (tabConsoleBtn) tabConsoleBtn.addEventListener('click', () => switchBottomTab('console'));
  if (tabPlotsBtn) tabPlotsBtn.addEventListener('click', () => switchBottomTab('plots'));
  if (tabDatasetBtn) tabDatasetBtn.addEventListener('click', () => switchBottomTab('dataset'));

  // Dataset File Select & Search Filter
  if (el('datasetFileSelect')) {
    el('datasetFileSelect').addEventListener('change', (e) => {
      activeDatasetIndex = parseInt(e.target.value, 10) || 0;
      const q = el('datasetSearchInput') ? el('datasetSearchInput').value : '';
      renderDatasetTable(q);
    });
  }

  if (el('datasetSearchInput')) {
    el('datasetSearchInput').addEventListener('input', (e) => {
      renderDatasetTable(e.target.value);
    });
  }

  // Format Code Button
  if (el('formatCodeBtn')) {
    el('formatCodeBtn').addEventListener('click', () => {
      formatCurrentCode();
    });
  }

  // Register Real-time Plot Updates
  if (window.electronAPI) {
    window.electronAPI.onPlotUpdated((data) => {
      addOrUpdatePlot(data);

      // Update badge if Plots tab is not currently active
      if (tabPlotsBtn && !tabPlotsBtn.classList.contains('active') && plotsBadge) {
        const currentCount = parseInt(plotsBadge.textContent || '0') + 1;
        plotsBadge.textContent = currentCount;
        plotsBadge.style.display = 'inline-block';
      }
    });
  }

// Clear terminal output
if (el('clearTerminalBtn')) {
  el('clearTerminalBtn').addEventListener('click', () => {
    if (el('terminalOutput')) el('terminalOutput').textContent = '';
  });
}

// Stdin input piping
if (el('terminalInput')) {
  el('terminalInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = el('terminalInput').value.trim();
      if (!val) return;
      
      if (state.runWs && window.electronAPI) {
        el('terminalOutput').textContent += val + '\n';
        if (el('terminalOutputContainer')) el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
        window.electronAPI.sendStdin(val);
        el('terminalInput').value = '';
      } else {
        // No program running - treat as virtual env pip command
        if (el('terminalOutput')) el('terminalOutput').textContent += `\n$ ${val}\n`;
        if (el('terminalOutputContainer')) el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
        el('terminalInput').value = '';

        const match = val.match(/^(python3\s+-m\s+)?pip(3)?\s+install\s+(.+)$/i);
        if (match && window.electronAPI) {
          const rawPackages = match[3];
          const packages = rawPackages.split(/\s+/).filter(p => p.trim() && !p.startsWith('-'));
          if (packages.length > 0) {
            el('terminalInput').disabled = true;
            el('terminalInput').placeholder = 'Installing package(s)... Please wait...';
            
            window.electronAPI.onCodeOutput((data) => {
              if (el('terminalOutput')) el('terminalOutput').textContent += data.data;
              if (el('terminalOutputContainer')) el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
            });

            window.electronAPI.onPipExit((data) => {
              if (el('terminalInput')) {
                el('terminalInput').disabled = false;
                el('terminalInput').placeholder = 'Type input here and press Enter...';
                el('terminalInput').focus();
              }
              window.electronAPI.removePipListeners();
              window.electronAPI.removeCodeListeners();
            });
            
            window.electronAPI.runPipInstall(packages);
          } else {
            if (el('terminalOutput')) el('terminalOutput').textContent += `[System Error]: Please specify at least one package name.\n`;
          }
        } else {
          if (el('terminalOutput')) el('terminalOutput').textContent += `[System Error]: Only 'pip install <package>' commands are allowed for environment setup.\n`;
        }
        if (el('terminalOutputContainer')) el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
      }
    }
  });
}

// Run Code logic
if (el('runCodeBtn')) {
  el('runCodeBtn').addEventListener('click', () => {
    const code = getEditorValue();
    const term = el('terminalOutput');
    const runBtn = el('runCodeBtn');
    const lang = el('languageSelect') ? el('languageSelect').value : 'python';

    if (state.runWs) {
      if (window.electronAPI) {
        window.electronAPI.stopCode();
      }
      state.runWs = null;
      return;
    }

    if (!window.electronAPI) {
      if (term) {
        term.style.color = '#f87171';
        term.textContent = '[Error]: Code execution is only available in the desktop app.';
      }
      return;
    }

    if (!code.trim()) {
      if (term) {
        term.style.color = '#f87171';
        term.textContent = '[Error]: Please write some code first.';
      }
      return;
    }

    state.runWs = true;

    // Clear previous outputs/plots and reset badge
    state.currentPlots = {};
    state.activePlotFilename = null;
    if (el('plotsSidebar')) {
      el('plotsSidebar').innerHTML = `<div style="color: #a1a1aa; font-size: 0.8rem; text-align: center; margin-top: 20px; font-family: system-ui, sans-serif;">No plots</div>`;
    }
    if (el('plotsPlaceholder')) {
      el('plotsPlaceholder').classList.remove('hidden');
    }
    if (el('plotsActiveDisplay')) {
      el('plotsActiveDisplay').classList.add('hidden');
    }
    if (el('executionMetricsBadge')) {
      el('executionMetricsBadge').classList.add('hidden');
    }
    const plotsBadge = el('plotsBadge');
    if (plotsBadge) {
      plotsBadge.textContent = '0';
      plotsBadge.style.display = 'none';
    }

    if (term) {
      term.textContent = `Running ${lang.toUpperCase()} code...\n`;
      term.style.color = '#a3e635';
    }
    if (runBtn) {
      runBtn.textContent = 'Stop';
      runBtn.style.background = '#ef4444';
      runBtn.style.color = '#ffffff';
    }

    if (el('terminalInput')) {
      el('terminalInput').value = '';
      el('terminalInput').focus();
    }

    const cleanupRunState = () => {
      if (runBtn) {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Code';
        runBtn.style.removeProperty('background');
        runBtn.style.removeProperty('color');
      }
      state.runWs = null;
      window.electronAPI.removeCodeListeners();
    };

    window.electronAPI.removeCodeListeners();

    window.electronAPI.onCodeOutput((data) => {
      if (term) {
        term.textContent += data.data;
        if (data.stream === 'stderr') {
          term.style.color = '#f87171';
        }
      }
      if (el('terminalOutputContainer')) {
        el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
      }
    });

    window.electronAPI.onCodeExit((data) => {
      if (term) {
        if (data.error) {
          term.style.color = '#f87171';
          term.textContent += '\n' + data.error;
        } else if (data.exitCode === 0) {
          term.style.color = '#10b981';
          if (!term.textContent.trim()) {
            term.textContent = 'Program finished with no output.';
          }
        } else if (data.exitCode === -1) {
          term.style.color = '#f87171';
          term.textContent += '\n[Stopped by user]';
        } else {
          if (!term.style.color || term.style.color === 'rgb(163, 230, 53)') {
            term.style.color = '#f87171';
          }
        }
      }

      if (data.generatedFiles && data.generatedFiles.length > 0) {
        data.generatedFiles.forEach(file => {
          addOrUpdatePlot(file);
        });

        // Update badge if Plots tab is not active
        const tabPlotsBtn = el('tabPlotsBtn');
        const plotsBadge = el('plotsBadge');
        if (tabPlotsBtn && !tabPlotsBtn.classList.contains('active') && plotsBadge) {
          plotsBadge.textContent = data.generatedFiles.length;
          plotsBadge.style.display = 'inline-block';
        }
      }

      if (el('executionMetricsBadge')) {
        const timeSec = ((data.executionTimeMs || 0) / 1000).toFixed(2);
        const memStr = data.peakMemoryMb ? ` | 💾 ${data.peakMemoryMb} MB` : '';
        el('executionMetricsBadge').textContent = `⏱️ ${timeSec}s${memStr}`;
        el('executionMetricsBadge').style.color = data.exitCode === 0 ? '#15803d' : '#b91c1c';
        el('executionMetricsBadge').style.background = data.exitCode === 0 ? '#dcfce7' : '#fee2e2';
        el('executionMetricsBadge').style.borderColor = data.exitCode === 0 ? '#bbf7d0' : '#fecaca';
        el('executionMetricsBadge').classList.remove('hidden');
      }

      if (el('terminalOutputContainer')) {
        el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
      }
      cleanupRunState();
    });

    const q = state.questions[state.activeQuestionIndex];
    let attachments = [];
    if (q && q.localFiles) {
      attachments = q.localFiles.map(file => ({
        filename: file.filename,
        content: file.content,
        isLocal: true
      }));
    }

    window.electronAPI.runCode(code, lang, attachments);
  });
}

// Save locally
const saveLocalSolution = async (btn) => {
  if (!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  saveCurrentTabState();
  const q = state.questions[state.activeQuestionIndex];
  const activeTitle = q ? (q.title || 'program').replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'untitled';
  const folderName = `SecureLab_Saved_Code/${activeTitle}`;
  const lang = el('languageSelect') ? el('languageSelect').value : 'python';
  const ext = lang === 'python' ? 'py' : lang === 'r' ? 'R' : lang === 'mysql' ? 'sql' : lang;
  const filename = `${activeTitle}.${ext}`;
  const code = (lang === 'mysql') ? getMergedSqlCode(q ? q.id : '') : getEditorValue();

  try {
    if (!window.electronAPI) throw new Error('Available in desktop app only.');
    
    // 1. Save code file
    await window.electronAPI.saveLocalFile(folderName, filename, code);
    
    // 2. Save question metadata and prompt description
    if (q) {
      const questionContent = `Title: ${q.title}\nLanguage: ${lang}\n\nDescription/Prompt:\n${q.prompt || ''}\n`;
      await window.electronAPI.saveLocalFile(folderName, `${activeTitle}_question.txt`, questionContent);
      
      // 3. Save attached local files (CSV, PDF, Images, etc.)
      if (q.localFiles && q.localFiles.length > 0) {
        for (const file of q.localFiles) {
          await window.electronAPI.saveLocalFile(folderName, file.filename, file.content, 'base64');
        }
      }
    }

    btn.textContent = 'Saved';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2500);
  } catch (err) {
    btn.textContent = '✖ Error';
    btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    btn.style.color = '#ffffff';
    alert(err.message);
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2500);
  }
};

if (el('saveLocalBtn')) {
  el('saveLocalBtn').addEventListener('click', () => saveLocalSolution(el('saveLocalBtn')));
}
if (el('saveLocalSqlBtn')) {
  el('saveLocalSqlBtn').addEventListener('click', () => saveLocalSolution(el('saveLocalSqlBtn')));
}

if (el('addSqlCellBtn')) {
  el('addSqlCellBtn').addEventListener('click', () => {
    const q = state.questions[state.activeQuestionIndex];
    if (q) addSqlNotebookCell(q.id);
  });
}

if (el('runAllSqlCellsBtn')) {
  el('runAllSqlCellsBtn').addEventListener('click', () => {
    const q = state.questions[state.activeQuestionIndex];
    if (q) runAllSqlNotebookCells(q.id);
  });
}

if (el('resetSqlDbBtn')) {
  el('resetSqlDbBtn').addEventListener('click', () => {
    resetSqlDatabaseAction();
  });
}

if (el('formatCodeBtn')) {
  el('formatCodeBtn').addEventListener('click', () => {
    formatCurrentCode();
  });
}

// ── File Upload & Drag-and-Drop Handler ──
async function processFilesForCurrentProgram(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  const q = state.questions[state.activeQuestionIndex];
  if (!q) return;
  if (!q.localFiles) q.localFiles = [];

  let hasDataset = false;

  for (const file of files) {
    const isCsv = file.name.endsWith('.csv') || file.name.endsWith('.tsv') || file.name.endsWith('.txt') || file.name.endsWith('.json');
    if (isCsv) hasDataset = true;

    const fileData = await new Promise((resolve) => {
      const reader = new FileReader();
      if (isCsv) {
        reader.onload = (ev) => {
          const text = ev.target.result;
          let base64 = '';
          try {
            base64 = btoa(unescape(encodeURIComponent(text)));
          } catch (err) {
            base64 = btoa(text);
          }
          resolve({
            filename: file.name,
            content: base64,
            dataUrl: `data:text/plain;base64,${base64}`
          });
        };
        reader.readAsText(file);
      } else {
        reader.onload = (ev) => {
          const dataUrl = ev.target.result;
          const base64Content = dataUrl.split(',')[1] || '';
          resolve({
            filename: file.name,
            content: base64Content,
            dataUrl: dataUrl
          });
        };
        reader.readAsDataURL(file);
      }
    });

    const existingIdx = q.localFiles.findIndex(f => f.filename === fileData.filename);
    if (existingIdx >= 0) {
      q.localFiles[existingIdx] = fileData;
    } else {
      q.localFiles.push(fileData);
    }
  }

  loadDatasetsForDemoQuestion(q.localFiles);
  renderDemoFiles();

  if (hasDataset) {
    switchBottomTab('dataset');
    const select = el('datasetFileSelect');
    if (select && currentDatasets.length > 0) {
      select.value = currentDatasets.length - 1;
      select.dispatchEvent(new Event('change'));
    }
  }
}

// Wire + Add Files button
const addFileBtn = el('addLocalFileBtn');
const fileInput = el('demoAttachFileInput');

if (addFileBtn && fileInput) {
  addFileBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    await processFilesForCurrentProgram(e.target.files);
    fileInput.value = '';
  });
}

// Wire Drag and Drop on Attached Files Panel
const attachedPanel = el('attachedFilesPanel');
if (attachedPanel) {
  ['dragenter', 'dragover'].forEach(eventName => {
    attachedPanel.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachedPanel.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    attachedPanel.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      attachedPanel.classList.remove('drag-over');
    }, false);
  });

  attachedPanel.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length > 0) {
      await processFilesForCurrentProgram(dt.files);
    }
  });
}

// Exit button
if (el('exitDemoBtn')) {
  el('exitDemoBtn').addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

// Window controls listeners
const demoMinBtn = el('demoMinimizeBtn');
const demoFullBtn = el('demoFullscreenBtn');
const demoCloseBtn = el('demoCloseBtn');

if (demoMinBtn) {
  demoMinBtn.addEventListener('click', () => {
    if (window.electronAPI && typeof window.electronAPI.minimizeApp === 'function') {
      window.electronAPI.minimizeApp();
    }
  });
}

if (demoFullBtn) {
  let isFullscreen = false;
  demoFullBtn.addEventListener('click', () => {
    if (window.electronAPI) {
      if (typeof window.electronAPI.toggleMaximize === 'function') {
        window.electronAPI.toggleMaximize();
      } else if (typeof window.electronAPI.requestFullscreen === 'function') {
        isFullscreen = !isFullscreen;
        window.electronAPI.requestFullscreen(isFullscreen);
      }
    }
  });
}

if (demoCloseBtn) {
  demoCloseBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to close SecureLab? Any unsaved changes will be lost.')) {
      if (window.electronAPI && typeof window.electronAPI.exitApp === 'function') {
        window.electronAPI.exitApp();
      } else {
        window.close();
      }
    }
  });
}

// Auto-initialize workspace with Program 1
if (state.questions.length === 0) {
  createNewProgram('Program 1', 'python');
} else {
  renderTabs();
  loadTabState(state.activeQuestionIndex);
}
