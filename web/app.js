// Intercept and disable dangerous keyboard shortcuts (Ctrl+W, Ctrl+Q, Ctrl+R, Win+D, Super+D, F5) during the exam
window.addEventListener('keydown', (e) => {
  if (state.role === 'student' && state.questions && state.questions.length > 0) {
    const key = e.key.toLowerCase();
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    
    // Block Ctrl+W, Ctrl+Q, Ctrl+R, Win/Meta+D, Win/Meta+H, Win/Meta+M, F5
    if ((ctrlOrMeta && (key === 'w' || key === 'q' || key === 'r' || key === 'd' || key === 'h' || key === 'm')) || e.key === 'F5') {
      e.preventDefault();
      e.stopPropagation();
      console.warn(`[ExamGuard] Blocked dangerous shortcut: ${e.key}`);
    }
  }
}, { capture: true });

const state = {
  mode: 'student',
  token: localStorage.getItem('securemlexam_token') || '',
  role: localStorage.getItem('securemlexam_role') || 'student',
  name: localStorage.getItem('securemlexam_name') || '',
  rollNumber: localStorage.getItem('securemlexam_rollnumber') || '',
  serverUrl: localStorage.getItem('securemlexam_server_url') || 'https://exams.crraoaimscs.ac.in',
  examId: localStorage.getItem('securemlexam_exam_id') || 'exam-1',
  examCode: '',
  activeAttemptId: localStorage.getItem('securemlexam_attempt_id') || '',
  ws: null,
  currentClassStudents: [],
  selectedStudentRolls: new Set(),
  submissions: [],
  securityArmed: false,
  questions: [],
  activeQuestionIndex: 0,
  drafts: {},
  runWs: null,
  sqlNotebook: {},
};

const el = (id) => document.getElementById(id);

const cleanAttachmentFilename = (filename) => {
  if (!filename) return '';
  // Strips PocketBase random hashes, e.g. 'scores_h1lddobkyq.csv' -> 'scores.csv'
  const match = filename.match(/^(.+?)_[a-z0-9]{8,24}(?:_[a-z0-9]{8,24})*\.([a-zA-Z0-9]+)$/i);
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  return filename;
};

const loginForm = el('loginForm');
const studentView = el('studentView');
const tokenPreview = el('tokenPreview');
const workspaceTitle = el('workspaceTitle');
const workspaceHint = el('workspaceHint');
const serverStatus = el('serverStatus');
const statusText = el('statusText');
const eventLog = el('eventLog');
const questionBank = el('questionBank');
const studentList = el('studentList');
const examLabel = el('examLabel');
const questionLabel = el('questionLabel');
const questionTitle = el('questionTitle');
const questionPrompt = el('questionPrompt');
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

const escapeHtml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const BOILERPLATES = {
  python: `# Write your Python 3 code here\n`,
  c: `#include <stdio.h>\n\nint main() {\n    // Write your C code here\n    return 0;\n}\n`,
  cpp: `#include <iostream>\nusing namespace std;\n\nint main() {\n    // Write your C++ code here\n    return 0;\n}\n`,
  java: `public class Main {\n    public static void main(String[] args) {\n        // Write your Java code here\n    }\n}\n`,
  r: `# Write your R code here\n`,
  mysql: `-- Write your SQL query here\n`
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

const getAutosaveKey = () => {
  if (state.examId && state.rollNumber) {
    return `securelab_draft_${state.examId}_${state.rollNumber}`;
  }
  return null;
};

let autosaveTimer = null;
let serverSyncTimer = null;

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

const saveEmergencyDiskBackup = async () => {
  if (!window.electronAPI || !state.rollNumber || state.questions.length === 0) return;
  const q = state.questions[state.activeQuestionIndex];
  if (!q) return;

  const lang = el('languageSelect') ? el('languageSelect').value : 'python';
  const code = (lang === 'mysql') ? getMergedSqlCode(q.id) : getEditorValue();
  const ext = lang === 'python' ? 'py' : lang === 'r' ? 'R' : lang === 'mysql' ? 'sql' : lang;
  const folderName = `SecureLab_Emergency_Backups/${state.rollNumber}`;
  const filename = `Question_${q.number || (state.activeQuestionIndex + 1)}.${ext}`;

  try {
    await window.electronAPI.saveLocalFile(folderName, filename, code);
  } catch (_) {}
};

const syncActiveDraftToServer = async () => {
  if (!state.examId || !state.rollNumber || state.role !== 'student' || state.questions.length === 0) return;
  const q = state.questions[state.activeQuestionIndex];
  if (!q || !q.id || q.id.startsWith('demo-')) return;

  const lang = el('languageSelect') ? el('languageSelect').value : 'python';
  const code = (lang === 'mysql') ? getMergedSqlCode(q.id) : getEditorValue();
  if (code === undefined || code === null) return;

  try {
    await api('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: q.id,
        student_roll_no: state.rollNumber,
        response: code,
      }),
    });
  } catch (err) {
    // Silent catch so student experience is never interrupted
  }
};

const saveDraftSnapshot = () => {
  const key = getAutosaveKey();
  if (!key) return;
  try {
    if (state.questions.length > 0) {
      const q = state.questions[state.activeQuestionIndex];
      if (q) {
        if (!state.drafts[q.id]) state.drafts[q.id] = {};
        const langEl = el('languageSelect');
        const lang = langEl ? langEl.value : 'python';
        state.drafts[q.id].language = lang;
        state.drafts[q.id].code = (lang === 'mysql') ? getMergedSqlCode(q.id) : getEditorValue();
        state.drafts[q.id].sqlCells = (state.sqlNotebook && state.sqlNotebook[q.id]) ? state.sqlNotebook[q.id] : null;
        const termEl = el('terminalOutput');
        if (termEl) {
          state.drafts[q.id].terminal = termEl.textContent;
          state.drafts[q.id].terminalColor = termEl.style.color || '#10b981';
        }
      }
    }
    localStorage.setItem(key, JSON.stringify({
      drafts: state.drafts,
      activeQuestionIndex: state.activeQuestionIndex,
      savedAt: Date.now()
    }));
  } catch (_) {}
  saveEmergencyDiskBackup();
};

const triggerDebouncedAutosave = () => {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveDraftSnapshot, 400);

  clearTimeout(serverSyncTimer);
  serverSyncTimer = setTimeout(syncActiveDraftToServer, 10000);
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

