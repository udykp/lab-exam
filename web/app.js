const state = {
  mode: 'student',
  token: localStorage.getItem('securemlexam_token') || '',
  role: localStorage.getItem('securemlexam_role') || 'student',
  name: localStorage.getItem('securemlexam_name') || '',
  rollNumber: localStorage.getItem('securemlexam_rollnumber') || '',
  serverUrl: localStorage.getItem('securemlexam_server_url') || 'http://localhost:8080',
  examId: 'exam-1',
  ws: null,
  securityArmed: false,
  questions: [],
  activeQuestionIndex: 0,
  drafts: {},
  runWs: null,
};

const el = (id) => document.getElementById(id);

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
const codeEditor = el('codeEditor');

if (codeEditor) {
  codeEditor.addEventListener('keydown', (e) => {
    const start = codeEditor.selectionStart;
    const end = codeEditor.selectionEnd;
    const value = codeEditor.value;

    if (e.key === 'Tab') {
      e.preventDefault();
      codeEditor.value = value.substring(0, start) + '    ' + value.substring(end);
      codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const beforeCursor = value.substring(0, start);
      const afterCursor = value.substring(end);
      const lines = beforeCursor.split('\n');
      const currentLine = lines[lines.length - 1] || '';
      
      const match = currentLine.match(/^(\s*)/);
      let indent = match ? match[1] : '';
      
      if (currentLine.trim().endsWith(':')) {
        indent += '    ';
      }
      
      const newlineWithIndent = '\n' + indent;
      codeEditor.value = beforeCursor + newlineWithIndent + afterCursor;
      codeEditor.selectionStart = codeEditor.selectionEnd = start + newlineWithIndent.length;
    }
  });
}

const renderAuthLayout = () => {
  const isUserLoggedIn = !!state.token;
  const loginHeader = el('loginHeader');
  const loginForm = el('loginForm');
  const signOutArea = el('signOutArea');
  const loggedInUser = el('loggedInUser');

  if (isUserLoggedIn) {
    if (loginHeader) loginHeader.classList.add('hidden');
    if (loginForm) loginForm.classList.add('hidden');
    if (signOutArea) signOutArea.classList.remove('hidden');
    if (loggedInUser) {
      loggedInUser.textContent = state.name || state.role;
    }
  } else {
    if (loginHeader) loginHeader.classList.remove('hidden');
    if (loginForm) loginForm.classList.remove('hidden');
    if (signOutArea) signOutArea.classList.add('hidden');
  }
};

const updateGridLayout = () => {
  const grid = el('mainGrid');
  if (!grid) return;
  if (!state.token) {
    grid.className = 'grid two-col auth-only';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.remove('hidden');
  } else if (state.role === 'student') {
    grid.className = 'grid two-col workspace-only';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.add('hidden');
  } else {
    grid.className = 'grid two-col';
    if (el('windowCloseBtn')) el('windowCloseBtn').classList.remove('hidden');
  }
  renderAuthLayout();
};

const setHidden = (selector, hidden) => {
  document.querySelectorAll(selector).forEach((node) => node.classList.toggle('hidden', hidden));
};

