const DEMO_ROLL = 'DEMO'; // Special roll number — bypasses all security restrictions

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
  demoMode: false,  // true for DEMO roll — no restrictions
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
    let assignments = [];

    if (state.demoMode) {
      // Inject sample questions for every supported language
      examLabel.textContent = 'Demo Test Environment';
      state.questions = [
        { id: 'demo-py',    number: 1, title: 'Python',  prompt: 'Print "Hello from Python!" and show the sum of 1 to 10.' },
        { id: 'demo-java',  number: 2, title: 'Java',    prompt: 'Write a Java program that prints "Hello from Java!" and computes 5 factorial.' },
        { id: 'demo-c',     number: 3, title: 'C',       prompt: 'Write a C program that prints "Hello from C!" and shows the first 5 Fibonacci numbers.' },
        { id: 'demo-cpp',   number: 4, title: 'C++',     prompt: 'Write a C++ program that prints "Hello from C++!" and sorts an array of 5 numbers.' },
        { id: 'demo-r',     number: 5, title: 'R',       prompt: 'Write an R script that prints "Hello from R!" and computes mean of c(1,2,3,4,5).' },
        { id: 'demo-sql',   number: 6, title: 'MySQL',   prompt: 'Write a MySQL query: SELECT VERSION(); and SHOW DATABASES;' },
      ];
    } else {
      const res = await api(`/api/assignments?roll_no=${encodeURIComponent(state.rollNumber)}`);
      assignments = res.data || [];
      examLabel.textContent = `Assigned Lab Exam`;
      state.questions = assignments.map((a, idx) => ({
        id: a.id,
        number: idx + 1,
        title: `Question ${idx + 1}`,
        prompt: a.question_text
      })) || [];
    }

    state.drafts = {};
    state.activeQuestionIndex = 0;

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
    // Skipped in demo mode so the tester can freely interact with the system.
    if (window.electronAPI && !state.demoMode) {
      window.electronAPI.requestFullscreen(true);
      window.electronAPI.lockExamWindow();
    }

    logEvent(`Loaded exam with ${state.questions.length} questions.${state.demoMode ? ' [DEMO MODE — no restrictions]' : ''}`);

    // Arm security focus checks (skipped in demo mode)
    if (!state.demoMode) {
      setTimeout(() => {
        state.securityArmed = true;
        console.log('[ExamGuard] Security focus checks armed.');
      }, 2000);
    } else {
      console.log('[ExamGuard] DEMO MODE — security checks disabled.');
    }
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
        assignmentList.innerHTML = state.assignments.map((item) => `
          <div class="assignment-card" data-id="${item.id}" style="background: #ffffff; border: 1.5px solid #e4e4e7; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: all 0.2s ease;">
            <div style="font-weight: bold; color: #18181b; font-size: 1.05rem;">${item.subject.name}</div>
            <div style="font-size: 0.85rem; color: #71717a;">${item.subject.code} • Yr ${item.year} - Semester ${item.semester}</div>
            <div style="font-size: 0.85rem; color: #71717a;">Class: ${item.section}</div>
          </div>
        `).join('');

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