const loadDatasetsForQuestion = async (attachmentUrls) => {
  currentDatasets = [];
  activeDatasetIndex = 0;
  const fileSelect = el('datasetFileSelect');
  const datasetBadge = el('datasetBadge');

  if (!attachmentUrls || attachmentUrls.length === 0) {
    if (fileSelect) fileSelect.innerHTML = '<option value="">No datasets</option>';
    if (datasetBadge) {
      datasetBadge.textContent = '0';
      datasetBadge.style.display = 'none';
    }
    renderDatasetTable();
    return;
  }

  const dataFiles = attachmentUrls.filter(url => {
    const cleanPath = url.split('?')[0].toLowerCase();
    return cleanPath.endsWith('.csv') || cleanPath.endsWith('.tsv') || cleanPath.endsWith('.txt') || cleanPath.endsWith('.json') || cleanPath.endsWith('.dat');
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

  for (let i = 0; i < dataFiles.length; i++) {
    const url = dataFiles[i];
    const parts = url.split('/');
    const rawFilename = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
    const cleanName = cleanAttachmentFilename(rawFilename);

    try {
      const base = url.startsWith('http') ? url : `${state.serverUrl || 'https://exams.crraoaimscs.ac.in'}${url}`;
      const fullUrl = `${base}${base.includes('?') ? '&' : '?'}roll_no=${encodeURIComponent(state.rollNumber)}`;
      
      let text = '';
      if (window.electronAPI && window.electronAPI.fetchTextUrl) {
        const fetchRes = await window.electronAPI.fetchTextUrl(fullUrl);
        if (fetchRes && fetchRes.success) {
          text = fetchRes.text;
        } else {
          console.warn('[Dataset] fetchTextUrl returned error:', fetchRes?.error);
        }
      }
      
      if (!text) {
        const res = await fetch(fullUrl);
        if (res.ok) {
          text = await res.text();
        }
      }

      if (text) {
        const parsed = parseCSV(text);
        currentDatasets.push({
          filename: cleanName,
          data: parsed
        });
        if (fileSelect) {
          const opt = document.createElement('option');
          opt.value = currentDatasets.length - 1;
          opt.textContent = cleanName;
          fileSelect.appendChild(opt);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch dataset:', cleanName, e);
    }
  }

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

// ── Theme Management (Dark Mode Default + Light Mode Toggle) ──
const getActiveTheme = () => localStorage.getItem('labexam_theme') || 'dark';

const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('labexam_theme', theme);
  const btn = el('themeToggleBtn');
  if (btn) {
    btn.innerHTML = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
    btn.setAttribute('title', theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
  }
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
const themeToggleBtn = el('themeToggleBtn');
if (themeToggleBtn) {
  themeToggleBtn.addEventListener('click', toggleTheme);
}

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

      // Sync editor content in real-time to the current draft and autosave
      monacoEditorInstance.onDidChangeModelContent(() => {
        if (state.questions.length === 0) return;
        const q = state.questions[state.activeQuestionIndex];
        if (q && state.drafts[q.id]) {
          state.drafts[q.id].code = monacoEditorInstance.getValue();
        }
        triggerDebouncedAutosave();
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
        triggerDebouncedAutosave();
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
          triggerDebouncedAutosave();
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
        triggerDebouncedAutosave();
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
  triggerDebouncedAutosave();
};

const deleteSqlNotebookCell = (questionId, cellId) => {
  const cells = state.sqlNotebook[questionId];
  if (!cells || cells.length <= 1) return;
  state.sqlNotebook[questionId] = cells.filter(c => c.id !== cellId);
  renderSqlNotebook(questionId);
  triggerDebouncedAutosave();
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
    saveDraftSnapshot();
    const activeDb = getActiveDatabaseForCell(questionId, cell.id);
    const res = await window.electronAPI.runSqlCell(cell.query, activeDb);
    cell.output = {
      success: !!res.success,
      output: res.output || '',
      error: res.error || '',
      executionTimeMs: res.executionTimeMs || 0
    };
    if (card) updateCellOutputDisplay(card, cell);
    triggerDebouncedAutosave();
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
    saveDraftSnapshot();
  });
}

const renderAuthLayout = () => {
  const isUserLoggedIn = !!state.token;
  const loginHeader = el('loginHeader');
  const loginForm = el('loginForm');

  if (isUserLoggedIn) {
    if (loginHeader) loginHeader.classList.add('hidden');
    if (loginForm) loginForm.classList.add('hidden');
  } else {
    if (loginHeader) loginHeader.classList.remove('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
  }
};

const updateGridLayout = () => {
  const grid = el('mainGrid');
  if (!grid) return;
  const shell = document.querySelector('.shell');
  const hero = document.querySelector('.hero');
  if (!state.token) {
    grid.className = 'grid two-col auth-only';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.remove('hidden');
    if (shell) shell.classList.remove('wide-shell');
    if (hero) hero.classList.remove('hidden');
    if (workspaceTitle) workspaceTitle.textContent = 'Student Workspace';
    if (workspaceHint) workspaceHint.textContent = 'Login as a student to load your assigned question.';
  } else {
    grid.className = 'grid two-col workspace-only';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.add('hidden');
    if (shell) shell.classList.add('wide-shell');
    if (hero) hero.classList.add('hidden');
  }
  renderAuthLayout();
};

const setHidden = (selector, hidden) => {
  document.querySelectorAll(selector).forEach((node) => node.classList.toggle('hidden', hidden));
};

const setMode = (mode) => {
  state.mode = 'student';
  state.role = 'student';
  if (studentView) studentView.classList.remove('hidden');
  if (workspaceTitle) workspaceTitle.textContent = 'Student Workspace';
  if (workspaceHint) workspaceHint.textContent = 'Login as a student to load your assigned question.';
};

const api = async (path, options = {}) => {
  const headers = options.headers ? { ...options.headers } : {};
  const url = path.startsWith('http') ? path : `${state.serverUrl}${path}`;
  
  const response = await fetch(url, { 
    ...options, 
    credentials: 'include',
    headers 
  });
  
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  
  if (!response.ok || (data && data.success === false)) {
    const message = data?.error || data?.message || (typeof data === 'string' ? data : response.statusText);
    throw new Error(message);
  }
  return data;
};

const logEvent = (value) => {
  console.log('[Event Log]:', value);
  if (!eventLog) return;
  const line = document.createElement('div');
  line.className = 'event-line';
  line.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  eventLog.prepend(line);
};

const renderToken = () => {
  if (tokenPreview) {
    tokenPreview.textContent = state.token ? `${state.role}: ${state.token.slice(0, 32)}...` : 'Not signed in';
  }
};

const loadStatus = async () => {
  try {
    await api('/health', { headers: {} });
    if (serverStatus) serverStatus.textContent = 'Server online';
    if (statusText) statusText.textContent = 'Connected to localhost:8080';
  } catch (error) {
    if (serverStatus) serverStatus.textContent = 'Server offline';
    if (statusText) statusText.textContent = error.message;
  }
};



const saveCurrentTabState = () => {
  if (state.questions.length === 0) return;
  const q = state.questions[state.activeQuestionIndex];
  if (!q) return;
  const lang = el('languageSelect') ? el('languageSelect').value : 'python';
  const code = (lang === 'mysql') ? getMergedSqlCode(q.id) : getEditorValue();
  state.drafts[q.id] = {
    code,
    language: lang,
    sqlCells: (state.sqlNotebook && state.sqlNotebook[q.id]) ? state.sqlNotebook[q.id] : null,
    terminal: el('terminalOutput') ? el('terminalOutput').textContent : '',
    terminalColor: el('terminalOutput') ? el('terminalOutput').style.color : '#10b981',
  };
  saveDraftSnapshot();
  syncActiveDraftToServer();
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

const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  if (questionLabel) questionLabel.textContent = `Question ${q.number || (index + 1)}`;
  if (questionTitle) questionTitle.textContent = q.title;
  if (questionPrompt) questionPrompt.textContent = q.prompt;
  state.questionId = q.id;

  const attachDiv = el('studentAttachments');
  if (attachDiv) {
    if (q.attachmentUrls && q.attachmentUrls.length > 0) {
      attachDiv.innerHTML = q.attachmentUrls.map((url, attachIdx) => {
        const parts = url.split('/');
        const filename = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
        const cleanName = cleanAttachmentFilename(filename);
        const base = url.startsWith('http') ? url : `${state.serverUrl || 'https://exams.crraoaimscs.ac.in'}${url}`;
        const fullUrl = `${base}${base.includes('?') ? '&' : '?'}roll_no=${encodeURIComponent(state.rollNumber)}`;
        
        const lower = filename.toLowerCase();
        const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp');
        const isTabular = lower.endsWith('.csv') || lower.endsWith('.tsv');
        const isPdf = lower.endsWith('.pdf');

        if (isImage) {
          return `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; margin-top: 12px;">
              <img class="student-attachment-image" src="${fullUrl}" alt="${cleanName}" style="max-width: 100%; max-height: 350px; border-radius: 8px; border: 1px solid var(--panel-border); object-fit: contain; background: var(--bg-2); cursor: zoom-in;" />
            </div>
          `;
        }

        if (isPdf) {
          return `
            <div class="pdf-viewer-deck-card no-copy-zone" oncontextmenu="return false;">
              <div class="pdf-toolbar">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <span style="font-weight: 700; font-size: 0.82rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Document: ${cleanName}</span>
                  <span style="font-size: 0.7rem; color: var(--muted); background: var(--panel); padding: 1px 6px; border-radius: 4px; border: 1px solid var(--panel-border); font-weight: 600;">PDF</span>
                </div>
                <div style="display: flex; align-items: center; gap: 5px; flex-shrink: 0;">
                  <button type="button" class="pdf-btn pdf-split-zoom-out" title="Zoom Out">🔍-</button>
                  <span class="pdf-split-zoom-label" style="font-size: 0.75rem; color: var(--muted); font-weight: 600; min-width: 38px; text-align: center;">100%</span>
                  <button type="button" class="pdf-btn pdf-split-zoom-in" title="Zoom In">🔍+</button>
                  <button type="button" class="pdf-btn pdf-split-zoom-reset" title="Reset Zoom">Reset</button>
                  <button type="button" class="pdf-btn pdf-btn-expand pdf-split-expand-btn" data-url="${fullUrl}" data-title="${cleanName}" title="Expand Document">⛶ Expand</button>
                </div>
              </div>
              <div class="pdf-frame-wrapper no-copy-zone">
                <div class="pdf-canvas-container no-copy-zone" data-pdf-url="${fullUrl}">
                  <div class="pdf-loading-indicator"><div class="pdf-loading-spinner"></div><span>Loading document...</span></div>
                </div>
              </div>
            </div>
          `;
        }

        if (isTabular) {
          return `
            <div class="dataset-resource-card">
              <div class="dataset-resource-info">
                <span class="dataset-resource-name">Dataset: ${cleanName}</span>
                <span class="dataset-resource-meta">Available in code as '${cleanName}'</span>
              </div>
              <button type="button" class="dataset-resource-btn view-dataset-tab-btn" data-filename="${cleanName}">View Table &rarr;</button>
            </div>
          `;
        }

        return `
          <div class="dataset-resource-card">
            <div class="dataset-resource-info">
              <span class="dataset-resource-name">File: ${cleanName}</span>
              <span class="dataset-resource-meta">Available in workspace as '${cleanName}'</span>
            </div>
          </div>
        `;
      }).join('');

      attachDiv.querySelectorAll('.student-attachment-image').forEach(img => {
        img.addEventListener('click', () => {
          openImageLightbox(img.src);
        });
      });

      attachDiv.querySelectorAll('.view-dataset-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          switchBottomTab('dataset');
        });
      });

      // Bind interactive controls and render canvas for embedded PDF cards
      attachDiv.querySelectorAll('.pdf-viewer-deck-card').forEach(card => {
        const container = card.querySelector('.pdf-canvas-container');
        const zoomLabel = card.querySelector('.pdf-split-zoom-label');
        const expandBtn = card.querySelector('.pdf-split-expand-btn');
        const pdfUrl = container ? container.getAttribute('data-pdf-url') : '';
        const title = expandBtn ? expandBtn.getAttribute('data-title') : 'Document';
        let currentZoom = 1.0;
        let loadedPdfDoc = null;

        if (pdfUrl && container) {
          getPdfDocument(pdfUrl).then(doc => {
            loadedPdfDoc = doc;
            renderPdfPagesToContainer(container, doc, 1.0, true);
          }).catch(err => {
            console.error('Failed to render split PDF:', err);
            container.innerHTML = `<div style="padding: 24px; color: #ef4444; text-align: center;">Failed to load PDF: ${err.message || err}</div>`;
          });
        }

        const updateFrameZoom = (newZoom) => {
          if (!loadedPdfDoc || !container) return;
          currentZoom = Math.min(2.5, Math.max(0.6, Math.round(newZoom * 100) / 100));
          if (zoomLabel) zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
          renderPdfPagesToContainer(container, loadedPdfDoc, currentZoom, true);
        };

        const zoomInBtn = card.querySelector('.pdf-split-zoom-in');
        if (zoomInBtn) {
          zoomInBtn.addEventListener('click', () => updateFrameZoom(currentZoom + 0.25));
        }

        const zoomOutBtn = card.querySelector('.pdf-split-zoom-out');
        if (zoomOutBtn) {
          zoomOutBtn.addEventListener('click', () => updateFrameZoom(currentZoom - 0.25));
        }

        const zoomResetBtn = card.querySelector('.pdf-split-zoom-reset');
        if (zoomResetBtn) {
          zoomResetBtn.addEventListener('click', () => updateFrameZoom(1.0));
        }

        if (expandBtn) {
          expandBtn.addEventListener('click', () => {
            if (typeof window.openPdfModal === 'function') {
              window.openPdfModal(loadedPdfDoc || pdfUrl, title);
            }
          });
        }
      });
    } else {
      attachDiv.innerHTML = '';
    }
  }

  // Load tabular datasets if attached
  loadDatasetsForQuestion(q.attachmentUrls);

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
  if (el('languageSelect')) el('languageSelect').value = draft.language;
  setEditorLanguage(draft.language);
  updateLanguageWorkspace(draft.language);

  if (el('terminalOutput')) {
    el('terminalOutput').textContent = draft.terminal;
    el('terminalOutput').style.color = draft.terminalColor;
  }

  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });
};

const saveSingleProgramLocally = async (questionIndex) => {
  if (!window.electronAPI) return null;
  const q = state.questions[questionIndex];
  if (!q) return null;

  let codeContent = '';
  let language = q.language || 'python';
  if (state.activeQuestionIndex === questionIndex) {
    language = el('languageSelect') ? el('languageSelect').value : 'python';
    codeContent = (language === 'mysql') ? getMergedSqlCode(q.id) : getEditorValue();
  } else {
    const draft = state.drafts[q.id];
    if (draft) {
      language = draft.language || 'python';
      codeContent = (language === 'mysql') ? (getMergedSqlCode(q.id) || draft.code) : draft.code;
    }
  }

  let ext = '.py';
  const lang = language.toLowerCase();
  if (lang === 'c') ext = '.c';
  else if (lang === 'cpp') ext = '.cpp';
  else if (lang === 'java') ext = '.java';
  else if (lang === 'r') ext = '.R';
  else if (lang === 'mysql') ext = '.sql';

  const fileName = `programming task ${questionIndex + 1}${ext}`;
  const sanitizedName = (state.name || 'Student').trim();
  const sanitizedRoll = (state.rollNumber || '000000').trim();
  const folderName = `${sanitizedName}_${sanitizedRoll}`.replace(/[<>:"/\\|?*]/g, '');

  const result = await window.electronAPI.saveLocalFile(folderName, fileName, codeContent);
  return result;
};

const saveAllProgramsLocally = async () => {
  if (!window.electronAPI) return;
  saveCurrentTabState();
  let savedCount = 0;
  for (let i = 0; i < state.questions.length; i++) {
    const res = await saveSingleProgramLocally(i);
    if (res && res.success) {
      savedCount++;
    }
  }
  logEvent(`Successfully saved ${savedCount} programs locally to Desktop.`);
};

const loadStudentExam = async () => {
  if (!state.token) return;
  try {
    const res = await api(`/api/assignments?roll_no=${encodeURIComponent(state.rollNumber)}`);
    const data = res.data || {};
    const attempts = data.attempts || [];
    const rawAssignments = Array.isArray(data) ? data : (data.assignments || []);
    
    const enteredCode = (state.examCode || state.examId || localStorage.getItem('securemlexam_exam_id') || '').trim();
    const enteredUpper = enteredCode.toUpperCase();

    // 1. Locate matching attempt
    let activeAtt = null;
    if (attempts.length > 0) {
      // Find matching attempt by exam_code
      activeAtt = attempts.find(a => a.exam_code && a.exam_code.toUpperCase() === enteredUpper);
      // Find by exam_id
      if (!activeAtt) {
        activeAtt = attempts.find(a => a.exam_id && (a.exam_id === enteredCode || a.exam_id.toUpperCase() === enteredUpper));
      }
      // Find by attempt id
      if (!activeAtt) {
        activeAtt = attempts.find(a => a.id === enteredCode);
      }
      // If student has exactly 1 attempt and code is empty or 'exam-1' or default, use that attempt!
      if (!activeAtt && attempts.length === 1 && (!enteredCode || enteredCode.toLowerCase() === 'exam-1')) {
        activeAtt = attempts[0];
      }
    }

    if (activeAtt) {
      if (activeAtt.status === 'submitted') {
        throw new Error('You have already submitted this exam. Access locked.');
      }
      state.activeAttemptId = activeAtt.id;
      state.examId = activeAtt.exam_id;
      state.examCode = activeAtt.exam_code || enteredCode;
      if (examLabel) examLabel.textContent = activeAtt.exam_title ? `Exam: ${activeAtt.exam_title}` : `Assigned Lab Exam`;
      if (workspaceTitle) workspaceTitle.textContent = activeAtt.exam_title || 'Assigned Lab Exam';
      if (workspaceHint) workspaceHint.textContent = `Candidate: ${state.name || 'Student'} • Roll No: ${state.rollNumber || ''}`;

      if (activeAtt.questions && activeAtt.questions.length > 0) {
        state.questions = activeAtt.questions.map((q) => ({
          id: q.id,
          number: q.number,
          title: `Question ${q.number}`,
          prompt: q.question_text,
          response: q.response || '',
          attachmentUrls: q.attachment_urls || []
        }));
      } else {
        // Fallback to filtering rawAssignments
        const matchingAssignments = rawAssignments.filter(a => a.attempt_id === activeAtt.id || a.exam_id === activeAtt.exam_id);
        state.questions = matchingAssignments.map((a, idx) => ({
          id: a.id,
          number: idx + 1,
          title: `Question ${idx + 1}`,
          prompt: a.question_text,
          response: a.response || '',
          attachmentUrls: []
        }));
      }

      // Notify backend that attempt has started
      try {
        await api('/api/attempts/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            student_roll_no: state.rollNumber,
            attempt_id: state.activeAttemptId,
            exam_id: state.examId,
            exam_code: state.examCode
          })
        });
        console.log('[Attempts] Exam session started.');
      } catch (err) {
        console.warn('[Attempts] Failed to start attempt:', err.message);
      }
    } else {
      // Legacy fallback: match raw assignments if attempts array not present
      const matchedAssignments = rawAssignments.filter(a => 
        (a.exam_id && (a.exam_id === enteredCode || a.exam_id.toUpperCase() === enteredUpper)) ||
        (a.exam_code && a.exam_code.toUpperCase() === enteredUpper)
      );
      if (matchedAssignments.length > 0) {
        state.questions = matchedAssignments.map((a, idx) => ({
          id: a.id,
          number: idx + 1,
          title: `Question ${idx + 1}`,
          prompt: a.question_text,
          response: a.response || '',
          attachmentUrls: []
        }));
        if (workspaceTitle) workspaceTitle.textContent = 'Assigned Lab Exam';
        if (workspaceHint) workspaceHint.textContent = `Candidate: ${state.name || 'Student'} • Roll No: ${state.rollNumber || ''}`;
      } else {
        throw new Error(`No active exam found for code "${enteredCode}". Please check your Exam Code with faculty.`);
      }
    }

    if (!state.questions || state.questions.length === 0) {
      throw new Error('No questions found in this exam paper. Please contact the invigilator.');
    }

    state.drafts = {};
    state.questions.forEach((q) => {
      state.drafts[q.id] = {
        code: q.response || '',
        language: 'python',
        terminal: 'Terminal ready. Write code and click Run Code.',
        terminalColor: '#10b981',
      };
    });
    state.activeQuestionIndex = 0;

    // ── Crash & Reboot Protection Shield: Restore local unsubmitted draft session ──
    const autosaveKey = getAutosaveKey();
    if (autosaveKey) {
      try {
        const saved = localStorage.getItem(autosaveKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.drafts) {
            Object.keys(parsed.drafts).forEach(qId => {
              if (state.drafts[qId] && (parsed.drafts[qId].code || parsed.drafts[qId].sqlCells)) {
                state.drafts[qId] = {
                  ...state.drafts[qId],
                  ...parsed.drafts[qId]
                };
                if (parsed.drafts[qId].sqlCells && Array.isArray(parsed.drafts[qId].sqlCells)) {
                  state.sqlNotebook[qId] = parsed.drafts[qId].sqlCells;
                }
              }
            });
            if (typeof parsed.activeQuestionIndex === 'number' && parsed.activeQuestionIndex < state.questions.length) {
              state.activeQuestionIndex = parsed.activeQuestionIndex;
            }
            logEvent('🛡️ Crash Protection: Restored local unsubmitted exam session.');
          }
        }
      } catch (err) {
        console.warn('Failed to restore autosaved draft:', err);
      }
    }

    if (state.questions.length > 0) {
      const tabsContainer = el('studentTabs');
      tabsContainer.innerHTML = '';
      tabsContainer.classList.remove('hidden');

      const renderTabs = () => {
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
          label.textContent = `Program ${idx + 1}`;
          btn.appendChild(label);

          // Render cross button for dynamic tabs (i.e. if idx > 0, we can close it!)
          if (idx > 0) {
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
            closeBtn.addEventListener('click', async (e) => {
              e.stopPropagation(); // prevent switching tab trigger
              
              if (!confirm(`Are you sure you want to close Program ${idx + 1}? All un-submitted draft code for this program will be lost.`)) {
                return;
              }

              try {
                // Call unassign API
                await api('/api/v1/student/unassign', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    exam_id: state.examId,
                    question_id: q.id
                  })
                });

                // Remove question and draft
                state.questions.splice(idx, 1);
                delete state.drafts[q.id];

                // If closed tab was active, focus on the previous tab
                if (state.activeQuestionIndex === idx) {
                  state.activeQuestionIndex = Math.max(0, idx - 1);
                } else if (state.activeQuestionIndex > idx) {
                  state.activeQuestionIndex--;
                }

                loadTabState(state.activeQuestionIndex);
                renderTabs();
              } catch (err) {
                alert('Failed to close program: ' + err.message);
              }
            });
            btn.appendChild(closeBtn);
          }

          btn.addEventListener('click', (e) => {
            if (e.target.textContent === '✕') return; // clicked close button
            saveCurrentTabState();
            loadTabState(idx);
            renderTabs();
          });
          tabsContainer.appendChild(btn);
        });

        // Add '+' button if tabs count < 10
        if (state.questions.length < 10) {
          const addBtn = document.createElement('button');
          addBtn.className = 'tab-btn-add';
          addBtn.textContent = '+';
          addBtn.type = 'button';
          addBtn.style.padding = '4px 14px';
          addBtn.style.background = '#10b981';
          addBtn.style.border = 'none';
          addBtn.style.borderRadius = '8px';
          addBtn.style.color = '#ffffff';
          addBtn.style.fontWeight = 'bold';
          addBtn.style.cursor = 'pointer';
          addBtn.style.fontSize = '1.1rem';
          addBtn.style.marginLeft = '8px';
          addBtn.style.transition = 'all 0.2s';
          addBtn.addEventListener('click', async () => {
            const nextQuestionNumber = state.questions.length + 1;
            try {
              addBtn.disabled = true;
              addBtn.textContent = '...';
              const res = await api('/api/v1/student/select_question', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  exam_id: state.examId,
                  question_number: nextQuestionNumber
                })
              });
              
              if (res && res.question) {
                saveCurrentTabState();
                state.questions.push(res.question);
                state.activeQuestionIndex = state.questions.length - 1;
                loadTabState(state.activeQuestionIndex);
                renderTabs();
              }
            } catch (err) {
              alert('No more questions available in this exam or failed to assign: ' + err.message);
            } finally {
              addBtn.disabled = false;
              addBtn.textContent = '+';
            }
          });
          tabsContainer.appendChild(addBtn);
        }
      };

      renderTabs();
      loadTabState(0);
    }

    el('activeQuestionCard').classList.remove('hidden');
    el('editorArea').classList.remove('hidden');
    el('endExamBtn').classList.remove('hidden');  // show End Exam button now

    // Lock window into exam mode: blocks split-screen, resize, and minimize
    if (window.electronAPI) {
      window.electronAPI.requestFullscreen(true);
      window.electronAPI.lockExamWindow();
    }

    logEvent(`Loaded exam with ${state.questions.length} questions.`);

    // Arm security focus checks
    setTimeout(() => {
      state.securityArmed = true;
      console.log('[ExamGuard] Security focus checks armed.');
    }, 2000);
  } catch (error) {
    if (error.message.includes('security violation')) {
      triggerViolationShutdown('lockout', 'Student has been permanently locked out due to previous security violation.');
      return;
    }
    el('studentTabs').classList.add('hidden');
    el('activeQuestionCard').classList.add('hidden');
    el('editorArea').classList.add('hidden');
    el('endExamBtn').classList.add('hidden');
    logEvent(error.message);

    // Clear state/tokens and restore the login layout so they can retry
    state.token = '';
    state.securityArmed = false;
    localStorage.removeItem('securemlexam_token');
    localStorage.removeItem('securemlexam_exam_id');
    updateGridLayout();
    const errorBox = el('loginError');
    if (errorBox) {
      errorBox.textContent = `⚠️ Failed to load exam: ${error.message}`;
      errorBox.classList.remove('hidden');
    }
  }
};

