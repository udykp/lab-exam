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
const facultyView = el('facultyView');
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
  const facultyUserBadge = el('facultyUserBadge');
  const loggedInUser = el('loggedInUser');

  if (isUserLoggedIn) {
    if (loginHeader) loginHeader.classList.add('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (state.role !== 'student') {
      if (facultyUserBadge) facultyUserBadge.classList.remove('hidden');
      if (loggedInUser) {
        loggedInUser.textContent = state.name || state.role;
      }
    } else {
      if (facultyUserBadge) facultyUserBadge.classList.add('hidden');
    }
  } else {
    if (loginHeader) loginHeader.classList.remove('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
    if (facultyUserBadge) facultyUserBadge.classList.add('hidden');
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
  } else if (state.role === 'student') {
    grid.className = 'grid two-col workspace-only';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.add('hidden');
    if (shell) shell.classList.add('wide-shell');
    if (hero) hero.classList.add('hidden');
  } else {
    // For Faculty and Admin, use full-width workspace-only layout to eliminate empty left space
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
  if (mode === 'student' && !window.electronAPI) {
    mode = 'faculty';
  }
  state.mode = mode;
  loginForm.role.value = mode;
  document.querySelectorAll('.segmented-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
  setHidden('.student-only', mode !== 'student');
  setHidden('.faculty-only', mode !== 'faculty');
  setHidden('.admin-only', mode !== 'admin');
  setHidden('.faculty-admin-only', mode === 'student');
  
  studentView.classList.toggle('hidden', mode !== 'student');
  facultyView.classList.toggle('hidden', mode !== 'faculty');
  
  const adminView = el('adminView');
  if (adminView) adminView.classList.toggle('hidden', mode !== 'admin');
  
  if (mode === 'student') {
    workspaceTitle.textContent = 'Student Workspace';
    workspaceHint.textContent = 'Login as a student to load your assigned question.';
  } else if (mode === 'faculty') {
    workspaceTitle.textContent = 'Faculty Dashboard';
    workspaceHint.textContent = 'Manage roster import, question bank, and chit assignment here.';
  } else if (mode === 'admin') {
    workspaceTitle.textContent = 'Admin Control Center';
    workspaceHint.textContent = 'Manage faculty accounts, assign subjects/classes, and upload student rosters.';
  }
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
  tokenPreview.textContent = state.token ? `${state.role}: ${state.token.slice(0, 32)}...` : 'Not signed in';
};

const loadStatus = async () => {
  try {
    await api('/health', { headers: {} });
    serverStatus.textContent = 'Server online';
    statusText.textContent = 'Connected to localhost:8080';
  } catch (error) {
    serverStatus.textContent = 'Server offline';
    statusText.textContent = error.message;
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

const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  questionLabel.textContent = `Question ${q.number || (index + 1)}`;
  questionTitle.textContent = q.title;
  questionPrompt.textContent = q.prompt;
  state.questionId = q.id;

  const attachDiv = el('studentAttachments');
  if (attachDiv) {
    if (q.attachmentUrls && q.attachmentUrls.length > 0) {
      attachDiv.innerHTML = q.attachmentUrls.map(url => {
        const parts = url.split('/');
        const filename = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
        const cleanName = cleanAttachmentFilename(filename);
        const base = url.startsWith('http') ? url : `${state.serverUrl || 'https://exams.crraoaimscs.ac.in'}${url}`;
        const fullUrl = `${base}${base.includes('?') ? '&' : '?'}roll_no=${encodeURIComponent(state.rollNumber)}`;
        
        const lower = filename.toLowerCase();
        const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp');
        const isTabular = lower.endsWith('.csv') || lower.endsWith('.tsv');

        if (isImage) {
          return `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; margin-top: 12px;">
              <img class="student-attachment-image" src="${fullUrl}" alt="${cleanName}" style="max-width: 100%; max-height: 350px; border-radius: 8px; border: 1px solid var(--panel-border); object-fit: contain; background: var(--bg-2); cursor: zoom-in;" />
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
            </div>
            <a href="${fullUrl}" target="_blank" class="dataset-resource-btn" style="text-decoration: none;">Download &rarr;</a>
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
      examLabel.textContent = activeAtt.exam_title ? `Exam: ${activeAtt.exam_title}` : `Assigned Lab Exam`;
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

const loadFacultyData = async () => {
  if (!state.token) return;
  try {
    const profile = await api('/api/me');
    state.name = profile.data.faculty.name || '';
    state.assignments = profile.data.assignments || [];
    renderAuthLayout();

    // Render My Teaching Assignments
    const assignmentList = el('facultyAssignmentList');
    if (assignmentList) {
      if (state.assignments.length === 0) {
        assignmentList.innerHTML = `<p style="color: #71717a; font-size: 0.9rem; margin: 0;">No teaching assignments found.</p>`;
      } else {
        assignmentList.innerHTML = state.assignments.map((item) => {
          const year = item.year || (item.offering && item.offering.year) || '';
          const semester = item.semester || (item.offering && item.offering.semester) || '';
          const section = item.section || (item.offering && item.offering.section) || '';
          return `
            <div class="assignment-card" data-id="${item.id}" style="background: #ffffff; border: 1.5px solid #e4e4e7; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: bold; color: #18181b; font-size: 1.05rem;">${item.subject.name}</div>
              <div style="font-size: 0.85rem; color: #71717a;">${item.subject.code} • Yr ${year} - Semester ${semester}</div>
              <div style="font-size: 0.85rem; color: #71717a;">Class: ${section}</div>
            </div>
          `;
        }).join('');

        assignmentList.querySelectorAll('.assignment-card').forEach((card) => {
          card.addEventListener('click', async (e) => {
            // Remove active style from other cards
            assignmentList.querySelectorAll('.assignment-card').forEach(c => {
              c.style.borderColor = '#e4e4e7';
              c.style.boxShadow = '';
            });
            // Highlight selected card
            card.style.borderColor = '#3b82f6';
            card.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.2)';

            const assignmentId = card.dataset.id;
            state.activeAssignmentId = assignmentId;
            
            // Show exams section
            el('facultyExamsSection').classList.remove('hidden');
            // Hide bottom details if visible
            el('examDetailsSection').classList.add('hidden');
            el('selectedSetSection').classList.add('hidden');

            await loadExamsForAssignment(assignmentId);
          });
        });
      }
    }
  } catch (err) {
    logEvent(`Failed to load faculty data: ${err.message}`);
  }
};

const loadExamSubmissions = async (examId) => {
  const tbody = el('examSubmissionsList');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #71717a;">Loading submissions...</td></tr>`;

  try {
    const res = await api(`/api/faculty/exams/${examId}/submissions`);
    let submissions = res.data || [];
    if (res.data && !Array.isArray(res.data) && Array.isArray(res.data.submissions)) {
      submissions = res.data.submissions;
    }
    state.submissions = submissions;
    if (submissions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #71717a;">No student paper assignments made yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = submissions.map((row) => {
      const dt = new Date(row.assigned_at).toLocaleString();
      let statusColor = '#e2e8f0';
      let statusText = 'Assigned';
      if (row.status === 'started') {
        statusColor = '#dbeafe';
        statusText = 'In Progress';
      } else if (row.status === 'submitted') {
        statusColor = '#d1fae5';
        statusText = 'Submitted';
      }

      const student_name = row.student_name || (row.student && row.student.name) || 'Student';
      const roll_no = row.roll_no || (row.student && row.student.roll_no) || '';
      const paper_title = row.paper_title || (row.paper && row.paper.title) || 'N/A';

      return `
        <tr style="border-bottom: 1px solid #e2e8f0; hover: background-color: #f1f5f9;">
          <td style="padding: 10px 12px; font-weight: 500;">${student_name}</td>
          <td style="padding: 10px 12px;">${roll_no}</td>
          <td style="padding: 10px 12px;">${paper_title}</td>
          <td style="padding: 10px 12px; font-size: 0.85rem; color: #64748b;">${dt}</td>
          <td style="padding: 10px 12px;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; background: ${statusColor}; text-transform: capitalize;">${statusText}</span>
          </td>
          <td style="padding: 10px 12px;">
            <span style="font-weight: 700; color: #0f766e;">${row.answered_count}</span> / ${row.question_count}
          </td>
          <td style="padding: 10px 12px; text-align: center;">
            <button class="secondary view-responses-btn" data-roll="${roll_no}" style="padding: 4px 8px; font-size: 0.8rem; height: 28px;">View Responses</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.view-responses-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const roll = btn.dataset.roll;
        const row = submissions.find(r => {
          const r_roll = r.roll_no || (r.student && r.student.roll_no);
          return r_roll === roll;
        });
        if (row) {
          showStudentResponsesModal(row);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding: 16px; text-align: center; color: #ef4444;">Failed to load: ${err.message}</td></tr>`;
  }
};

const showStudentResponsesModal = (row) => {
  const modal = el('studentResponseModal');
  const title = el('responseModalTitle');
  const body = el('responseModalBody');
  if (!modal || !title || !body) return;

  const student_name = row.student_name || (row.student && row.student.name) || 'Student';
  const roll_no = row.roll_no || (row.student && row.student.roll_no) || '';
  const paper_title = row.paper_title || (row.paper && row.paper.title) || 'N/A';
  title.textContent = `Responses for ${student_name} (${roll_no}) — Set: ${paper_title}`;
  const assignments = row.assignments || row.questions || [];
  if (assignments.length === 0) {
    body.innerHTML = `<p style="color: #71717a; text-align: center;">No questions assigned.</p>`;
  } else {
    // Sort questions by number
    const sorted = [...assignments].sort((a, b) => {
      const a_num = a.number || 0;
      const b_num = b.number || 0;
      return a_num - b_num;
    });

    body.innerHTML = sorted.map((as, idx) => {
      const responseText = as.response ? as.response.trim() : '';
      const formattedResponse = responseText ? `<pre style="background: #18181b; color: #ffffff; padding: 14px; border-radius: 10px; font-family: monospace; font-size: 0.95rem; line-height: 1.4; overflow-x: auto; margin: 8px 0; white-space: pre-wrap; word-break: break-all;">${escapeHTML(responseText)}</pre>` : `<p style="color: #a1a1aa; font-style: italic; margin: 8px 0;">No response submitted yet.</p>`;
      
      const subTime = as.submitted_at ? `<span style="font-size: 0.8rem; color: #64748b; margin-left: 12px;">Submitted: ${new Date(as.submitted_at).toLocaleString()}</span>` : '';

      // Format attachments if present
      let attachHTML = '';
      if (as.attachments) {
        let files = [];
        try {
          if (typeof as.attachments === 'string') {
            files = JSON.parse(as.attachments);
          } else if (Array.isArray(as.attachments)) {
            files = as.attachments;
          }
        } catch (_) {}

        if (files && files.length > 0) {
          const q_id = as.question_id || as.id || '';
          attachHTML = `
            <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
              <span style="font-size: 0.8rem; font-weight: bold; color: #64748b; align-self: center;">Attachments:</span>
              ${files.map(filename => {
                const url = `/api/media/questions/${q_id}/${encodeURIComponent(filename)}?roll_no=${encodeURIComponent(roll_no)}`;
                return `<a href="${url}" target="_blank" style="font-size: 0.8rem; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px; text-decoration: none; font-weight: 500;">📎 ${filename}</a>`;
              }).join('')}
            </div>
          `;
        }
      }

      const q_text = as.question_text || as.text || '';
      return `
        <div style="border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; background: #ffffff;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #f4f4f5; padding-bottom: 8px; margin-bottom: 12px;">
            <span style="font-weight: bold; color: #18181b; font-size: 1.05rem;">Question ${as.number || (idx + 1)} (${as.marks || 0} Marks)</span>
            ${subTime}
          </div>
          <p style="color: #475569; margin: 0 0 8px 0; line-height: 1.5; font-size: 0.95rem;">${q_text}</p>
          ${attachHTML}
          <div style="margin-top: 12px;">
            <span style="font-size: 0.8rem; font-weight: bold; color: #475569;">Student Response:</span>
            ${formattedResponse}
          </div>
        </div>
      `;
    }).join('');
  }

  modal.classList.remove('hidden');
};

const escapeHTML = (str) => {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
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

  // Student search/filter input handling for Bulk Assign
  const searchInput = el('searchStudentInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = (e.target.value || '').toLowerCase().trim();
      if (!state.currentClassStudents) return;
      
      const filtered = state.currentClassStudents.filter((std) => {
        const nameMatch = std.name && std.name.toLowerCase().includes(query);
        const rollMatch = std.roll_no && std.roll_no.toLowerCase().includes(query);
        return nameMatch || rollMatch;
      });
      
      renderStudentRosterTable(filtered);
    });
  }

  // Select All Students Button / Checkbox handling
  const toggleSelectAllBtn = el('toggleSelectAllBtn');
  const selectAllCb = el('selectAllStudentsCheckbox');
  if (toggleSelectAllBtn && selectAllCb) {
    toggleSelectAllBtn.addEventListener('click', (e) => {
      if (e.target !== selectAllCb) {
        selectAllCb.checked = !selectAllCb.checked;
      }
      const query = (el('searchStudentInput')?.value || '').toLowerCase().trim();
      const all = state.currentClassStudents || [];
      const visible = all.filter((std) => {
        if (!query) return true;
        const nameMatch = std.name && std.name.toLowerCase().includes(query);
        const rollMatch = std.roll_no && std.roll_no.toLowerCase().includes(query);
        return nameMatch || rollMatch;
      });

      if (selectAllCb.checked) {
        visible.forEach((std) => state.selectedStudentRolls.add(std.roll_no));
      } else {
        visible.forEach((std) => state.selectedStudentRolls.delete(std.roll_no));
      }

      renderStudentRosterTable(visible);
    });
  }
});

const loadExamsForAssignment = async (assignmentId) => {
  try {
    const examsRes = await api('/api/faculty/exams');
    const activeAssignment = state.assignments.find(a => a.id === assignmentId);
    const exams = (examsRes.data || []).filter(ex => {
      if (ex.faculty_assignment_id === assignmentId) return true;
      if (ex.offering_id === assignmentId) return true;
      if (activeAssignment && activeAssignment.offering_id && ex.offering_id === activeAssignment.offering_id) return true;
      return false;
    });
    state.exams = exams;

    const examsList = el('facultyExamsList');
    if (examsList) {
      if (exams.length === 0) {
        examsList.innerHTML = `<p style="color: #71717a; font-size: 0.9rem; margin: 10px 0;">No exams created for this assignment yet.</p>`;
      } else {
        examsList.innerHTML = exams.map((exam) => {
          const dt = exam.created_at ? new Date(exam.created_at).toLocaleString() : 'N/A';
          const codeDisplay = exam.code || exam.id;
          return `
            <div style="background: #ffffff; border: 1.5px solid #e4e4e7; border-radius: 12px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
              <div>
                <div style="font-weight: 600; color: #18181b; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span>${exam.title}</span>
                  <span style="font-size: 0.8rem; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
                    Code: <span>${codeDisplay}</span>
                    <button type="button" class="copy-exam-code-btn" data-code="${codeDisplay}" title="Copy Exam Code" style="background: transparent; border: none; cursor: pointer; padding: 0 2px; font-size: 0.85rem; color: #1d4ed8;">📋</button>
                  </span>
                  <span style="font-size: 0.75rem; background: #f4f4f5; color: #71717a; padding: 2px 6px; border-radius: 4px; font-family: monospace;">ID: ${exam.id}</span>
                </div>
                <div style="font-size: 0.8rem; color: #71717a; text-transform: capitalize; margin-top: 2px;">${exam.status} • ${dt}</div>
              </div>
              <button class="secondary open-exam-btn" data-id="${exam.id}" style="padding: 6px 12px; font-size: 0.85rem;">Open</button>
            </div>
          `;
        }).join('');

        examsList.querySelectorAll('.open-exam-btn').forEach((btn) => {
          btn.addEventListener('click', () => loadExamDetails(btn.dataset.id));
        });

        examsList.querySelectorAll('.copy-exam-code-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const code = btn.dataset.code;
            if (navigator.clipboard) {
              navigator.clipboard.writeText(code).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = orig; }, 1500);
                logEvent(`Copied exam code ${code} to clipboard`);
              }).catch(() => prompt('Exam Code:', code));
            } else {
              prompt('Exam Code:', code);
            }
          });
        });
      }
    }
  } catch (err) {
    logEvent(`Failed to load exams: ${err.message}`);
  }
};

