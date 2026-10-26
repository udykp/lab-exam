// GUI program detection.
//
// GUI programs (Java Swing/AWT, Python Tkinter/Qt/wx, C/C++ GTK/Qt/GLUT/SDL)
// are run directly on the locked kiosk session display as REAL native windows
// — see src/runner.js (runs the code with the inherited DISPLAY) and
// src/kiosk.js (enterGuiMode/exitGuiMode step the exam window aside). No virtual
// display, VNC server, or WebSocket bridge is involved anymore.

function isGuiCode(language, code) {
  if (!code) return false;
  const lang = (language || '').toLowerCase();

  if (lang.includes('java')) {
    return /import\s+(javax\.swing|java\.awt)|extends\s+(JFrame|Frame|JPanel|Applet|JApplet|JDialog|Window)|new\s+(JFrame|Frame)/i.test(code);
  }
  if (lang.includes('python')) {
    return /import\s+(tkinter|PyQt5|PyQt6|PySide2|PySide6|wx)|from\s+(tkinter|PyQt5|PyQt6|PySide2|PySide6|wx)/i.test(code);
  }
  if (lang === 'c' || lang === 'cpp') {
    return /<gtk\/gtk\.h>|<QApplication>|<GL\/glut\.h>|<SDL2\/SDL\.h>/i.test(code);
  }
  return false;
}

module.exports = {
  isGuiCode
};