// Bind modal close trigger and Lightbox events
document.addEventListener('DOMContentLoaded', async () => {
  if (window.electronAPI && window.electronAPI.getServerUrl) {
    try {
      state.serverUrl = await window.electronAPI.getServerUrl();
      console.log('[SecureLab] Configured server URL:', state.serverUrl);
    } catch (err) {
      console.error('Failed to get server URL from electron:', err);
    }
  }

  const closeBtn = el('closeResponseModalBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const modal = el('studentResponseModal');
      if (modal) modal.classList.add('hidden');
    });
  }

  // Lightbox Image Viewer Logic
  let zoomScale = 1;
  const modal = el('imageLightboxModal');
  const img = el('lightboxImage');
  const wrapper = el('lightboxImageWrapper');

  window.openImageLightbox = (src) => {
    if (!modal || !img) return;
    img.src = src;
    zoomScale = 1;
    img.style.transform = `scale(${zoomScale})`;
    modal.classList.remove('hidden');
    if (wrapper) {
      wrapper.scrollLeft = 0;
      wrapper.scrollTop = 0;
    }
  };

  const closeLightbox = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (el('closeLightboxBtn')) {
    el('closeLightboxBtn').addEventListener('click', closeLightbox);
  }

  const updateZoom = (change) => {
    if (!img) return;
    zoomScale = Math.min(4, Math.max(0.5, zoomScale + change));
    img.style.transform = `scale(${zoomScale})`;
  };

  if (el('zoomInBtn')) {
    el('zoomInBtn').addEventListener('click', () => updateZoom(0.25));
  }
  if (el('zoomOutBtn')) {
    el('zoomOutBtn').addEventListener('click', () => updateZoom(-0.25));
  }
  if (el('zoomResetBtn')) {
    el('zoomResetBtn').addEventListener('click', () => {
      zoomScale = 1;
      if (img) img.style.transform = 'scale(1)';
      if (wrapper) {
        wrapper.scrollLeft = 0;
        wrapper.scrollTop = 0;
      }
    });
  }

  // Drag to pan setup
  let isDragging = false;
  let startX, startY;
  let scrollLeft, scrollTop;

  if (wrapper) {
    wrapper.addEventListener('mousedown', (e) => {
      isDragging = true;
      wrapper.style.cursor = 'grabbing';
      startX = e.pageX - wrapper.offsetLeft;
      startY = e.pageY - wrapper.offsetTop;
      scrollLeft = wrapper.scrollLeft;
      scrollTop = wrapper.scrollTop;
    });

    wrapper.addEventListener('mouseleave', () => {
      isDragging = false;
      wrapper.style.cursor = 'grab';
    });

    wrapper.addEventListener('mouseup', () => {
      isDragging = false;
      wrapper.style.cursor = 'grab';
    });

    wrapper.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      e.preventDefault();
      const x = e.pageX - wrapper.offsetLeft;
      const y = e.pageY - wrapper.offsetTop;
      const walkX = (x - startX) * 1.5;
      const walkY = (y - startY) * 1.5;
      wrapper.scrollLeft = scrollLeft - walkX;
      wrapper.scrollTop = scrollTop - walkY;
    });

    // Mouse wheel zoom support
    wrapper.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        updateZoom(0.1);
      } else {
        updateZoom(-0.1);
      }
    }, { passive: false });
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
      if (modal && !modal.classList.contains('hidden')) {
        closeLightbox();
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
});

  const connectWebSocket = () => {
    // Disabled as the backend has no WebSocket implementation
    return;
  };

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const submitBtn = el('loginSubmitBtn');
  const errorBox  = el('loginError');

  // Clear previous error, show loading state
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  const formData = new FormData(loginForm);
  const serverUrl = formData.get('serverUrl') || 'https://exams.crraoaimscs.ac.in';
  state.serverUrl = serverUrl.replace(/\/$/, '');
  localStorage.setItem('securemlexam_server_url', state.serverUrl);

  const showLoginError = (msg) => {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In to Exam';
    errorBox.textContent = '⚠️  ' + msg;
    errorBox.classList.remove('hidden');
    state.token = '';
    state.name  = '';
    updateGridLayout();
  };

  try {
    const rollNumber = (formData.get('rollNumber') || '').trim();
    const name = (formData.get('name') || '').trim();

    if (!rollNumber) {
      throw new Error('Please enter your Roll Number.');
    }

    const enteredCode = (formData.get('examId') || '').trim();
    const enteredUpper = enteredCode.toUpperCase();
    state.examId = enteredCode;
    state.examCode = enteredCode;
    localStorage.setItem('securemlexam_exam_id', enteredCode);

    const res = await api(`/api/assignments?roll_no=${encodeURIComponent(rollNumber)}`);
    const resData = res.data;
    if (!resData) {
      throw new Error('Could not retrieve student assignments from server.');
    }

    const attempts = resData.attempts || [];
    const rawAssignments = Array.isArray(resData) ? resData : (resData.assignments || []);

    let matchedAttempt = null;
    if (attempts.length > 0) {
      matchedAttempt = attempts.find(a => a.exam_code && a.exam_code.toUpperCase() === enteredUpper);
      if (!matchedAttempt) {
        matchedAttempt = attempts.find(a => a.exam_id && (a.exam_id === enteredCode || a.exam_id.toUpperCase() === enteredUpper));
      }
      if (!matchedAttempt) {
        matchedAttempt = attempts.find(a => a.id === enteredCode);
      }
      if (!matchedAttempt && attempts.length === 1 && (!enteredCode || enteredCode.toLowerCase() === 'exam-1')) {
        matchedAttempt = attempts[0];
      }
    }

    if (matchedAttempt) {
      if (matchedAttempt.status === 'submitted') {
        throw new Error('You have already submitted this exam. Access locked.');
      }
      state.activeAttemptId = matchedAttempt.id;
      state.examId = matchedAttempt.exam_id;
      state.examCode = matchedAttempt.exam_code || enteredCode;
      localStorage.setItem('securemlexam_attempt_id', state.activeAttemptId);
    } else {
      const matchedAssignments = rawAssignments.filter(a => 
        (a.exam_id && (a.exam_id === enteredCode || a.exam_id.toUpperCase() === enteredUpper)) ||
        (a.exam_code && a.exam_code.toUpperCase() === enteredUpper)
      );
      if (matchedAssignments.length === 0) {
        if (attempts.length === 0 && rawAssignments.length === 0) {
          throw new Error(`No exams assigned to Roll Number "${rollNumber}". Please contact faculty.`);
        }
        throw new Error(`No active exam found for code "${enteredCode}". Please check your Exam Code.`);
      }
    }

    const data = {
      token: 'student_session',
      role: 'student',
      name: name || (resData.student && resData.student.name) || 'Student',
      rollNumber: rollNumber
    };

    errorBox.classList.add('hidden');
    state.token = data.token;
    state.role  = data.role;
    state.name  = data.name || '';
    state.rollNumber = data.rollNumber || '';
    localStorage.setItem('securemlexam_token', state.token);
    localStorage.setItem('securemlexam_role',  state.role);
    localStorage.setItem('securemlexam_name',  state.name);
    localStorage.setItem('securemlexam_rollnumber', state.rollNumber);
    renderToken();
    setMode('student');
    updateGridLayout();
    connectWebSocket();
    logEvent(`Signed in as ${state.name || state.role}`);

    if (window.electronAPI) window.electronAPI.requestFullscreen(true);
    await loadStudentExam();

    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In to Exam';

  } catch (error) {
    showLoginError(error.message);
    logEvent(`Login failed: ${error.message}`);
  }
});