const loadExamDetails = async (examId) => {
  try {
    const res = await api(`/api/faculty/exams/${examId}`);
    const exam = res.data.exam;
    const papers = res.data.papers || [];
    state.papers = papers;
    state.activeExam = exam;

    state.activeExamId = examId;

    const detailsSec = el('examDetailsSection');
    detailsSec.classList.remove('hidden');
    detailsSec.scrollIntoView({ behavior: 'smooth' });

    const examCode = exam.code || exam.id;
    el('examDetailTitle').textContent = exam.title;
    el('examDetailMeta').innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
        <span style="display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; border: 1.5px solid #bfdbfe; padding: 3px 10px; border-radius: 8px;">
          <span style="font-size: 0.8rem; font-weight: 600; color: #1e40af; text-transform: uppercase;">Exam Code:</span>
          <strong style="color: #1d4ed8; font-family: monospace; font-size: 1.1rem; letter-spacing: 1px;">${examCode}</strong>
          <button type="button" id="copyExamDetailCodeBtn" data-code="${examCode}" title="Copy Code" style="background: #ffffff; border: 1px solid #bfdbfe; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 0.8rem; font-weight: 600; color: #1d4ed8; transition: all 0.2s ease;">📋 Copy</button>
        </span>
        <span style="color: #71717a; font-size: 0.9rem;">
          Subject: <strong>${exam.subject || (exam.subject_obj && exam.subject_obj.name) || ''}</strong> | Class: Yr ${exam.year || ''} / Sem ${exam.semester || ''} / Sec ${exam.section || ''} | Status: <strong style="text-transform: capitalize;">${exam.status}</strong>
        </span>
      </div>
    `;

    const copyDetailBtn = el('copyExamDetailCodeBtn');
    if (copyDetailBtn) {
      copyDetailBtn.addEventListener('click', () => {
        const code = copyDetailBtn.dataset.code;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => {
            copyDetailBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyDetailBtn.textContent = '📋 Copy'; }, 1500);
            logEvent(`Copied exam code ${code} to clipboard`);
          }).catch(() => prompt('Exam Code:', code));
        } else {
          prompt('Exam Code:', code);
        }
      });
    }

    // Render action buttons based on status
    const actionsContainer = el('examDetailStatusActions');
    if (actionsContainer) {
      actionsContainer.innerHTML = `
        <button id="renameExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem;">Rename</button>
        ${exam.status === 'draft' ? `<button id="publishExamBtn" class="primary" style="padding: 6px 12px; font-size: 0.85rem; background: #2563eb !important; border-color: #2563eb !important;">Publish</button>` : ''}
        ${exam.status === 'published' ? `<button id="archiveExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem; border-color: #71717a !important; color: #71717a !important;">Archive</button>` : ''}
        <button id="cloneExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem; border-color: #10b981 !important; color: #10b981 !important;">Clone</button>
        <button id="deleteExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem; border-color: #ef4444 !important; color: #ef4444 !important;">Delete</button>
      `;

      el('renameExamBtn').addEventListener('click', async () => {
        const newTitle = prompt('Enter new exam title:', exam.title);
        if (newTitle && newTitle.trim()) {
          try {
            await api(`/api/faculty/exams/${examId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: newTitle.trim() }),
            });
            logEvent('Renamed exam');
            await loadExamDetails(examId);
            await loadExamsForAssignment(state.activeAssignmentId);
          } catch (err) { alert(err.message); }
        }
      });

      if (el('publishExamBtn')) {
        el('publishExamBtn').addEventListener('click', async () => {
          if (confirm('Publish this exam? This will lock questions and make papers assignable.')) {
            try {
              await api(`/api/faculty/exams/${examId}/publish`, { method: 'POST' });
              logEvent('Published exam');
              await loadExamDetails(examId);
              await loadExamsForAssignment(state.activeAssignmentId);
            } catch (err) { alert(err.message); }
          }
        });
      }

      if (el('archiveExamBtn')) {
        el('archiveExamBtn').addEventListener('click', async () => {
          if (confirm('Archive this exam?')) {
            try {
              await api(`/api/faculty/exams/${examId}/archive`, { method: 'POST' });
              logEvent('Archived exam');
              await loadExamDetails(examId);
              await loadExamsForAssignment(state.activeAssignmentId);
            } catch (err) { alert(err.message); }
          }
        });
      }

      el('cloneExamBtn').addEventListener('click', async () => {
        const others = state.assignments.filter(item => item.id !== state.activeAssignmentId);
        if (others.length === 0) {
          alert('You have no other teaching assignments to clone this exam to.');
          return;
        }

        let promptText = 'Select target teaching assignment to clone to:\n\n';
        others.forEach((item, idx) => {
          const section = item.section || (item.offering && item.offering.section) || '';
          const semester = item.semester || (item.offering && item.offering.semester) || '';
          promptText += `${idx + 1}. ${item.subject.name} - ${item.subject.code} [Sec ${section}, Sem ${semester}]\n`;
        });
        promptText += '\nEnter the option number (e.g. 1):';

        const choice = prompt(promptText);
        if (choice === null) return;
        const choiceIdx = parseInt(choice.trim(), 10) - 1;
        if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= others.length) {
          alert('Invalid choice');
          return;
        }

        const target = others[choiceIdx];
        const targetOfferingId = target.offering_id || (target.offering && target.offering.id) || target.id;
        const newTitle = prompt('Enter title for cloned exam (or cancel/leave blank for default):', exam.title + ' (Clone)');
        if (newTitle === null) return;

        try {
          await api(`/api/faculty/exams/${examId}/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              offering_id: targetOfferingId,
              faculty_assignment_id: target.id,
              title: newTitle.trim()
            })
          });
          logEvent('Cloned exam');
          alert('Exam successfully cloned to class: ' + (target.subject ? target.subject.name : 'Target Class'));
        } catch (err) { alert(err.message); }
      });

      el('deleteExamBtn').addEventListener('click', async () => {
        if (confirm('Delete this exam completely?')) {
          try {
            await api(`/api/faculty/exams/${examId}`, { method: 'DELETE' });
            logEvent('Deleted exam');
            detailsSec.classList.add('hidden');
            el('selectedSetSection').classList.add('hidden');
            await loadExamsForAssignment(state.activeAssignmentId);
          } catch (err) { alert(err.message); }
        }
      });
    }

    // Load submissions for this exam
    loadExamSubmissions(examId).catch((error) => console.error('Failed to load submissions:', error));

    const refreshSubmissionsBtn = el('refreshSubmissionsBtn');
    if (refreshSubmissionsBtn) {
      // Clear existing listeners
      const newBtn = refreshSubmissionsBtn.cloneNode(true);
      refreshSubmissionsBtn.parentNode.replaceChild(newBtn, refreshSubmissionsBtn);
      newBtn.addEventListener('click', () => {
        loadExamSubmissions(examId).catch((error) => alert(error.message));
      });
    }

    // Render Question-Paper Sets (papers)
    const paperSetsList = el('examPaperSetsList');
    if (paperSetsList) {
      if (papers.length === 0) {
        paperSetsList.innerHTML = `<p style="color: #71717a; font-size: 0.9rem; margin: 0;">No question-paper sets found.</p>`;
        el('selectedSetSection').classList.add('hidden');
      } else {
        paperSetsList.innerHTML = papers.map((paper, idx) => {
          const displayTitle = idx === 0 ? "SET A" : paper.title;
          return `
            <div class="paper-set-card" data-id="${paper.id}" style="background: #ffffff; border: 1.5px solid #e4e4e7; border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.2s ease;">
              <div style="font-weight: bold; color: #18181b;">${displayTitle}</div>
              <div style="font-size: 0.85rem; color: #71717a; margin-top: 4px;">set ${idx + 1} - ${paper.questions ? paper.questions.length : 0} question(s)</div>
            </div>
          `;
        }).join('');

        paperSetsList.querySelectorAll('.paper-set-card').forEach((card) => {
          card.addEventListener('click', () => {
            // Highlight set card
            paperSetsList.querySelectorAll('.paper-set-card').forEach(c => {
              c.style.borderColor = '#e4e4e7';
              c.style.boxShadow = '';
            });
            card.style.borderColor = '#3b82f6';
            card.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.2)';

            loadPaperDetails(card.dataset.id, exam.status);
          });
        });

        // Automatically default to the first set (e.g. Set A / index 0)
        let activePaperId = state.activePaperId;
        if (!activePaperId || !papers.some(p => p.id === activePaperId)) {
          activePaperId = papers[0].id;
        }

        const activeCard = paperSetsList.querySelector(`.paper-set-card[data-id="${activePaperId}"]`);
        if (activeCard) {
          activeCard.style.borderColor = '#3b82f6';
          activeCard.style.boxShadow = '0 0 0 2px rgba(59, 130, 246, 0.2)';
        }
        loadPaperDetails(activePaperId, exam.status);
      }
    }
  } catch (err) {
    alert('Failed to load exam details: ' + err.message);
  }
};

const renderStudentRosterTable = (studentsList) => {
  const tbody = el('studentsRosterList');
  const countBadge = el('selectedStudentsCountBadge');
  const totalBadge = el('totalStudentsCountBadge');
  const btnBadge = el('assignBtnCountBadge');
  const selectAllCb = el('selectAllStudentsCheckbox');
  const selectAllText = el('selectAllBtnText');
  if (!tbody) return;

  state.selectedStudentRolls = state.selectedStudentRolls || new Set();

  const totalCount = (state.currentClassStudents || []).length;
  if (totalBadge) totalBadge.textContent = totalCount;

  if (!studentsList || studentsList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">No matching students found.</td></tr>`;
    if (countBadge) countBadge.textContent = state.selectedStudentRolls.size;
    if (btnBadge) btnBadge.textContent = state.selectedStudentRolls.size;
    if (selectAllCb) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
    return;
  }

  // Map existing submissions to student rolls to show assignment status badges
  const submissionsMap = new Map();
  if (Array.isArray(state.submissions)) {
    state.submissions.forEach((sub) => {
      const roll = sub.roll_no || (sub.student && sub.student.roll_no);
      if (roll) submissionsMap.set(roll.toUpperCase(), sub);
    });
  }

  tbody.innerHTML = studentsList.map((std) => {
    const isSelected = state.selectedStudentRolls.has(std.roll_no);
    const existingSub = submissionsMap.get((std.roll_no || '').toUpperCase());
    let statusBadge = `<span style="font-size: 0.75rem; color: #94a3b8; font-weight: 500;">Not Assigned</span>`;
    if (existingSub) {
      const pTitle = existingSub.paper_title || (existingSub.paper && existingSub.paper.title) || 'Assigned';
      statusBadge = `<span style="font-size: 0.75rem; background: #e0e7ff; color: #3730a3; border: 1px solid #c7d2fe; padding: 2px 8px; border-radius: 6px; font-weight: 600; white-space: nowrap;">${pTitle}</span>`;
    }

    return `
      <tr class="student-roster-row" data-roll="${std.roll_no}" style="border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.15s ease; ${isSelected ? 'background: #eff6ff;' : 'background: #ffffff;'}">
        <td style="padding: 8px 12px; width: 42px; text-align: center;">
          <input type="checkbox" class="student-roster-cb" data-roll="${std.roll_no}" ${isSelected ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; margin: 0; padding: 0; vertical-align: middle;" />
        </td>
        <td style="padding: 8px 12px; font-family: monospace; font-weight: 700; color: #2563eb; width: 140px; white-space: nowrap;">
          ${std.roll_no}
        </td>
        <td style="padding: 8px 12px; font-weight: 600; color: #1e293b; white-space: nowrap;">
          ${std.name}
        </td>
        <td style="padding: 8px 12px; text-align: right; white-space: nowrap;">
          ${statusBadge}
        </td>
      </tr>
    `;
  }).join('');

  const updateSelectionUI = () => {
    const selectedCount = state.selectedStudentRolls.size;
    if (countBadge) countBadge.textContent = selectedCount;
    if (btnBadge) btnBadge.textContent = selectedCount;

    if (selectAllCb) {
      const visibleRolls = studentsList.map((s) => s.roll_no);
      const selectedVisibleCount = visibleRolls.filter((r) => state.selectedStudentRolls.has(r)).length;
      if (selectedVisibleCount === 0) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
        if (selectAllText) selectAllText.textContent = 'Select All';
      } else if (selectedVisibleCount === visibleRolls.length) {
        selectAllCb.checked = true;
        selectAllCb.indeterminate = false;
        if (selectAllText) selectAllText.textContent = 'Deselect All';
      } else {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = true;
        if (selectAllText) selectAllText.textContent = 'Select All';
      }
    }
  };

  updateSelectionUI();

  // Wire row click & checkbox listeners
  tbody.querySelectorAll('.student-roster-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      const roll = row.dataset.roll;
      const cb = row.querySelector('.student-roster-cb');
      if (e.target !== cb) {
        cb.checked = !cb.checked;
      }
      if (cb.checked) {
        state.selectedStudentRolls.add(roll);
        row.style.background = '#eff6ff';
      } else {
        state.selectedStudentRolls.delete(roll);
        row.style.background = '#ffffff';
      }
      updateSelectionUI();
    });
  });
};