const setMode = (mode) => {
  state.mode = mode;
  loginForm.role.value = mode;
  document.querySelectorAll('.segmented-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
  setHidden('.student-only', mode !== 'student');
  setHidden('.faculty-only', mode !== 'faculty');
  studentView.classList.toggle('hidden', mode !== 'student');
  facultyView.classList.toggle('hidden', mode !== 'faculty');
  workspaceTitle.textContent = mode === 'student' ? 'Student Workspace' : 'Faculty Dashboard';
  workspaceHint.textContent = mode === 'student'
    ? 'Login as a student to load your assigned question.'
    : 'Manage roster import, question bank, and chit assignment here.';
};

const api = async (path, options = {}) => {
  const headers = options.headers ? { ...options.headers } : {};
  if (state.token && !headers.Authorization) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  const url = path.startsWith('http') ? path : `${state.serverUrl}${path}`;
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
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
    await api('/healthz', { headers: {} });
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
  state.drafts[q.id] = {
    code: el('codeEditor').value,
    language: el('languageSelect').value,
    terminal: el('terminalOutput').textContent,
    terminalColor: el('terminalOutput').style.color,
  };
};

const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  questionLabel.textContent = `Question ${q.number}`;
  questionTitle.textContent = q.title;
  questionPrompt.textContent = q.prompt;
  state.questionId = q.id;

  const draft = state.drafts[q.id] || {
    code: '',
    language: q.language || 'python',
    terminal: 'Terminal ready. Write code and click Run Code.',
    terminalColor: '#10b981',
  };

  el('codeEditor').value = draft.code;
  el('languageSelect').value = draft.language;
  el('terminalOutput').textContent = draft.terminal;
  el('terminalOutput').style.color = draft.terminalColor;

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
    codeContent = el('codeEditor').value;
    language = el('languageSelect').value;
  } else {
    const draft = state.drafts[q.id];
    if (draft) {
      codeContent = draft.code;
      language = draft.language;
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
    const data = await api(`/api/v1/student/exam?exam_id=${encodeURIComponent(state.examId)}`);
    examLabel.textContent = `${data.exam.title} (${data.exam.id})`;
    
    state.questions = data.questions || [];
    state.drafts = {};
    state.activeQuestionIndex = 0;

    if (state.questions.length > 0) {
      const tabsContainer = el('studentTabs');
      tabsContainer.innerHTML = '';
      tabsContainer.classList.remove('hidden');

      state.questions.forEach((q, idx) => {
        const btn = document.createElement('button');
        btn.className = 'tab-btn';
        if (idx === 0) btn.classList.add('active');
        btn.textContent = `Program ${idx + 1}`;
        btn.type = 'button';
        btn.addEventListener('click', () => {
          saveCurrentTabState();
          loadTabState(idx);
        });
        tabsContainer.appendChild(btn);
      });

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

    // Arm security focus checks after a 2-second delay to ignore transient transition blur events
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
  const [questions, students] = await Promise.all([
    api('/api/v1/faculty/exams/exam-1/questions'),
    api('/api/v1/faculty/students'),
  ]);
  questionBank.innerHTML = questions.map((question) => `
    <div class="question-chip">
      <strong>${question.number}. ${question.title}</strong>
      <div>${question.prompt}</div>
    </div>
  `).join('');
  studentList.innerHTML = students.map((student) => `
    <div class="student-chip">
      <strong>${student.name}</strong>
      <div>Roll: ${student.roll_number}</div>
    </div>
  `).join('');
};

const connectWebSocket = () => {
  if (!state.token) return;
  if (state.ws) {
    state.ws.close();
  }
  const wsUrlBase = state.serverUrl.replace(/^http/, 'ws');
  state.ws = new WebSocket(`${wsUrlBase}/api/v1/ws?token=${encodeURIComponent(state.token)}`);
  state.ws.onopen = () => logEvent('WebSocket connected');
  state.ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      logEvent(`${payload.type}: ${payload.subject}`);
      if (payload.type === 'chit_assigned' && state.role === 'student') {
        loadStudentExam().catch((error) => logEvent(error.message));
      }
      if (payload.type === 'chit_assigned' && state.role === 'faculty') {
        loadFacultyData().catch((error) => logEvent(error.message));
      }
    } catch (error) {
      logEvent(event.data);
    }
  };
  state.ws.onclose = () => logEvent('WebSocket closed');
  state.ws.onerror = () => logEvent('WebSocket error');
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

  const serverUrl = formData.get('serverUrl') || 'http://localhost:8080';
  state.serverUrl = serverUrl.replace(/\/$/, '');
  localStorage.setItem('securemlexam_server_url', state.serverUrl);

  if (mode === 'student') {
    payload.name        = formData.get('name');
    payload.roll_number = formData.get('rollNumber');
    payload.exam_id     = formData.get('examId');
  } else {
    payload.email    = formData.get('email');
    payload.password = formData.get('password');
  }

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
    const data = await api('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Success — clear error, store session
    errorBox.classList.add('hidden');
    state.token = data.token;
    state.role  = data.role;
    state.name  = data.name || '';
    state.rollNumber = payload.roll_number || '';
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
    } else {
      if (window.electronAPI) window.electronAPI.requestFullscreen(false);
      await loadFacultyData();
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
    }
  } catch (error) {
    logEvent(error.message);
  }
});