if (el('connectWsBtn')) {
  el('connectWsBtn').addEventListener('click', () => connectWebSocket());
}

if (el('refreshBtn')) {
  el('refreshBtn').addEventListener('click', async () => {
    try {
      await loadStudentExam();
    } catch (error) {
      logEvent(error.message);
    }
  });
}

const submitCurrentSolution = async (btn) => {
  saveCurrentTabState();
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  btn.style.opacity = '0.7';

  try {
    const lang = el('languageSelect') ? el('languageSelect').value : 'python';
    const code = (lang === 'mysql') ? getMergedSqlCode(state.questionId) : getEditorValue();

    const data = await api('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: state.questionId || '',
        student_roll_no: state.rollNumber,
        response: code,
      }),
    });
    logEvent(data.status || 'submitted');

    // Inline success feedback — no popup, no focus loss, no false violation
    btn.textContent = 'Submitted';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.opacity = '1';
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
    }, 3000);

  } catch (error) {
    logEvent(error.message);

    // Inline error feedback — no popup
    btn.textContent = '✖ Submit Failed';
    btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    btn.style.opacity = '1';
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
    }, 3000);
  }
};

el('submitBtn').addEventListener('click', () => submitCurrentSolution(el('submitBtn')));
if (el('submitSqlBtn')) {
  el('submitSqlBtn').addEventListener('click', () => submitCurrentSolution(el('submitSqlBtn')));
}

