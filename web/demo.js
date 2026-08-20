// Helper: Get element by ID
const el = (id) => document.getElementById(id);

// State management for local demo environment
const state = {
  demoMode: true,
  questions: [],
  activeQuestionIndex: 0,
  drafts: {},
  runWs: null
};

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
    state.drafts[activeQ.id] = {
      code: getEditorValue(),
      language: el('languageSelect').value,
      terminal: el('terminalOutput').textContent,
      terminalColor: el('terminalOutput').style.color,
    };
  }
};

// Load tab state into UI
const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  el('questionLabel').textContent = `Question ${q.number || (index + 1)}`;
  el('questionTitle').textContent = q.title || `Program ${index + 1}`;
  el('questionPrompt').textContent = q.prompt || 'Your question prompt will appear here.';

  const attachDiv = el('studentAttachments');
  if (attachDiv) {
    if (q.localFiles && q.localFiles.length > 0) {
      attachDiv.innerHTML = q.localFiles.map(file => {
        const lower = file.filename.toLowerCase();
        const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp');
        if (isImage) {
          return `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; margin-bottom: 8px;">
              <img class="student-attachment-image" src="${file.dataUrl}" alt="${file.filename}" style="max-width: 100%; max-height: 350px; border-radius: 8px; border: 1.5px solid #e4e4e7; object-fit: contain; background: #f8fafc; cursor: zoom-in;" />
            </div>
          `;
        }
        return `<a href="${file.dataUrl}" download="${file.filename}" style="font-size: 0.85rem; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">📎 ${file.filename}</a>`;
      }).join('');

      attachDiv.querySelectorAll('.student-attachment-image').forEach(img => {
        img.addEventListener('click', () => openImageLightbox(img.src));
      });
    } else {
      attachDiv.innerHTML = '';
    }
  }

  const draft = state.drafts[q.id] || {
    code: '',
    language: q.language || 'python',
    terminal: 'Terminal ready. Write code and click Run Code.',
    terminalColor: '#10b981',
  };

  setEditorValue(draft.code);
  el('languageSelect').value = draft.language;
  setEditorLanguage(draft.language);
  el('terminalOutput').textContent = draft.terminal;
  el('terminalOutput').style.color = draft.terminalColor;

  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });

  el('demoQTitle').value = q.title || '';
  el('demoQPrompt').value = q.prompt || '';
  el('demoQFiles').value = '';
};

// Render program tab bar
const renderTabs = () => {
  const tabsContainer = el('studentTabs');
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

      if (state.questions.length > 0) {
        loadTabState(state.activeQuestionIndex);
      } else {
        el('activeQuestionCard').classList.add('hidden');
        el('editorArea').classList.add('hidden');
      }
      renderTabs();
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', (e) => {
      if (e.target.textContent === '✕') return;
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
    addBtn.addEventListener('click', () => {
      const nextQuestionNumber = state.questions.length + 1;
      const newQ = {
        id: `demo-q-${Date.now()}`,
        number: nextQuestionNumber,
        title: `Program ${nextQuestionNumber}`,
        prompt: `Write your instructions here...`,
        localFiles: []
      };
      saveCurrentTabState();
      state.questions.push(newQ);
      state.drafts[newQ.id] = {
        code: '',
        language: 'python',
        terminal: 'Terminal ready. Write code and click Run Code.',
        terminalColor: '#10b981',
      };
      state.activeQuestionIndex = state.questions.length - 1;
      loadTabState(state.activeQuestionIndex);
      el('activeQuestionCard').classList.remove('hidden');
      el('editorArea').classList.remove('hidden');
      renderTabs();
    });
    tabsContainer.appendChild(addBtn);
  }
};

// Lightbox image viewer controllers
const openImageLightbox = (src) => {
  el('lightboxImage').src = src;
  el('lightboxDownloadBtn').href = src;
  el('imageLightboxModal').classList.remove('hidden');
};

el('closeLightboxBtn').addEventListener('click', () => {
  el('imageLightboxModal').classList.add('hidden');
  el('lightboxImage').src = '';
});

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