el('submitBtn').addEventListener('click', async () => {
  saveCurrentTabState();
  const btn = el('submitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  btn.style.opacity = '0.7';

  try {
    const data = await api('/api/v1/student/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exam_id: state.examId,
        question_id: state.questionId || '',
        code: codeEditor.value,
      }),
    });
    logEvent(data.status || 'submitted');

    // Inline success feedback — no popup, no focus loss, no false violation
    btn.textContent = '✔ Submitted!';
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
});

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
    const codeToSubmit = draft ? draft.code : '';
    try {
      await api('/api/v1/student/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exam_id: state.examId,
          question_id: q.id,
          code: codeToSubmit,
        }),
      });
      logEvent(`Final submission saved for ${q.title}.`);
    } catch (err) {
      logEvent(`Warning: auto-submit failed for ${q.title}: ${err.message}`);
    }
  }

  // Notify server of voluntary end
  try {
    await api('/api/v1/student/violation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exam_id: state.examId,
        kind: 'exam-ended',
        details: 'Student voluntarily ended the exam session.'
      })
    });
  } catch (_) {}

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
  const code = el('codeEditor').value;
  const term = el('terminalOutput');
  const runBtn = el('runCodeBtn');
  const lang = el('languageSelect') ? el('languageSelect').value : 'python';
  
  const cleanupRunState = () => {
    el('terminalInputRow').classList.add('hidden');
    runBtn.disabled = false;
    runBtn.textContent = "Run Code";
    runBtn.style.removeProperty('background');
    runBtn.style.removeProperty('color');
    state.runWs = null;
    
    // Save draft after execution finishes
    const q = state.questions[state.activeQuestionIndex];
    if (q) {
      state.drafts[q.id] = {
        code: el('codeEditor').value,
        language: el('languageSelect').value,
        terminal: term.textContent,
        terminalColor: term.style.color,
      };
    }
  };

  if (state.runWs) {
    term.textContent += "\n[System Info]: Program stopped by user.";
    term.style.color = "#f87171";
    try { state.runWs.close(); } catch(e) {}
    state.runWs = null;
    cleanupRunState();
    return;
  }

  // Hide generated outputs initially
  if (el('terminalOutputs')) {
    el('terminalOutputs').classList.add('hidden');
    el('outputsContainer').innerHTML = '';
  }

  term.textContent = `Compiling & Executing ${lang.toUpperCase()} code... (Establish stream)\n`;
  term.style.color = "#a3e635"; // yellow-green during run
  runBtn.textContent = "Stop";
  runBtn.style.background = "#ef4444";
  runBtn.style.color = "#ffffff";
  runBtn.disabled = false;

  // Hide input row initially
  el('terminalInputRow').classList.add('hidden');
  el('terminalInput').value = '';

  const wsUrlBase = state.serverUrl.replace(/^http/, 'ws');
  const wsUrl = `${wsUrlBase}/api/v1/student/run/ws?token=${encodeURIComponent(state.token)}`;
  
  const socket = new WebSocket(wsUrl);
  state.runWs = socket;

  socket.onopen = () => {
    term.textContent = "";
    socket.send(JSON.stringify({
      code: code,
      language: lang,
      question_index: state.activeQuestionIndex
    }));
    el('terminalInputRow').classList.remove('hidden');
    el('terminalInput').focus();
  };

  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "formatted_code" && msg.formatted_code) {
        el('codeEditor').value = msg.formatted_code;
      } else if (msg.type === "output") {
        term.textContent += msg.data;
        el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
      } else if (msg.type === "exit") {
        if (msg.data) {
          term.style.color = "#f87171"; // error color
          term.textContent += "\n" + msg.data;
        } else {
          term.style.color = "#10b981"; // success color
          if (!term.textContent) {
            term.textContent = "Program finished with no output.";
          }
        }
        
        // Render any output files returned by the backend
        if (msg.files && msg.files.length > 0) {
          el('terminalOutputs').classList.remove('hidden');
          msg.files.forEach(file => {
            const container = document.createElement('div');
            container.style.marginBottom = '16px';
            container.style.border = '1px solid rgba(255, 255, 255, 0.1)';
            container.style.borderRadius = '8px';
            container.style.padding = '12px';
            container.style.background = '#1e1b4b'; // dark blue-indigo contrast
            
            const title = document.createElement('div');
            title.style.color = '#a3e635';
            title.style.fontWeight = 'bold';
            title.style.marginBottom = '8px';
            title.style.fontSize = '0.9rem';
            
            if (file.content_type.startsWith('image/')) {
              title.textContent = `📊 Output Image: ${file.name}`;
              const img = document.createElement('img');
              img.src = `data:${file.content_type};base64,${file.data_base64}`;
              img.style.maxWidth = '100%';
              img.style.maxHeight = '300px';
              img.style.borderRadius = '6px';
              container.appendChild(title);
              container.appendChild(img);
            } else if (file.content_type === 'application/pdf') {
              title.textContent = `📄 Output PDF Plot: ${file.name}`;
              const iframe = document.createElement('iframe');
              iframe.src = `data:${file.content_type};base64,${file.data_base64}`;
              iframe.style.width = '100%';
              iframe.style.height = '350px';
              iframe.style.border = 'none';
              iframe.style.borderRadius = '6px';
              iframe.style.background = '#ffffff';
              container.appendChild(title);
              container.appendChild(iframe);
            } else if (file.content_type.startsWith('text/')) {
              title.textContent = `🗃 Output File: ${file.name}`;
              const pre = document.createElement('pre');
              pre.textContent = atob(file.data_base64);
              pre.style.background = '#0c0a09';
              pre.style.color = '#e4e4e7';
              pre.style.padding = '8px 12px';
              pre.style.borderRadius = '6px';
              pre.style.overflowX = 'auto';
              pre.style.fontSize = '0.85rem';
              pre.style.margin = '0';
              container.appendChild(title);
              container.appendChild(pre);
            } else {
              title.textContent = `💾 File Generated: ${file.name}`;
              const p = document.createElement('p');
              p.textContent = `Saved to your local Desktop folder.`;
              p.style.color = '#e4e4e7';
              p.style.fontSize = '0.85rem';
              p.style.margin = '0';
              container.appendChild(title);
              container.appendChild(p);
            }
            el('outputsContainer').appendChild(container);
          });
        }
        
        el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
        cleanupRunState();
      }
    } catch (err) {
      console.error("Failed to parse run WS message:", err);
    }
  };

  socket.onerror = (err) => {
    term.style.color = "#f87171";
    term.textContent += `\n[Stream Error]: Connection to runner closed unexpectedly.`;
    cleanupRunState();
  };

  socket.onclose = () => {
    cleanupRunState();
  };
});