const loadPaperDetails = async (paperId, examStatus) => {
  try {
    state.activePaperId = paperId;
    const paper = state.papers.find(p => p.id === paperId);
    if (!paper) return;

    const questions = paper.questions || [];

    const setSection = el('selectedSetSection');
    setSection.classList.remove('hidden');

    const paperCard = document.querySelector(`.paper-set-card[data-id="${paperId}"]`);
    const paperTitle = paperCard ? paperCard.querySelector('div').textContent : 'Set';
    el('selectedSetTitle').textContent = `Editing: ${paperTitle}`;

    // Render questions list
    const questionsList = el('examQuestionsList');
    if (questionsList) {
      if (questions.length === 0) {
        questionsList.innerHTML = `<p style="color: #71717a; font-size: 0.9rem; margin: 0;">No questions added to this set yet.</p>`;
      } else {
        questionsList.innerHTML = questions.map((q) => {
          let attachHTML = '';
          if (q.attachments && q.attachments.length > 0) {
            attachHTML = `
              <div style="margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.8rem; font-weight: bold; color: #64748b; align-self: center;">Attachments:</span>
                ${q.attachments.map(filename => {
                  const url = `/api/media/questions/${q.id}/${encodeURIComponent(filename)}`;
                  return `
                    <span style="font-size: 0.8rem; background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500;">
                      <a href="${url}" target="_blank" style="color: inherit; text-decoration: none;">📎 ${filename}</a>
                      ${examStatus === 'draft' ? `<span class="delete-q-attach-btn" data-qid="${q.id}" data-file="${encodeURIComponent(filename)}" style="cursor: pointer; color: #ef4444; font-weight: bold; margin-left: 4px;">✕</span>` : ''}
                    </span>
                  `;
                }).join('')}
              </div>
            `;
          }

          return `
            <div style="background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
              <div>
                <div style="font-weight: bold; color: #18181b; font-size: 1rem;">Q${q.number} <span style="font-weight: 500; font-size: 0.85rem; color: #71717a; margin-left: 8px;">(${q.marks} marks)</span></div>
                <div style="color: #3f3f46; margin-top: 6px; font-size: 0.95rem; white-space: pre-wrap;">${q.text}</div>
                ${attachHTML}
              </div>
              ${examStatus === 'draft' ? `
                <div style="display: flex; flex-direction: column; gap: 8px; margin-left: 12px; align-items: flex-end;">
                  <div style="display: flex; gap: 8px;">
                    <button class="secondary edit-question-btn" data-id="${q.id}" data-num="${q.number}" data-marks="${q.marks}" data-text="${encodeURIComponent(q.text)}" style="padding: 4px 8px; font-size: 0.8rem;">Edit</button>
                    <button class="secondary delete-question-btn" data-id="${q.id}" style="padding: 4px 8px; font-size: 0.8rem; border-color: #ef4444 !important; color: #ef4444 !important;">Delete</button>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                    <label style="cursor: pointer; font-size: 0.75rem; background: #f1f5f9; border: 1px solid #cbd5e1; padding: 2px 6px; border-radius: 4px; color: #475569;">
                      <span>+ Attach File</span>
                      <input type="file" class="attach-to-q-input" data-qid="${q.id}" style="display: none;" accept=".png,.jpeg,.jpg,.gif,.webp,.pdf,.csv" />
                    </label>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');

        // Wire attachment deletion
        questionsList.querySelectorAll('.delete-q-attach-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const qid = btn.dataset.qid;
            const file = btn.dataset.file;
            if (confirm(`Remove attachment ${decodeURIComponent(file)}?`)) {
              try {
                await api(`/api/faculty/questions/${qid}/attachments/${file}`, { method: 'DELETE' });
                logEvent('Deleted question attachment');
                const examRes = await api(`/api/faculty/exams/${state.activeExamId}`);
                state.papers = examRes.data.papers || [];
                await loadPaperDetails(paperId, examStatus);
              } catch (err) { alert('Failed to delete attachment: ' + err.message); }
            }
          });
        });

        // Wire inline attachment upload
        questionsList.querySelectorAll('.attach-to-q-input').forEach((input) => {
          input.addEventListener('change', async (e) => {
            const qid = input.dataset.qid;
            const file = e.target.files[0];
            if (!file) return;

            // Validation
            const allowed = ['.png', '.jpeg', '.jpg', '.gif', '.webp', '.pdf', '.csv'];
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!allowed.includes(ext)) {
              alert('Only PNG, JPEG, GIF, WebP, PDF, and CSV files are allowed.');
              return;
            }
            if (file.size > 100 * 1024 * 1024) {
              alert('File size exceeds 100MB limit.');
              return;
            }

            const formData = new FormData();
            formData.append('attachments', file);

            try {
              const url = `/api/faculty/questions/${qid}/attachments`;
              const xhr = new XMLHttpRequest();
              xhr.open('POST', url);
              if (state.token) {
                xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
              }
              xhr.onload = async () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                  logEvent('Uploaded attachment onto existing question');
                  const examRes = await api(`/api/faculty/exams/${state.activeExamId}`);
                  state.papers = examRes.data.papers || [];
                  await loadPaperDetails(paperId, examStatus);
                } else {
                  alert('Upload failed: ' + xhr.responseText);
                }
              };
              xhr.send(formData);
            } catch (err) { alert(err.message); }
          });
        });

        questionsList.querySelectorAll('.delete-question-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (confirm('Delete this question?')) {
              try {
                await api(`/api/faculty/questions/${btn.dataset.id}`, { method: 'DELETE' });
                logEvent('Deleted question');
                const examRes = await api(`/api/faculty/exams/${state.activeExamId}`);
                state.papers = examRes.data.papers || [];
                await loadPaperDetails(paperId, examStatus);
                await loadExamDetails(state.activeExamId);
              } catch (err) { alert(err.message); }
            }
          });
        });

        questionsList.querySelectorAll('.edit-question-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            el('qNumInput').value = btn.dataset.num;
            el('qMarksInput').value = btn.dataset.marks;
            el('qTextInput').value = decodeURIComponent(btn.dataset.text);
            el('qTextInput').focus();
          });
        });
      }
    }

    // Toggle add question inputs based on exam status
    if (examStatus !== 'draft') {
      el('addQuestionBtn').disabled = true;
      el('addQuestionBtn').textContent = 'Cannot edit published/archived exams';
    } else {
      el('addQuestionBtn').disabled = false;
      el('addQuestionBtn').textContent = 'Add question';
    }

    // Populate students dropdown for assigning set
    const studentsRes = await api(`/api/faculty/assignments/${state.activeAssignmentId}/students`);
    state.currentClassStudents = studentsRes.data || [];
    
    // Reset search query input
    const searchInput = el('searchStudentInput');
    if (searchInput) searchInput.value = '';
    
    renderStudentRosterTable(state.currentClassStudents);
  } catch (err) {
    alert('Failed to load paper details: ' + err.message);
  }
};