// Helper that performs the actual exam shutdown — called from the inline confirm panel
const doEndExam = async () => {
  el('endExamBtn').disabled = true;
  el('endExamBtn').textContent = 'Ending...';
  el('endExamConfirm').classList.add('hidden');

  saveCurrentTabState();

  // Save all programs locally on the Desktop
  if (window.electronAPI) {
    try {
      await saveAllProgramsLocally();
    } catch (err) {
      logEvent(`Warning: local save on end failed: ${err.message}`);
    }
  }

  // Auto-submit code for all programs before ending
  for (const q of state.questions) {
    const draft = state.drafts[q.id];
    const lang = draft ? draft.language : (q.language || 'python');
    const codeToSubmit = (lang === 'mysql') ? (getMergedSqlCode(q.id) || (draft ? draft.code : '')) : (draft ? draft.code : '');
    // Skip submit for mock demo questions
    if (q.id.startsWith('demo-')) continue;
    try {
      await api('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignment_id: q.id,
          student_roll_no: state.rollNumber,
          response: codeToSubmit,
        }),
      });
      logEvent(`Final submission saved for ${q.title}.`);
    } catch (err) {
      logEvent(`Warning: auto-submit failed for ${q.title}: ${err.message}`);
    }
  }

  // Final submit for the whole attempt
  if (state.examId || state.examCode) {
    try {
      await api('/api/attempts/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_roll_no: state.rollNumber,
          exam_code: state.examCode || state.examId,
          exam_id: state.examId,
        }),
      });
      logEvent('Exam attempt submitted and locked successfully.');
    } catch (err) {
      logEvent(`Warning: final attempt submit failed: ${err.message}`);
    }
  }

  // Clear local autosave snapshot
  const autosaveKey = getAutosaveKey();
  if (autosaveKey) localStorage.removeItem(autosaveKey);

  // Clear session
  state.token = '';
  localStorage.removeItem('securemlexam_token');
  if (state.ws) { state.ws.close(); state.ws = null; }

  // Close the app (Electron/root) or show a thank-you overlay (browser fallback)
  if (window.electronAPI && window.electronAPI.exitApp) {
    window.electronAPI.unlockExamWindow();
    window.electronAPI.exitApp();
  } else {
    const overlay = el('violationOverlay');
    const detailsEl = el('violationDetails');
    if (overlay && detailsEl) {
      detailsEl.textContent = 'Exam ended voluntarily. Your submission has been saved.';
      detailsEl.style.color = '#10b981';
      overlay.querySelector('h2').textContent = 'Exam Ended';
      overlay.querySelector('h2').style.color = '#10b981';
      overlay.querySelector('p').textContent = 'Thank you. Your final code has been submitted to the server.';
      overlay.classList.remove('hidden');
    }
    const mainShell = document.querySelector('.shell');
    if (mainShell) mainShell.innerHTML = '';
  }
};