el('saveLocalBtn').addEventListener('click', async () => {
  const btn = el('saveLocalBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  try {
    saveCurrentTabState();
    const activeIndex = state.activeQuestionIndex;
    const res = await saveSingleProgramLocally(activeIndex);
    if (res && res.success) {
      btn.textContent = '✔ Saved!';
      btn.style.background = '#dcfce7';
      btn.style.color = '#15803d';
      logEvent(`Successfully saved locally to: ${res.path}`);
    } else {
      throw new Error(res ? res.error : 'Not running in desktop app');
    }
  } catch (err) {
    btn.textContent = '✖ Save Failed';
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
});

el('clearTerminalBtn').addEventListener('click', () => {
  el('terminalOutput').textContent = "Terminal ready. Write Python code and click Run Code.";
  el('terminalOutput').style.color = "#10b981";
});

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
window.addEventListener('contextmenu', (e) => e.preventDefault());

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
    // ── Web Browser Mode (Faculty Server Portal) ─────────────────────────────
    state.role = 'faculty';
    state.mode = 'faculty';
    setMode('faculty');

    const segmented = document.querySelector('.segmented');
    if (segmented) segmented.classList.add('hidden');

    const debugActions = el('debugActionsRow');
    if (debugActions) debugActions.classList.add('hidden');

    const tokenBox = el('tokenPreviewBox');
    if (tokenBox) tokenBox.classList.add('hidden');

    const heroText = document.querySelector('.hero h1');
    if (heroText) heroText.textContent = "Secure Faculty Control Center";

    const heroDesc = document.querySelector('.hero .lede');
    if (heroDesc) heroDesc.textContent = "Upload student rosters, seed questions, and monitor exam integrity.";

    const eyebrow = document.querySelector('.hero .eyebrow');
    if (eyebrow) eyebrow.textContent = "Faculty Admin Portal";
  }
};



el('signOutBtn').addEventListener('click', () => {
  state.token = '';
  state.role = window.electronAPI ? 'student' : 'faculty';
  state.name = '';
  state.rollNumber = '';
  state.securityArmed = false;
  localStorage.removeItem('securemlexam_token');
  localStorage.removeItem('securemlexam_role');
  localStorage.removeItem('securemlexam_name');
  localStorage.removeItem('securemlexam_rollnumber');

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
        const val = el('terminalInput').value;
        if (state.runWs && state.runWs.readyState === WebSocket.OPEN) {
          el('terminalOutput').textContent += val + '\n';
          el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
          state.runWs.send(JSON.stringify({
            type: 'input',
            data: val + '\n'
          }));
        }
        el('terminalInput').value = '';
      }
    });
  }
  
  if (loginForm.serverUrl) {
    loginForm.serverUrl.value = state.serverUrl;
  }
  
  await loadStatus();
  if (state.token) {
    connectWebSocket();
    if (state.role === 'student') {
      if (window.electronAPI) {
        window.electronAPI.requestFullscreen(true);
      }
      loadStudentExam().catch((error) => logEvent(error.message));
    } else {
      if (window.electronAPI) {
        window.electronAPI.requestFullscreen(false);
      }
      loadFacultyData().catch((error) => logEvent(error.message));
    }
  }
});