const loadExamsForAssignment = async (assignmentId) => {
  try {
    const examsRes = await api('/api/faculty/exams');
    const exams = (examsRes.data || []).filter(ex => ex.faculty_assignment_id === assignmentId);
    state.exams = exams;

    const examsList = el('facultyExamsList');
    if (examsList) {
      if (exams.length === 0) {
        examsList.innerHTML = `<p style="color: #71717a; font-size: 0.9rem; margin: 10px 0;">No exams created for this assignment yet.</p>`;
      } else {
        examsList.innerHTML = exams.map((exam) => {
          const dt = exam.created_at ? new Date(exam.created_at).toLocaleString() : 'N/A';
          return `
            <div style="background: #ffffff; border: 1.5px solid #e4e4e7; border-radius: 12px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div>
                <div style="font-weight: 600; color: #18181b;">${exam.title}</div>
                <div style="font-size: 0.8rem; color: #71717a; text-transform: capitalize;">${exam.status} • ${dt}</div>
              </div>
              <button class="secondary open-exam-btn" data-id="${exam.id}" style="padding: 6px 12px; font-size: 0.85rem;">Open</button>
            </div>
          `;
        }).join('');

        examsList.querySelectorAll('.open-exam-btn').forEach((btn) => {
          btn.addEventListener('click', () => loadExamDetails(btn.dataset.id));
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

    state.activeExamId = examId;

    const detailsSec = el('examDetailsSection');
    detailsSec.classList.remove('hidden');
    detailsSec.scrollIntoView({ behavior: 'smooth' });

    el('examDetailTitle').textContent = exam.title;
    el('examDetailMeta').innerHTML = `Subject: <strong>${exam.subject}</strong> | Class: Yr ${exam.year} / Sem ${exam.semester} / Sec ${exam.section} | Status: <strong style="text-transform: capitalize;">${exam.status}</strong>`;

    // Render action buttons based on status
    const actionsContainer = el('examDetailStatusActions');
    if (actionsContainer) {
      actionsContainer.innerHTML = `
        <button id="renameExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem;">Rename</button>
        ${exam.status === 'draft' ? `<button id="publishExamBtn" class="primary" style="padding: 6px 12px; font-size: 0.85rem; background: #2563eb !important; border-color: #2563eb !important;">Publish</button>` : ''}
        ${exam.status === 'published' ? `<button id="archiveExamBtn" class="secondary" style="padding: 6px 12px; font-size: 0.85rem; border-color: #71717a !important; color: #71717a !important;">Archive</button>` : ''}
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
        questionsList.innerHTML = questions.map((q) => `
          <div style="background: #ffffff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px; display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <div style="font-weight: bold; color: #18181b; font-size: 1rem;">Q${q.number} <span style="font-weight: 500; font-size: 0.85rem; color: #71717a; margin-left: 8px;">(${q.marks} marks)</span></div>
              <div style="color: #3f3f46; margin-top: 6px; font-size: 0.95rem; white-space: pre-wrap;">${q.text}</div>
            </div>
            ${examStatus === 'draft' ? `
              <div style="display: flex; gap: 8px; margin-left: 12px;">
                <button class="secondary edit-question-btn" data-id="${q.id}" data-num="${q.number}" data-marks="${q.marks}" data-text="${encodeURIComponent(q.text)}" style="padding: 4px 8px; font-size: 0.8rem;">Edit</button>
                <button class="secondary delete-question-btn" data-id="${q.id}" style="padding: 4px 8px; font-size: 0.8rem; border-color: #ef4444 !important; color: #ef4444 !important;">Delete</button>
              </div>
            ` : ''}
          </div>
        `).join('');

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
    const students = studentsRes.data || [];
    const select = el('assignStudentSelect');
    if (select) {
      if (students.length === 0) {
        select.innerHTML = `<option value="">No students in roster</option>`;
      } else {
        select.innerHTML = students.map((std) => `<option value="${std.roll_no}">${std.name} (${std.roll_no})</option>`).join('');
      }
    }
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
      facTable.innerHTML = facList.map((fac) => `
        <tr style="border-bottom: 1px solid #e4e4e7;">
          <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">${fac.name}</td>
          <td style="padding: 12px 12px; color: #52525b;">${fac.email}</td>
          <td style="padding: 12px 12px; text-align: center;">
            <button class="secondary delete-fac-btn" data-id="${fac.id}" style="padding: 6px 12px; font-size: 0.85rem; border-color: #ef4444 !important; color: #ef4444 !important; background: transparent; border: 1.5px solid #ef4444; border-radius: 8px; cursor: pointer; transition: all 0.2s ease;">Delete</button>
          </td>
        </tr>
      `).join('');

      facTable.querySelectorAll('.delete-fac-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          if (confirm('Delete this faculty login?')) {
            try {
              await api(`/api/admin/faculty/${e.target.dataset.id}`, { method: 'DELETE' });
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
        const sub = subList.find(s => s.id === item.subject_id) || { name: item.subject_id };
        return `
          <tr style="border-bottom: 1px solid #e4e4e7;">
            <td style="padding: 12px 12px; font-weight: 600; color: #18181b;">${fac.name}</td>
            <td style="padding: 12px 12px; color: #52525b;">${sub.name}</td>
            <td style="padding: 12px 12px; color: #52525b;">Yr ${item.year} / Sem ${item.semester} / Sec ${item.section}</td>
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

  } catch (err) {
    logEvent(`Failed to load admin data: ${err.message}`);
  }
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
      const rollNumber = formData.get('rollNumber');
      const name = formData.get('name');

      // ── Demo Mode ──────────────────────────────────────────────────────────
      // Roll number "DEMO" skips server assignment check and all security locks.
      const isDemo = rollNumber.trim().toUpperCase() === DEMO_ROLL;

      if (!isDemo) {
        const res = await api(`/api/assignments?roll_no=${encodeURIComponent(rollNumber)}`);
        if (!res.data || res.data.length === 0) {
          throw new Error('No assignments found for this roll number');
        }
      }

      data = {
        token: 'student_session',
        role: 'student',
        name: name || (isDemo ? 'Demo Tester' : 'Student'),
        rollNumber: rollNumber,
        demoMode: isDemo
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
    state.demoMode = !!data.demoMode;
    localStorage.setItem('securemlexam_token', state.token);
    localStorage.setItem('securemlexam_role',  state.role);
    localStorage.setItem('securemlexam_name',  state.name);
    localStorage.setItem('securemlexam_rollnumber', state.rollNumber);
    renderToken();
    setMode(state.role);
    updateGridLayout();
    connectWebSocket();
    logEvent(`Signed in as ${state.name || state.role}${state.demoMode ? ' [DEMO MODE]' : ''}`);

    if (state.demoMode) {
      // Show a visible banner so tester knows restrictions are off
      const banner = document.createElement('div');
      banner.id = 'demoBanner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#f59e0b;color:#000;text-align:center;font-weight:700;font-size:0.9rem;padding:6px;letter-spacing:0.05em;';
      banner.textContent = '⚠️  DEMO MODE — Security restrictions disabled. For testing only.';
      document.body.prepend(banner);
    }

    if (state.role === 'student') {
      if (window.electronAPI && !state.demoMode) window.electronAPI.requestFullscreen(true);
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






el('submitBtn').addEventListener('click', async () => {
  saveCurrentTabState();
  const btn = el('submitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  btn.style.opacity = '0.7';

  try {
    const data = await api('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignment_id: state.questionId || '',
        student_roll_no: state.rollNumber,
        response: codeEditor.value,
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
  state.runWs = true; // use as "running" flag

  term.textContent = `Running ${lang.toUpperCase()} code...\n`;
  term.style.color = '#a3e635';
  runBtn.textContent = 'Stop';
  runBtn.style.background = '#ef4444';
  runBtn.style.color = '#ffffff';
  runBtn.disabled = false;

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
        code: el('codeEditor').value,
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
    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
    cleanupRunState();
  });

  window.electronAPI.runCode(code, lang);
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
window.addEventListener('contextmenu', (e) => { if (state.role === 'student' && !state.demoMode) e.preventDefault(); });

// Block Copy, Cut, and Paste actions silently (no exam termination, just prevention)
const blockClipboard = (e) => {
  if (state.role === 'student' && state.token && !state.demoMode) {
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
      const year = el('assignYearInput').value.trim();
      const semester = el('assignSemesterInput').value.trim();
      const section = el('assignSectionInput').value.trim();

      if (!faculty_id || !subject_id || !year || !semester || !section) {
        alert('Please fill all assignment fields');
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
        await api('/api/faculty/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ faculty_assignment_id: state.activeAssignmentId, title })
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

      try {
        await api(`/api/faculty/papers/${state.activePaperId}/questions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questions: [{ number, text, marks }]
          })
        });
        logEvent(`Saved question ${number}`);
        el('qNumInput').value = '';
        el('qMarksInput').value = '';
        el('qTextInput').value = '';
        const res = await api(`/api/faculty/exams/${state.activeExamId}`);
        const exam = res.data.exam;
        await loadPaperDetails(state.activePaperId, exam.status);
        await loadExamDetails(state.activeExamId);
      } catch (err) {
        alert('Failed to save question: ' + err.message);
      }
    });
  }

  // Faculty: Assign Paper Set to Student
  if (el('assignSetToStudentBtn')) {
    el('assignSetToStudentBtn').addEventListener('click', async () => {
      const roll_no = el('assignStudentSelect').value;
      if (!roll_no) {
        alert('Please select a student');
        return;
      }
      try {
        await api(`/api/faculty/exams/${state.activeExamId}/assign-paper`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_roll_no: roll_no, paper_id: state.activePaperId })
        });
        logEvent(`Assigned paper set to student ${roll_no}`);
        alert(`Successfully assigned set to student ${roll_no}.`);
      } catch (err) {
        alert('Failed to assign set: ' + err.message);
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