const loadAdminData = async () => {
  if (!state.token) return;
  try {
    // 1. Load Faculty Accounts
    const facRes = await api('/api/admin/faculty');
    const facList = facRes.data || [];
    const facTable = el('adminFacultyList');
    if (facTable) {
      facTable.innerHTML = facList.map((fac) => {
        const isActive = (fac.status || 'active') === 'active';
        const badgeColor = isActive ? '#d1fae5' : '#fee2e2';
        const badgeText = isActive ? 'Active' : 'Inactive';
        const toggleText = isActive ? 'Deactivate' : 'Activate';

        return `
          <tr style="border-bottom: 1px solid #e4e4e7;">
            <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">${fac.name}</td>
            <td style="padding: 12px 12px; color: #52525b;">${fac.email}</td>
            <td style="padding: 12px 12px;">
              <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 700; background: ${badgeColor}; text-transform: capitalize;">${badgeText}</span>
            </td>
            <td style="padding: 12px 12px; text-align: center; display: flex; gap: 8px; justify-content: center;">
              <button class="secondary toggle-status-btn" data-id="${fac.id}" data-status="${fac.status || 'active'}" style="padding: 6px 12px; font-size: 0.85rem; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">${toggleText}</button>
              <button class="secondary delete-fac-btn" data-id="${fac.id}" style="padding: 6px 12px; font-size: 0.85rem; border-color: #ef4444 !important; color: #ef4444 !important; background: transparent; border: 1.5px solid #ef4444; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">Delete</button>
            </td>
          </tr>
        `;
      }).join('');

      facTable.querySelectorAll('.toggle-status-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const fid = btn.dataset.id;
          const currentStatus = btn.dataset.status;
          const targetStatus = currentStatus === 'active' ? 'inactive' : 'active';
          try {
            await api(`/api/admin/faculty/${fid}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: targetStatus })
            });
            logEvent(`Toggled status to ${targetStatus} for faculty ${fid}`);
            await loadAdminData();
          } catch (err) { alert(err.message); }
        });
      });

      facTable.querySelectorAll('.delete-fac-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          if (confirm('Delete this faculty login?')) {
            try {
              await api(`/api/admin/faculty/${btn.dataset.id}`, { method: 'DELETE' });
              logEvent('Deleted faculty login');
              await loadAdminData();
            } catch (err) { alert(err.message); }
          }
        });
      });
    }

    const assignFacultySelect = el('assignFacultySelect');
    if (assignFacultySelect) {
      assignFacultySelect.innerHTML = facList.map((fac) => `<option value="${fac.id}">${fac.name} (${fac.email})</option>`).join('');
    }

    // 2. Load Subjects
    const subRes = await api('/api/admin/subjects');
    const subList = subRes.data || [];
    const subTable = el('adminSubjectsList');
    if (subTable) {
      subTable.innerHTML = subList.map((sub) => `
        <tr style="border-bottom: 1px solid #e4e4e7;">
          <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">${sub.code}</td>
          <td style="padding: 12px 12px; color: #52525b;">${sub.name}</td>
          <td style="padding: 12px 12px; text-align: center;">
            <button class="secondary delete-sub-btn" data-id="${sub.id}" style="padding: 6px 12px; font-size: 0.85rem; border-color: #ef4444 !important; color: #ef4444 !important; background: transparent; border: 1.5px solid #ef4444; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">Delete</button>
          </td>
        </tr>
      `).join('');

      subTable.querySelectorAll('.delete-sub-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          if (confirm('Delete this subject?')) {
            try {
              await api(`/api/admin/subjects/${e.target.dataset.id}`, { method: 'DELETE' });
              logEvent('Deleted subject');
              await loadAdminData();
            } catch (err) { alert(err.message); }
          }
        });
      });
    }

    const assignSubjectSelect = el('assignSubjectSelect');
    if (assignSubjectSelect) {
      assignSubjectSelect.innerHTML = subList.map((sub) => `<option value="${sub.id}">${sub.code} - ${sub.name}</option>`).join('');
    }

    // 3. Load Teaching Assignments
    const assignRes = await api('/api/admin/teaching-assignments');
    const assignList = assignRes.data || [];
    const assignTable = el('adminAssignmentsList');
    if (assignTable) {
      assignTable.innerHTML = assignList.map((item) => {
        const fac = facList.find(f => f.id === item.faculty_id) || { name: item.faculty_id };
        const subject_id = item.subject_id || (item.offering && item.offering.subject_id) || (item.subject && item.subject.id) || '';
        const sub = subList.find(s => s.id === subject_id) || { name: subject_id || 'Unknown' };
        const year = item.year || (item.offering && item.offering.year) || '';
        const semester = item.semester || (item.offering && item.offering.semester) || '';
        const section = item.section || (item.offering && item.offering.section) || '';
        return `
          <tr style="border-bottom: 1px solid #e4e4e7;">
            <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">${fac.name}</td>
            <td style="padding: 12px 12px; color: #52525b;">${sub.name}</td>
            <td style="padding: 12px 12px; color: #52525b;">Yr ${year} / Sem ${semester} / Sec ${section}</td>
            <td style="padding: 12px 12px; text-align: center;">
              <button class="secondary delete-assign-btn" data-id="${item.id}" style="padding: 6px 12px; font-size: 0.85rem; border-color: #ef4444 !important; color: #ef4444 !important; background: transparent; border: 1.5px solid #ef4444; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">Delete</button>
            </td>
          </tr>
        `;
      }).join('');

      assignTable.querySelectorAll('.delete-assign-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          if (confirm('Delete this teaching assignment?')) {
            try {
              await api(`/api/admin/teaching-assignments/${e.target.dataset.id}`, { method: 'DELETE' });
              logEvent('Deleted teaching assignment');
              await loadAdminData();
            } catch (err) { alert(err.message); }
          }
        });
      });
    }

    // 4. Load Student Batches (Classes List)
    const batchRes = await api('/api/admin/batches');
    const batchList = batchRes.data || [];
    const batchTable = el('adminRosterBatchesList');
    if (batchTable) {
      if (batchList.length === 0) {
        batchTable.innerHTML = `<tr><td colspan="4" style="padding: 12px; text-align: center; color: #71717a;">No student batches uploaded yet.</td></tr>`;
      } else {
        batchTable.innerHTML = batchList.map((b) => {
          const dt = new Date(b.uploaded_at).toLocaleString();
          return `
            <tr style="border-bottom: 1px solid #e4e4e7;">
              <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">Yr ${b.year} / Sem ${b.semester} / Sec ${b.section}</td>
              <td style="padding: 12px 12px; color: #52525b;">${b.source_file}</td>
              <td style="padding: 12px 12px; color: #52525b;">${dt}</td>
              <td style="padding: 12px 12px; text-align: center; font-weight: bold; color: #0f766e;">${b.students_count || 0}</td>
            </tr>
          `;
        }).join('');
      }
    }

    const assignBatchSelect = el('assignBatchSelect');
    if (assignBatchSelect) {
      if (batchList.length === 0) {
        assignBatchSelect.innerHTML = `<option value="">No student classes available (upload roster first)</option>`;
      } else {
        assignBatchSelect.innerHTML = batchList.map((b, idx) => `
          <option value="${idx}">Yr ${b.year} / Sem ${b.semester} / Sec ${b.section} (${b.students_count || 0} students)</option>
        `).join('');
      }
    }

    // Toggle manual vs dropdown class logic
    const toggleManualBtn = el('toggleManualAssignClassBtn');
    const toggleDropdownBtn = el('toggleDropdownAssignClassBtn');
    const dropdownArea = el('assignBatchDropdownArea');
    const manualArea = el('assignManualClassArea');

    if (toggleManualBtn && toggleDropdownBtn && dropdownArea && manualArea) {
      // Clear listeners
      const newToggleManual = toggleManualBtn.cloneNode(true);
      toggleManualBtn.parentNode.replaceChild(newToggleManual, toggleManualBtn);
      newToggleManual.addEventListener('click', (e) => {
        e.preventDefault();
        dropdownArea.classList.add('hidden');
        manualArea.classList.remove('hidden');
        state.assignClassMode = 'manual';
      });

      const newToggleDropdown = toggleDropdownBtn.cloneNode(true);
      toggleDropdownBtn.parentNode.replaceChild(newToggleDropdown, toggleDropdownBtn);
      newToggleDropdown.addEventListener('click', (e) => {
        e.preventDefault();
        manualArea.classList.add('hidden');
        dropdownArea.classList.remove('hidden');
        state.assignClassMode = 'dropdown';
      });
    }

    // Default mode
    state.assignClassMode = 'dropdown';
    state.batchList = batchList;

  } catch (err) {
    logEvent(`Failed to load admin data: ${err.message}`);
  }
};

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
  const mode = formData.get('role');
  const payload = { role: mode };

  const serverUrl = formData.get('serverUrl') || 'https://exams.crraoaimscs.ac.in';
  state.serverUrl = serverUrl.replace(/\/$/, '');
  localStorage.setItem('securemlexam_server_url', state.serverUrl);

  const email = formData.get('email');
  const password = formData.get('password');

  const showLoginError = (msg) => {
    // Reset button so student can try again
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
    // Show inline error — no alert, no app crash
    errorBox.textContent = '⚠️  ' + msg;
    errorBox.classList.remove('hidden');
    // Ensure form stays visible (in case a partial state change hid it)
    state.token = '';
    state.name  = '';
    updateGridLayout();
  };

  try {
    let data;
    if (mode === 'student') {
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
        // 1. Try matching by exam_code
        matchedAttempt = attempts.find(a => a.exam_code && a.exam_code.toUpperCase() === enteredUpper);
        // 2. Try matching by exam_id
        if (!matchedAttempt) {
          matchedAttempt = attempts.find(a => a.exam_id && (a.exam_id === enteredCode || a.exam_id.toUpperCase() === enteredUpper));
        }
        // 3. Try matching by attempt id
        if (!matchedAttempt) {
          matchedAttempt = attempts.find(a => a.id === enteredCode);
        }
        // 4. Fallback if student has only 1 attempt
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
        // Fallback: Check raw assignments
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

      data = {
        token: 'student_session',
        role: 'student',
        name: name || (resData.student && resData.student.name) || 'Student',
        rollNumber: rollNumber
      };
    } else if (mode === 'faculty') {
      const res = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      data = {
        token: 'faculty_session',
        role: 'faculty',
        name: res.data.name || 'Faculty',
        rollNumber: ''
      };
    } else if (mode === 'admin') {
      const res = await api('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      data = {
        token: 'admin_session',
        role: 'admin',
        name: 'Administrator',
        rollNumber: ''
      };
    }

    // Success — clear error, store session
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
    setMode(state.role);
    updateGridLayout();
    connectWebSocket();
    logEvent(`Signed in as ${state.name || state.role}`);

    if (state.role === 'student') {
      if (window.electronAPI) window.electronAPI.requestFullscreen(true);
      await loadStudentExam();
    } else if (state.role === 'faculty') {
      if (window.electronAPI) window.electronAPI.requestFullscreen(false);
      await loadFacultyData();
    } else if (state.role === 'admin') {
      if (window.electronAPI) window.electronAPI.requestFullscreen(false);
      await loadAdminData();
    }

    // Restore button for any future re-login
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';

  } catch (error) {
    showLoginError(error.message);
    logEvent(`Login failed: ${error.message}`);
  }
});

document.querySelectorAll('.segmented-btn').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

el('connectWsBtn').addEventListener('click', () => connectWebSocket());

el('refreshBtn').addEventListener('click', async () => {
  try {
    if (state.role === 'student') {
      await loadStudentExam();
    } else if (state.role === 'faculty') {
      await loadFacultyData();
    } else if (state.role === 'admin') {
      await loadAdminData();
    }
  } catch (error) {
    logEvent(error.message);
  }
});






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

if (el('assignBtn')) {
  el('assignBtn').addEventListener('click', async () => {
    try {
      const rollNumber = el('assignRoll').value.trim();
      const questionNumber = Number(el('assignQuestion').value.trim());
      const data = await api('/api/v1/faculty/exams/exam-1/chits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roll_number: rollNumber, question_number: questionNumber }),
      });
      logEvent(`Assigned question ${questionNumber} to ${rollNumber}`);
      await loadFacultyData();
      return data;
    } catch (error) {
      logEvent(error.message);
      alert(error.message);
    }
  });
}

if (el('importRosterBtn')) {
  el('importRosterBtn').addEventListener('click', async () => {
    try {
      const fileInput = el('rosterFile');
      if (!fileInput.files.length) {
        throw new Error('Choose an Excel file first');
      }
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      const response = await fetch(`${state.serverUrl}/api/v1/faculty/students/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed');
      logEvent(`Imported ${data.imported} students`);
      await loadFacultyData();
    } catch (error) {
      logEvent(error.message);
      alert(error.message);
    }
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

  // Admin dynamic tab switching
  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      el(targetId).classList.remove('hidden');
    });
  });

  // Faculty dynamic tab switching
  document.querySelectorAll('.faculty-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.faculty-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.faculty-tab-content').forEach(c => c.classList.add('hidden'));
      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      el(targetId).classList.remove('hidden');
    });
  });

  // Admin: Create Faculty Account
  if (el('createFacultyBtn')) {
    el('createFacultyBtn').addEventListener('click', async () => {
      const name = el('facNameInput').value.trim();
      const email = el('facEmailInput').value.trim();
      const password = el('facPasswordInput').value.trim();

      if (!name || !email || !password) {
        alert('Please fill Name, Email, and Password');
        return;
      }

      try {
        await api('/api/admin/faculty', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password })
        });
        logEvent(`Created faculty account: ${email}`);
        
        el('facNameInput').value = '';
        el('facEmailInput').value = '';
        el('facPasswordInput').value = '';

        await loadAdminData();
      } catch (err) {
        alert('Failed to create faculty: ' + err.message);
      }
    });
  }

  // Admin: Create Subject
  if (el('createSubjectBtn')) {
    el('createSubjectBtn').addEventListener('click', async () => {
      const code = el('subCodeInput').value.trim();
      const name = el('subNameInput').value.trim();

      if (!code || !name) {
        alert('Please fill Subject Code and Name');
        return;
      }

      try {
        await api('/api/admin/subjects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name })
        });
        logEvent(`Created subject: ${code}`);

        el('subCodeInput').value = '';
        el('subNameInput').value = '';

        await loadAdminData();
      } catch (err) {
        alert('Failed to create subject: ' + err.message);
      }
    });
  }

  // Admin: Create Teaching Assignment
  if (el('createAssignmentBtn')) {
    el('createAssignmentBtn').addEventListener('click', async () => {
      const faculty_id = el('assignFacultySelect').value;
      const subject_id = el('assignSubjectSelect').value;

      let year = '';
      let semester = '';
      let section = '';

      if (state.assignClassMode === 'dropdown') {
        const idx = el('assignBatchSelect').value;
        if (idx !== '' && state.batchList && state.batchList[idx]) {
          const batch = state.batchList[idx];
          year = batch.year;
          semester = batch.semester;
          section = batch.section;
        }
      } else {
        year = el('assignYearInput').value.trim();
        semester = el('assignSemesterInput').value.trim();
        section = el('assignSectionInput').value.trim();
      }

      if (!faculty_id || !subject_id || !year || !semester || !section) {
        alert('Please fill all assignment fields. (Ensure you have uploaded a student roster class first)');
        return;
      }

      try {
        await api('/api/admin/teaching-assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faculty_id, subject_id, year, semester, section })
        });
        logEvent('Created teaching assignment');

        el('assignYearInput').value = '';
        el('assignSemesterInput').value = '';
        el('assignSectionInput').value = '';

        await loadAdminData();
      } catch (err) {
        alert('Failed to create assignment: ' + err.message);
      }
    });
  }

  // Admin: Import Student Roster
  if (el('adminImportRosterBtn')) {
    el('adminImportRosterBtn').addEventListener('click', async () => {
      const year = el('rosterYearInput').value.trim();
      const semester = el('rosterSemesterInput').value.trim();
      const section = el('rosterSectionInput').value.trim();
      const fileInput = el('adminRosterFile');

      if (!year || !semester || !section || !fileInput.files.length) {
        alert('Please specify Year, Semester, Section, and select an Excel/CSV file.');
        return;
      }

      try {
        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('year', year);
        formData.append('semester', semester);
        formData.append('section', section);

        const response = await fetch(`${state.serverUrl}/api/admin/students/upload-excel`, {
          method: 'POST',
          credentials: 'include',
          body: formData
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Import failed');

        const responseData = data.data || {};
        const count = responseData.students_count || 0;
        logEvent(`Successfully uploaded student batch: ${count} students imported`);
        alert(`Successfully imported ${count} students.`);

        el('rosterYearInput').value = '';
        el('rosterSemesterInput').value = '';
        el('rosterSectionInput').value = '';
        fileInput.value = '';
      } catch (error) {
        alert('Roster upload failed: ' + error.message);
      }
    });
  }

  // Faculty: Create Exam Draft
  if (el('createExamBtn')) {
    el('createExamBtn').addEventListener('click', async () => {
      const title = el('examTitleInput').value.trim();

      if (!state.activeAssignmentId || !title) {
        alert('Please select an assignment and enter exam title');
        return;
      }

      try {
        const activeAssignment = state.assignments.find(a => a.id === state.activeAssignmentId);
        const offeringId = activeAssignment ? (activeAssignment.offering_id || activeAssignment.id) : state.activeAssignmentId;
        await api('/api/faculty/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            faculty_assignment_id: state.activeAssignmentId, 
            offering_id: offeringId,
            title 
          })
        });
        logEvent(`Exam draft created: ${title}`);
        el('examTitleInput').value = '';
        await loadExamsForAssignment(state.activeAssignmentId);
      } catch (err) {
        alert('Failed to create exam draft: ' + err.message);
      }
    });
  }

  // Faculty: Close Exam Panel
  if (el('closeExamBtn')) {
    el('closeExamBtn').addEventListener('click', () => {
      el('examDetailsSection').classList.add('hidden');
      el('selectedSetSection').classList.add('hidden');
    });
  }

  // Faculty: Create New Set (Paper)
  if (el('createNewSetBtn')) {
    el('createNewSetBtn').addEventListener('click', async () => {
      const title = el('newSetTitleInput').value.trim();
      if (!title) {
        alert('Please enter set title');
        return;
      }
      try {
        await api(`/api/faculty/exams/${state.activeExamId}/papers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title })
        });
        logEvent(`Created new set: ${title}`);
        el('newSetTitleInput').value = '';
        await loadExamDetails(state.activeExamId);
      } catch (err) {
        alert('Failed to create set: ' + err.message);
      }
    });
  }

  // Selected files for the new question dropzone
  let selectedFiles = [];

  const updateSelectedFilesUI = () => {
    const list = el('selectedFilesList');
    if (!list) return;
    list.innerHTML = selectedFiles.map((file, idx) => `
      <span style="font-size: 0.8rem; background: #e2e8f0; color: #334155; padding: 2px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; margin-bottom: 4px;">
        <span>📎 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
        <span class="remove-selected-file" data-idx="${idx}" style="cursor: pointer; color: #ef4444; font-weight: bold; margin-left: 4px;">✕</span>
      </span>
    `).join('');

    list.querySelectorAll('.remove-selected-file').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = Number(btn.dataset.idx);
        selectedFiles.splice(idx, 1);
        updateSelectedFilesUI();
      });
    });
  };

  const handleFilesAdded = (filesList) => {
    const allowed = ['.png', '.jpeg', '.jpg', '.gif', '.webp', '.pdf', '.csv'];
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!allowed.includes(ext)) {
        alert(`File type not allowed: ${file.name}\nOnly PNG, JPEG, GIF, WebP, PDF, and CSV files are allowed.`);
        continue;
      }
      if (file.size > 100 * 1024 * 1024) {
        alert(`File size exceeds 100MB limit: ${file.name}`);
        continue;
      }
      if (selectedFiles.length >= 5) {
        alert('Max 5 attachments allowed per question.');
        break;
      }
      selectedFiles.push(file);
    }
    updateSelectedFilesUI();
  };

  const dropzone = el('dropzone');
  const fileInput = el('qAttachmentInput');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      handleFilesAdded(e.target.files);
      fileInput.value = '';
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.background = '#f1f5f9';
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.style.background = 'transparent';
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.background = 'transparent';
      if (e.dataTransfer.files) {
        handleFilesAdded(e.dataTransfer.files);
      }
    });

    // Paste file handling
    const handlePaste = (e) => {
      if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        handleFilesAdded(e.clipboardData.files);
        e.preventDefault();
      }
    };
    dropzone.addEventListener('paste', handlePaste);
    if (el('qTextInput')) {
      el('qTextInput').addEventListener('paste', handlePaste);
    }
  }

  // Faculty: Save/Add Question
  if (el('addQuestionBtn')) {
    el('addQuestionBtn').addEventListener('click', async () => {
      const number = Number(el('qNumInput').value);
      const marks = Number(el('qMarksInput').value);
      const text = el('qTextInput').value.trim();

      if (!state.activePaperId) {
        alert('Please select an exam and question-paper set first');
        return;
      }
      if (!text) {
        alert('Question text is required');
        return;
      }

      const formData = new FormData();
      formData.append('number', number);
      formData.append('marks', marks);
      formData.append('text', text);

      selectedFiles.forEach((file) => {
        formData.append('attachments', file);
      });

      try {
        const url = `/api/faculty/papers/${state.activePaperId}/questions`;
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);
        if (state.token) {
          xhr.setRequestHeader('Authorization', 'Bearer ' + state.token);
        }
        xhr.onload = async () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            logEvent(`Saved question ${number}`);
            el('qNumInput').value = '';
            el('qMarksInput').value = '';
            el('qTextInput').value = '';
            selectedFiles = [];
            updateSelectedFilesUI();
            const res = await api(`/api/faculty/exams/${state.activeExamId}`);
            const exam = res.data.exam;
            await loadPaperDetails(state.activePaperId, exam.status);
            await loadExamDetails(state.activeExamId);
          } else {
            alert('Failed to save question: ' + xhr.responseText);
          }
        };
        xhr.send(formData);
      } catch (err) {
        alert('Failed to save question: ' + err.message);
      }
    });
  }

  // Faculty: Assign Paper Set to Student (Bulk / Multi-select)
  if (el('assignSetToStudentBtn')) {
    el('assignSetToStudentBtn').addEventListener('click', async () => {
      if (!state.activeExamId) {
        alert('Please open an exam first.');
        return;
      }
      if (!state.activePaperId) {
        alert('Please select a question paper set first.');
        return;
      }
      const rolls = Array.from(state.selectedStudentRolls || []);
      if (rolls.length === 0) {
        alert('Please select at least one student from the roster.');
        return;
      }

      const activePaper = (state.papers || []).find(p => p.id === state.activePaperId);
      const paperName = activePaper ? activePaper.title : 'this set';

      const confirmMsg = `Assign ${paperName} to ${rolls.length} selected student(s)?`;
      if (!confirm(confirmMsg)) return;

      const assignBtn = el('assignSetToStudentBtn');
      const origText = assignBtn.innerHTML;
      assignBtn.disabled = true;
      assignBtn.textContent = 'Assigning...';

      try {
        const res = await api(`/api/faculty/exams/${state.activeExamId}/assign-paper`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paper_id: state.activePaperId,
            student_roll_nos: rolls
          })
        });

        const d = res.data || {};
        const assignedCount = d.assigned_count !== undefined ? d.assigned_count : (res.success ? rolls.length : 0);
        const failedCount = d.failed_count !== undefined ? d.failed_count : 0;
        const results = d.results || [];

        const fb = el('bulkAssignFeedback');
        if (fb) {
          fb.classList.remove('hidden');
          if (failedCount === 0) {
            fb.style.background = '#dcfce7';
            fb.style.color = '#15803d';
            fb.style.border = '1px solid #86efac';
            fb.textContent = `✅ Successfully assigned ${paperName} to all ${assignedCount} student(s).`;
          } else {
            fb.style.background = '#fef3c7';
            fb.style.color = '#b45309';
            fb.style.border = '1px solid #fde68a';
            fb.textContent = `⚠️ Assigned: ${assignedCount}, Skipped/Failed: ${failedCount}. See table below.`;
          }
        }

        // Remove successfully assigned students from selection
        if (results.length > 0) {
          results.forEach(r => {
            if (r.ok) state.selectedStudentRolls.delete(r.student_roll_no);
          });
        } else if (res.success) {
          state.selectedStudentRolls.clear();
        }

        logEvent(`Assigned paper set to ${assignedCount} student(s) (${failedCount} skipped).`);
        await loadExamSubmissions(state.activeExamId);
        
        // Re-render student roster with updated status badges
        const searchInput = el('searchStudentInput');
        const query = (searchInput?.value || '').trim().toLowerCase();
        const all = state.currentClassStudents || [];
        const filtered = all.filter(std => {
          if (!query) return true;
          return (std.name && std.name.toLowerCase().includes(query)) || (std.roll_no && std.roll_no.toLowerCase().includes(query));
        });
        renderStudentRosterTable(filtered);

        let summaryMsg = `Successfully assigned to ${assignedCount} student(s).`;
        if (failedCount > 0) {
          const failedDetails = results.filter(r => !r.ok).map(r => `${r.student_roll_no}: ${r.message}`).join('\n');
          summaryMsg += `\n\n${failedCount} student(s) were not assigned:\n${failedDetails}`;
        }
        alert(summaryMsg);

      } catch (err) {
        const fb = el('bulkAssignFeedback');
        if (fb) {
          fb.classList.remove('hidden');
          fb.style.background = '#fee2e2';
          fb.style.color = '#b91c1c';
          fb.style.border = '1px solid #fca5a5';
          fb.textContent = `❌ ${err.message}`;
        }
        alert('Failed to assign set: ' + err.message);
      } finally {
        assignBtn.disabled = false;
        assignBtn.innerHTML = origText;
        const btnBadge = el('assignBtnCountBadge');
        if (btnBadge) btnBadge.textContent = state.selectedStudentRolls ? state.selectedStudentRolls.size : 0;
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
    if (state.role === 'student') {
      if (window.electronAPI) {
        window.electronAPI.requestFullscreen(true);
      }
      loadStudentExam().catch((error) => logEvent(error.message));
    } else if (state.role === 'faculty') {
      if (window.electronAPI) {
        window.electronAPI.requestFullscreen(false);
      }
      loadFacultyData().catch((error) => logEvent(error.message));
    } else if (state.role === 'admin') {
      if (window.electronAPI) {
        window.electronAPI.requestFullscreen(false);
      }
      loadAdminData().catch((error) => logEvent(error.message));
    }
  }
});