// Step 1: clicking End Exam just reveals the inline confirmation panel — no popup, no focus loss
el('endExamBtn').addEventListener('click', () => {
  el('endExamConfirm').classList.remove('hidden');
  el('endExamConfirm').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// Step 2a: Cancel — hide the panel, do nothing
el('endExamCancelBtn').addEventListener('click', () => {
  el('endExamConfirm').classList.add('hidden');
});

// Step 2b: Confirm — run shutdown
el('endExamConfirmBtn').addEventListener('click', async () => {
  await doEndExam();
});

el('runCodeBtn').addEventListener('click', () => {
  const code = getEditorValue();
  const term = el('terminalOutput');
  const runBtn = el('runCodeBtn');
  const lang = el('languageSelect') ? el('languageSelect').value : 'python';

  // ── Stop running process ────────────────────────────────────────────────
  if (state.runWs) {
    if (window.electronAPI) {
      window.electronAPI.stopCode();
    }
    state.runWs = null; // flag cleared; code-exit event will clean up UI
    return;
  }

  if (!window.electronAPI) {
    term.style.color = '#f87171';
    term.textContent = '[Error]: Code execution is only available in the desktop app.';
    return;
  }

  if (!code.trim()) {
    term.style.color = '#f87171';
    term.textContent = '[Error]: Please write some code first.';
    return;
  }

  // ── Start run ──────────────────────────────────────────────────────────
  saveDraftSnapshot();
  syncActiveDraftToServer();
  state.runWs = true; // use as "running" flag

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

  term.textContent = `Running ${lang.toUpperCase()} code...\n`;
  term.style.color = '#a3e635';
  runBtn.textContent = 'Stop';
  runBtn.style.background = '#ef4444';
  runBtn.style.color = '#ffffff';
  runBtn.disabled = false;

  // Show stdin input row immediately so user can type as soon as program prompts
  const inputEl  = el('terminalInput');
  if (inputEl) {
    inputEl.value = '';
    inputEl.focus();
  }

  const cleanupRunState = () => {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Code';
    runBtn.style.removeProperty('background');
    runBtn.style.removeProperty('color');
    state.runWs = null;
    window.electronAPI.removeCodeListeners();

    // Save draft after execution
    const q = state.questions[state.activeQuestionIndex];
    if (q) {
      state.drafts[q.id] = {
        code: getEditorValue(),
        language: el('languageSelect') ? el('languageSelect').value : 'python',
        terminal: term.textContent,
        terminalColor: term.style.color,
      };
    }
  };

  // Remove any leftover listeners from previous run
  window.electronAPI.removeCodeListeners();

  window.electronAPI.onCodeOutput((data) => {
    term.textContent += data.data;
    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
    if (data.stream === 'stderr') {
      term.style.color = '#f87171';
    }
  });

  window.electronAPI.onCodeExit((data) => {
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
      // stderr already streamed; just mark as error color
      if (!term.style.color || term.style.color === 'rgb(163, 230, 53)') {
        term.style.color = '#f87171';
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

    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
    cleanupRunState();
  });

  const q = state.questions[state.activeQuestionIndex];
  const attachments = (q && q.attachmentUrls) ? q.attachmentUrls.map(url => {
    const parts = url.split('/');
    const rawName = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
    const cleanName = cleanAttachmentFilename(rawName);
    const base = url.startsWith('http') ? url : `${state.serverUrl || 'https://exams.crraoaimscs.ac.in'}${url}`;
    const fullUrl = `${base}${base.includes('?') ? '&' : '?'}roll_no=${encodeURIComponent(state.rollNumber)}`;
    return { filename: cleanName, rawFilename: rawName, url: fullUrl };
  }) : [];

  window.electronAPI.runCode(code, lang, attachments);
});



const saveLocalSolution = async (btn) => {
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  try {
    saveCurrentTabState();
    const activeIndex = state.activeQuestionIndex;
    const res = await saveSingleProgramLocally(activeIndex);
    if (res && res.success) {
      btn.textContent = 'Saved';
      btn.style.background = '#dcfce7';
      btn.style.color = '#15803d';
      logEvent(`Successfully saved locally to: ${res.path}`);
    } else {
      throw new Error(res ? res.error : 'Not running in desktop app');
    }
  } catch (err) {
    btn.textContent = 'Save Failed';
    btn.style.background = '#fee2e2';
    btn.style.color = '#b91c1c';
    logEvent(`Local save failed: ${err.message}`);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
    }, 2000);
  }
};

el('saveLocalBtn').addEventListener('click', () => saveLocalSolution(el('saveLocalBtn')));
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

if (el('clearTerminalBtn')) {
  el('clearTerminalBtn').addEventListener('click', () => {
    el('terminalOutput').textContent = "Terminal ready. Write Python code and click Run Code.";
    el('terminalOutput').style.color = "#10b981";
  });
}



const reportViolation = async (kind, details) => {
  try {
    await api('/api/v1/student/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exam_id: state.examId,
        kind,
        details
      })
    });
  } catch (error) {
    console.error('Failed to report violation:', error);
  }
};