// Initialize Monaco Editor
if (typeof require !== 'undefined') {
  require(['vs/editor/editor.main'], function () {
    const container = el('codeEditor');
    if (container) {
      monacoEditorInstance = monaco.editor.create(container, {
        value: pendingEditorValue || '',
        language: 'python',
        theme: 'vs',
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

// Track language selection changes
const languageSelect = el('languageSelect');
if (languageSelect) {
  languageSelect.addEventListener('change', (e) => {
    const lang = e.target.value;
    setEditorLanguage(lang);
    if (state.questions.length > 0) {
      const q = state.questions[state.activeQuestionIndex];
      if (q && state.drafts[q.id]) {
        state.drafts[q.id].language = lang;
      }
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
      
      splitter.style.background = '#cbd5e1';
      
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
        splitter.style.background = '#f4f4f5';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    splitter.addEventListener('mouseenter', () => {
      splitter.style.background = '#e2e8f0';
    });
    splitter.addEventListener('mouseleave', () => {
      if (splitter.style.background !== 'rgb(203, 213, 225)') {
        splitter.style.background = '#f4f4f5';
      }
    });
  }

  // Tab Switching between Console and Plots
  const tabConsoleBtn = el('tabConsoleBtn');
  const tabPlotsBtn = el('tabPlotsBtn');
  const consoleContainer = el('terminalOutputContainer');
  const plotsContainer = el('plotsTabContainer');
  const plotsBadge = el('plotsBadge');
  const outputsContainer = el('outputsContainer');

  if (tabConsoleBtn && tabPlotsBtn && consoleContainer && plotsContainer) {
    tabConsoleBtn.addEventListener('click', () => {
      tabConsoleBtn.classList.add('active');
      tabConsoleBtn.style.borderBottom = '3px solid #27272a';
      tabConsoleBtn.style.color = '#27272a';
      
      tabPlotsBtn.classList.remove('active');
      tabPlotsBtn.style.borderBottom = '3px solid transparent';
      tabPlotsBtn.style.color = '#71717a';
      
      consoleContainer.classList.remove('hidden');
      plotsContainer.classList.add('hidden');
    });

    tabPlotsBtn.addEventListener('click', () => {
      tabPlotsBtn.classList.add('active');
      tabPlotsBtn.style.borderBottom = '3px solid #27272a';
      tabPlotsBtn.style.color = '#27272a';
      
      tabConsoleBtn.classList.remove('active');
      tabConsoleBtn.style.borderBottom = '3px solid transparent';
      tabConsoleBtn.style.color = '#71717a';
      
      plotsContainer.classList.remove('hidden');
      consoleContainer.classList.add('hidden');
      
      // Hide red badge when viewed
      if (plotsBadge) plotsBadge.style.display = 'none';
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
el('clearTerminalBtn').addEventListener('click', () => {
  el('terminalOutput').textContent = '';
});

// Stdin input piping
el('terminalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const val = el('terminalInput').value.trim();
    if (!val) return;
    
    if (state.runWs && window.electronAPI) {
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

// Apply changes in Demo Question Builder
el('applyDemoQBtn').addEventListener('click', async () => {
  const btn = el('applyDemoQBtn');
  const originalText = btn.textContent;
  const originalBg = btn.style.background;
  const originalColor = btn.style.color;

  const q = state.questions[state.activeQuestionIndex];
  if (!q) return;

  const newTitle = el('demoQTitle').value.trim();
  const newPrompt = el('demoQPrompt').value.trim();

  if (!newTitle) {
    btn.disabled = true;
    btn.textContent = '✖ Title Required';
    btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = originalBg;
      btn.style.color = originalColor;
      btn.disabled = false;
    }, 2500);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Applying...';

  q.title = newTitle;
  q.prompt = newPrompt;

  const fileInput = el('demoQFiles');
  if (fileInput && fileInput.files.length > 0) {
    const localFiles = [];
    const readPromises = Array.from(fileInput.files).map(file => {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64Data = e.target.result.split(',')[1];
          localFiles.push({
            filename: file.name,
            content: base64Data,
            dataUrl: e.target.result
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    });
    await Promise.all(readPromises);
    q.localFiles = localFiles;
  }

  loadTabState(state.activeQuestionIndex);
  
  btn.textContent = '✔ Question Updated!';
  btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  btn.style.color = '#ffffff';
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = originalBg;
    btn.style.color = originalColor;
    btn.disabled = false;
  }, 2500);
});

// Run Code logic
el('runCodeBtn').addEventListener('click', () => {
  const code = getEditorValue();
  const term = el('terminalOutput');
  const runBtn = el('runCodeBtn');
  const lang = el('languageSelect').value;

  if (state.runWs) {
    if (window.electronAPI) {
      window.electronAPI.stopCode();
    }
    state.runWs = null;
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

  el('terminalInput').value = '';
  el('terminalInput').focus();

  const cleanupRunState = () => {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Code';
    runBtn.style.removeProperty('background');
    runBtn.style.removeProperty('color');
    state.runWs = null;
    window.electronAPI.removeCodeListeners();
  };

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

    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
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

// Submit Solution (local feedback, no server request)
el('submitBtn').addEventListener('click', () => {
  const btn = el('submitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  setTimeout(() => {
    btn.textContent = '✔ Submitted successfully!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 3000);
  }, 1000);
});

// Save locally
el('saveLocalBtn').addEventListener('click', async () => {
  const btn = el('saveLocalBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const q = state.questions[state.activeQuestionIndex];
  const activeTitle = q ? q.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'untitled';
  const folderName = `SecureLab_Saved_Code/${activeTitle}`;
  const lang = el('languageSelect').value;
  const ext = lang === 'python' ? 'py' : lang === 'r' ? 'R' : lang === 'mysql' ? 'sql' : lang;
  const filename = `${activeTitle}.${ext}`;
  const code = getEditorValue();

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

    btn.textContent = '✔ Saved!';
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
});

// Exit button
el('exitDemoBtn').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Window controls listeners
if (window.electronAPI) {
  let isFullscreen = false;

  el('demoMinimizeBtn').addEventListener('click', () => {
    window.electronAPI.minimizeApp();
  });

  el('demoFullscreenBtn').addEventListener('click', () => {
    isFullscreen = !isFullscreen;
    window.electronAPI.requestFullscreen(isFullscreen);
  });

  el('demoCloseBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to close SecureLab? Any unsaved changes will be lost.')) {
      window.electronAPI.exitApp();
    }
  });
}

// Initialize with tab setup
renderTabs();