const triggerViolationShutdown = async (kind, details) => {
  if (state.role !== 'student' || !state.token) return;

  // Show full screen overlay and details
  const overlay = el('violationOverlay');
  const detailsEl = el('violationDetails');
  if (overlay && detailsEl) {
    detailsEl.textContent = `Violation: [${kind}] ${details}`;
    overlay.classList.remove('hidden');
  }

  // Destructively clear current workspace html to prevent student from viewing or editing code
  const mainShell = document.querySelector('.shell');
  if (mainShell) {
    mainShell.innerHTML = `<div style="text-align: center; color: var(--danger); font-size: 1.5rem; margin-top: 100px;">EXAM LOCKED</div>`;
  }

  // Close websocket immediately
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }

  // Report violation to the server
  await reportViolation(kind, details);

  // Clear state tokens so they are logged out
  state.token = '';
  state.securityArmed = false;
  localStorage.removeItem('securemlexam_token');
};

// Disable context menu
window.addEventListener('contextmenu', (e) => { if (state.role === 'student') e.preventDefault(); });

// Block Copy, Cut, and Paste actions silently (no exam termination, just prevention)
const blockClipboard = (e) => {
  if (state.role === 'student' && state.token) {
    e.preventDefault();
    logEvent(`⚠️ Clipboard ${e.type} blocked.`);
  }
};

window.addEventListener('copy', blockClipboard);
window.addEventListener('cut', blockClipboard);
window.addEventListener('paste', blockClipboard);

// Set up focus loss listeners
// Only arms AFTER the student has loaded a question (state.questionId is set).
// The inline End Exam panel never opens a popup, so no bypass flag is needed.
const handleBlurViolation = (eventSource) => {
  console.log(`[ExamGuard] handleBlurViolation triggered from ${eventSource}. State:`, {
    role: state.role,
    hasToken: !!state.token,
    questionId: state.questionId,
    securityArmed: state.securityArmed
  });
  if (state.role === 'student' && state.token && state.questionId && state.securityArmed) {
    logEvent(`⚠️ [ExamGuard] Focus lost warning via ${eventSource}. Reclaiming window focus.`);
    reportViolation('window-blur-warning', `Student attempted to switch focus via ${eventSource}.`);
  }
};

// Layer 1: Standard window blur event (fires in both browsers and Electron window focus loss)
window.addEventListener('blur', () => {
  handleBlurViolation('window-blur-event');
});

// Layer 1.5: Visibility change event (captures browser tab switching immediately)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handleBlurViolation('visibilitychange-event');
  }
});

// Layer 2: Electron IPC window focus change listener (OS-level window manager fallback)
if (window.electronAPI) {
  window.electronAPI.onWindowFocusChanged(({ focused }) => {
    if (!focused) {
      handleBlurViolation('electron-ipc-blur');
    }
  });
}

const configureEnvironmentModes = () => {
  if (window.electronAPI) {
    // ── Electron Mode (Student Client) ──────────────────────────────────────
    state.role = 'student';
    state.mode = 'student';
    setMode('student');

    const segmented = document.querySelector('.segmented');
    if (segmented) segmented.classList.add('hidden');

    const debugActions = el('debugActionsRow');
    if (debugActions) debugActions.classList.add('hidden');

    const tokenBox = el('tokenPreviewBox');
    if (tokenBox) tokenBox.classList.add('hidden');

    const consoleBox = el('studentConsole');
    if (consoleBox) consoleBox.classList.add('hidden');

    const heroText = document.querySelector('.hero h1');
    if (heroText) heroText.textContent = "Secure Student Workspace";

    const heroDesc = document.querySelector('.hero .lede');
    if (heroDesc) heroDesc.textContent = "Please enter your details to verify your identity and start your exam.";

    const eyebrow = document.querySelector('.hero .eyebrow');
    if (eyebrow) eyebrow.textContent = "Secure Exam Client";
  } else {
    // ── Web Browser Mode (Faculty & Admin Portal) ─────────────────────────────
    const storedRole = localStorage.getItem('securemlexam_role');
    state.role = (storedRole === 'admin' || storedRole === 'faculty') ? storedRole : 'faculty';
    state.mode = state.role;
    setMode(state.role);

    const segmented = document.querySelector('.segmented');
    if (segmented) {
      segmented.classList.remove('hidden');
      const studentBtn = segmented.querySelector('[data-mode="student"]');
      if (studentBtn) studentBtn.style.display = 'none';
    }

    const debugActions = el('debugActionsRow');
    if (debugActions) debugActions.classList.add('hidden');

    const tokenBox = el('tokenPreviewBox');
    if (tokenBox) tokenBox.classList.add('hidden');

    const heroText = document.querySelector('.hero h1');
    if (heroText) heroText.textContent = "Secure Admin & Faculty Portal";

    const heroDesc = document.querySelector('.hero .lede');
    if (heroDesc) heroDesc.textContent = "Create faculty accounts, import student rosters, and monitor exam integrity.";

    const eyebrow = document.querySelector('.hero .eyebrow');
    if (eyebrow) eyebrow.textContent = "System Administration Panel";
  }
};



el('signOutBtn').addEventListener('click', async () => {
  try {
    if (state.role === 'admin') {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } else if (state.role === 'faculty') {
      await api('/api/auth/logout', { method: 'POST' });
    }
  } catch (_) {}

  state.token = '';
  state.role = window.electronAPI ? 'student' : 'faculty';
  state.name = '';
  state.rollNumber = '';
  state.securityArmed = false;
  localStorage.removeItem('securemlexam_token');
  localStorage.removeItem('securemlexam_role');
  localStorage.removeItem('securemlexam_name');
  localStorage.removeItem('securemlexam_rollnumber');
  localStorage.removeItem('securemlexam_exam_id');

  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }

  configureEnvironmentModes();
  renderToken();
  updateGridLayout();
  logEvent('Signed out.');
});

el('violationExitBtn').addEventListener('click', () => {
  if (window.electronAPI) {
    window.electronAPI.unlockExamWindow();
    window.electronAPI.exitApp();
  } else {
    window.location.reload();
  }
});

window.addEventListener('load', async () => {
  // If in Electron (student app), clear any persisted token so they always start at the login screen fresh.
  if (window.electronAPI) {
    localStorage.removeItem('securemlexam_token');
    localStorage.removeItem('securemlexam_role');
    localStorage.removeItem('securemlexam_name');
    localStorage.removeItem('securemlexam_rollnumber');
    state.token = '';
    state.role = 'student';
    state.name = '';
    state.rollNumber = '';
  }
  if (el('plotsActiveImg')) {
    el('plotsActiveImg').addEventListener('click', () => {
      if (typeof openImageLightbox !== 'undefined') {
        openImageLightbox(el('plotsActiveImg').src);
      }
    });
  }

  state.securityArmed = false;

  configureEnvironmentModes();
  renderToken();
  updateGridLayout();

  if (el('windowCloseBtn')) {
    el('windowCloseBtn').addEventListener('click', () => {
      if (window.electronAPI) {
        window.electronAPI.exitApp();
      } else {
        window.close();
      }
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
  if (tabDatasetBtn) {
    tabDatasetBtn.addEventListener('click', () => {
      switchBottomTab('dataset');
      const q = state.questions[state.activeQuestionIndex];
      if (currentDatasets.length === 0 && q && q.attachmentUrls && q.attachmentUrls.length > 0) {
        loadDatasetsForQuestion(q.attachmentUrls);
      }
    });
  }

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

  if (el('terminalOutputContainer')) {
    el('terminalOutputContainer').addEventListener('click', () => {
      if (!el('terminalInputRow').classList.contains('hidden')) {
        el('terminalInput').focus();
      }
    });
  }

  if (el('terminalInput')) {
    el('terminalInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = el('terminalInput').value.trim();
        if (!val) return;
        
        if (state.runWs && window.electronAPI) {
          // Output the input to terminal screen so they see what they typed
          el('terminalOutput').textContent += val + '\n';
          el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
          window.electronAPI.sendStdin(val);
          el('terminalInput').value = '';
        } else {
          // No program running - treat as virtual env pip command
          el('terminalOutput').textContent += `\n$ ${val}\n`;
          el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
          el('terminalInput').value = '';

          const match = val.match(/^(python3\s+-m\s+)?pip(3)?\s+install\s+(.+)$/i);
          if (match && window.electronAPI) {
            const rawPackages = match[3];
            const packages = rawPackages.split(/\s+/).filter(p => p.trim() && !p.startsWith('-'));
            if (packages.length > 0) {
              el('terminalInput').disabled = true;
              el('terminalInput').placeholder = 'Installing package(s)... Please wait...';
              
              window.electronAPI.onCodeOutput((data) => {
                el('terminalOutput').textContent += data.data;
                el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
              });

              window.electronAPI.onPipExit((data) => {
                el('terminalInput').disabled = false;
                el('terminalInput').placeholder = 'Type input here and press Enter...';
                el('terminalInput').focus();
                window.electronAPI.removePipListeners();
                window.electronAPI.removeCodeListeners();
              });
              
              window.electronAPI.runPipInstall(packages);
            } else {
              el('terminalOutput').textContent += `[System Error]: Please specify at least one package name.\n`;
            }
          } else {
            el('terminalOutput').textContent += `[System Error]: Only 'pip install <package>' commands are allowed for environment setup.\n`;
          }
          el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
        }
      }
    });
  }

  if (loginForm.serverUrl) {
    loginForm.serverUrl.value = state.serverUrl;
  }
  if (loginForm.examId) {
    loginForm.examId.value = state.examId;
  }
  if (loginForm.rollNumber) {
    loginForm.rollNumber.value = state.rollNumber;
  }
  
  await loadStatus();
  if (state.token) {
    connectWebSocket();
    if (window.electronAPI) {
      window.electronAPI.requestFullscreen(true);
    }
    loadStudentExam().catch((error) => logEvent(error.message));
  }
});