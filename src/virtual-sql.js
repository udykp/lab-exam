const { spawn, exec } = require('child_process');

let currentActiveSqlDatabase = 'labexam';
const virtualDatabases = new Set(['labexam']);

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'create', 'table', 'drop', 'alter', 'show', 'use', 'database', 'databases', 'tables',
  'if', 'exists', 'not', 'null', 'primary', 'key', 'foreign', 'references', 'join',
  'left', 'right', 'inner', 'outer', 'cross', 'natural', 'straight_join', 'on', 'and', 'or',
  'as', 'group', 'by', 'order', 'having', 'limit', 'int', 'integer', 'varchar', 'char',
  'text', 'date', 'datetime', 'decimal', 'numeric', 'float', 'double', 'default',
  'auto_increment', 'unique', 'check', 'like', 'in', 'is', 'between', 'asc', 'desc',
  'union', 'all', 'distinct', 'count', 'sum', 'avg', 'min', 'max', 'view', 'index',
  'constraint', 'cascade', 'truncate', 'describe', 'desc', 'add', 'column', 'modify',
  'change', 'rename', 'to', 'with', 'case', 'when', 'then', 'else', 'end', 'dual'
]);

function isVirtualDatabase(db) {
  if (!db) return false;
  const lower = db.toLowerCase();
  if (lower === 'labexam' || lower === 'information_schema' || lower === 'performance_schema' || lower === 'mysql' || lower === 'sys') {
    return false;
  }
  for (const v of virtualDatabases) {
    if (v.toLowerCase() === lower && lower !== 'labexam') return true;
  }
  return false;
}

function removeVirtualDatabase(db) {
  if (!db) return;
  const lower = db.toLowerCase();
  for (const v of virtualDatabases) {
    if (v.toLowerCase() === lower) {
      virtualDatabases.delete(v);
    }
  }
}

function rewriteSqlForVirtualDb(sql, activeDb) {
  if (!sql) return sql;
  const db = (activeDb || currentActiveSqlDatabase || 'labexam').toLowerCase();
  let transformed = sql;

  // 1. Rewrite explicit virtual database references: e.g. uday.student -> uday__student
  virtualDatabases.forEach(vdb => {
    if (vdb.toLowerCase() === 'labexam') return;
    const vdbRegex = new RegExp(`\\b${vdb}\\s*\\.\\s*([a-zA-Z0-9_$]+)`, 'gi');
    transformed = transformed.replace(vdbRegex, `${vdb}__$1`);
  });

  if (!isVirtualDatabase(db)) {
    return transformed;
  }

  const prefix = `${db}__`;

  // 2. SHOW TABLES
  if (/^\s*SHOW\s+TABLES\b/i.test(transformed.trim())) {
    return `SHOW TABLES LIKE '${prefix}%';`;
  }

  // 3. CREATE TABLE [IF NOT EXISTS] tablename
  transformed = transformed.replace(
    /(\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 4. DROP TABLE [IF EXISTS] tablename
  transformed = transformed.replace(
    /(\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 5. ALTER TABLE tablename
  transformed = transformed.replace(
    /(\bALTER\s+TABLE\s+)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 6. TRUNCATE [TABLE] tablename
  transformed = transformed.replace(
    /(\bTRUNCATE\s+(?:TABLE\s+)?)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 7. DESCRIBE / DESC / SHOW CREATE TABLE tablename
  transformed = transformed.replace(
    /(\b(?:DESCRIBE|DESC|SHOW\s+CREATE\s+TABLE)\s+)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 8. INSERT INTO tablename
  transformed = transformed.replace(
    /(\bINSERT\s+(?:IGNORE\s+)?INTO\s+)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 9. UPDATE tablename SET ...
  transformed = transformed.replace(
    /(\bUPDATE\s+)([`"']?)([a-zA-Z0-9_$]+)\2(\s+SET\b)/gi,
    (m, pre, q, tbl, post) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}${post}`;
    }
  );

  // 10. DELETE FROM tablename
  transformed = transformed.replace(
    /(\bDELETE\s+FROM\s+)([`"']?)([a-zA-Z0-9_$]+)\2/gi,
    (m, pre, q, tbl) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}`;
    }
  );

  // 11. FOREIGN KEY REFERENCES tablename(col)
  transformed = transformed.replace(
    /(\bREFERENCES\s+)([`"']?)([a-zA-Z0-9_$]+)\2(\s*\()/gi,
    (m, pre, q, tbl, post) => {
      if (tbl.startsWith(prefix) || tbl.includes('__')) return m;
      return `${pre}${prefix}${tbl}${post}`;
    }
  );

  // 12. FROM and JOIN clauses with automatic aliasing
  transformed = transformed.replace(
    /\b(FROM|JOIN|STRAIGHT_JOIN)\s+([a-zA-Z0-9_$`",\s]+?)(?=\s+(?:WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION|PROCEDURE|INTO|FOR\s+UPDATE|LOCK|ON|USING|NATURAL|CROSS|INNER|LEFT|RIGHT|FULL|JOIN|STRAIGHT_JOIN)\b|;|\)|$)/gi,
    (full, kw, tablesStr) => {
      const parts = tablesStr.split(',');
      const transformedParts = parts.map(part => {
        return part.replace(/^\s*([`"']?)([a-zA-Z0-9_$]+)\1(?=[\s,]|$)(?:\s+(?:AS\s+)?([`"']?)([a-zA-Z0-9_$]+)\3)?/i, (match, q, tbl, asQ, userAlias) => {
          if (SQL_KEYWORDS.has(tbl.toLowerCase()) || tbl.startsWith(prefix) || tbl.includes('__')) {
            return match;
          }
          const leadingSpaces = match.match(/^\s*/)[0];
          const quote = q || '';
          if (userAlias && !SQL_KEYWORDS.has(userAlias.toLowerCase())) {
            return `${leadingSpaces}${quote}${prefix}${tbl}${quote} AS ${userAlias}`;
          }
          return `${leadingSpaces}${quote}${prefix}${tbl}${quote} AS ${quote}${tbl}${quote}`;
        });
      });
      return `${kw} ${transformedParts.join(',')}`;
    }
  );

  return transformed;
}

function formatVirtualShowTables(output, activeDb) {
  if (!output || output.includes('Empty set')) {
    return 'Empty set (0.00 sec)';
  }
  const prefix = `${activeDb.toLowerCase()}__`;
  const lines = output.split('\n');
  const tableLines = lines.filter(l => l.startsWith('|') && !l.includes('---'));

  const tableNames = [];
  for (let i = 1; i < tableLines.length; i++) {
    const match = tableLines[i].match(/\|\s*([^|\s]+)\s*\|/);
    if (match) {
      let tbl = match[1].trim();
      if (tbl.toLowerCase().startsWith(prefix)) {
        tbl = tbl.slice(prefix.length);
      }
      tableNames.push(tbl);
    }
  }

  if (tableNames.length === 0) {
    return 'Empty set (0.00 sec)';
  }

  const colHeader = `Tables_in_${activeDb}`;
  let maxLen = colHeader.length;
  for (const name of tableNames) {
    if (name.length > maxLen) maxLen = name.length;
  }

  const border = '+' + '-'.repeat(maxLen + 2) + '+';
  const header = '| ' + colHeader.padEnd(maxLen) + ' |';
  const outLines = [border, header, border];
  for (const name of tableNames) {
    outLines.push('| ' + name.padEnd(maxLen) + ' |');
  }
  outLines.push(border);
  return outLines.join('\n');
}

function formatVirtualShowDatabases(output) {
  const dbMap = new Map();
  dbMap.set('information_schema', 'information_schema');
  dbMap.set('labexam', 'labexam');
  dbMap.set('performance_schema', 'performance_schema');

  if (output) {
    const lines = output.split('\n');
    for (const l of lines) {
      const match = l.match(/\|\s*([a-zA-Z0-9_$]+)\s*\|/);
      if (match) {
        const name = match[1].trim();
        if (name.toLowerCase() !== 'database') {
          dbMap.set(name.toLowerCase(), name);
        }
      }
    }
  }

  // Deduplicate and append virtual databases
  virtualDatabases.forEach(v => {
    if (v && !dbMap.has(v.toLowerCase())) {
      dbMap.set(v.toLowerCase(), v);
    }
  });

  const sortedDbs = Array.from(dbMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const colHeader = 'Database';
  let maxLen = colHeader.length;
  for (const db of sortedDbs) {
    if (db.length > maxLen) maxLen = db.length;
  }

  const border = '+' + '-'.repeat(maxLen + 2) + '+';
  const header = '| ' + colHeader.padEnd(maxLen) + ' |';
  const outLines = [border, header, border];
  for (const db of sortedDbs) {
    outLines.push('| ' + db.padEnd(maxLen) + ' |');
  }
  outLines.push(border);
  return outLines.join('\n');
}

async function handleRunSqlCell(event, { query, database }) {
  if (!query || !query.trim()) {
    return { success: true, output: '', executionTimeMs: 0, activeDatabase: currentActiveSqlDatabase };
  }

  const trimmedQuery = query.trim();
  const startTime = Date.now();

  // Standalone USE <db>
  const standaloneUseMatch = trimmedQuery.match(/^USE\s+[`"']?([a-zA-Z0-9_$]+)[`"']?;?$/i);
  if (standaloneUseMatch) {
    const targetDb = standaloneUseMatch[1];
    currentActiveSqlDatabase = targetDb;
    return {
      success: true,
      output: 'Database changed',
      activeDatabase: currentActiveSqlDatabase,
      executionTimeMs: Date.now() - startTime
    };
  }

  // Standalone SHOW DATABASES
  if (/^SHOW\s+DATABASES;?$/i.test(trimmedQuery)) {
    return new Promise((resolve) => {
      exec('mysql -u exam_user -pexam_password --table -e "SHOW DATABASES;"', (err, stdout) => {
        const formatted = formatVirtualShowDatabases(stdout);
        resolve({
          success: true,
          output: formatted,
          activeDatabase: currentActiveSqlDatabase,
          executionTimeMs: Date.now() - startTime
        });
      });
    });
  }

  // Standalone CREATE DATABASE [IF NOT EXISTS] <name>
  const standaloneCreateDbMatch = trimmedQuery.match(/^CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"']?([a-zA-Z0-9_$]+)[`"']?;?$/i);
  if (standaloneCreateDbMatch) {
    const dbName = standaloneCreateDbMatch[1];
    return new Promise((resolve) => {
      exec(`mysql -u exam_user -pexam_password -e "${trimmedQuery.replace(/"/g, '\\"')}"`, (err, stdout, stderr) => {
        const duration = Date.now() - startTime;
        if (!err) {
          removeVirtualDatabase(dbName);
          resolve({
            success: true,
            output: stdout.trim() || 'Query OK, 1 row affected (0.01 sec)',
            activeDatabase: currentActiveSqlDatabase,
            executionTimeMs: duration
          });
        } else {
          if (stderr.includes('1044') || /access denied/i.test(stderr)) {
            virtualDatabases.add(dbName);
            resolve({
              success: true,
              output: 'Query OK, 1 row affected (0.01 sec)',
              activeDatabase: currentActiveSqlDatabase,
              executionTimeMs: duration
            });
          } else {
            const cleanedStderr = stderr.replace(/mysql: \[Warning\] Using a password on the command line interface can be insecure\.\r?\n?/g, '').trim();
            resolve({
              success: false,
              error: cleanedStderr || err.message,
              activeDatabase: currentActiveSqlDatabase,
              executionTimeMs: duration
            });
          }
        }
      });
    });
  }

  // Standalone DROP DATABASE [IF EXISTS] <name>
  const standaloneDropDbMatch = trimmedQuery.match(/^DROP\s+DATABASE(?:\s+IF\s+EXISTS)?\s+[`"']?([a-zA-Z0-9_$]+)[`"']?;?$/i);
  if (standaloneDropDbMatch) {
    const dbName = standaloneDropDbMatch[1];
    const duration = Date.now() - startTime;
    if (isVirtualDatabase(dbName)) {
      return new Promise((resolve) => {
        exec(`mysql -u exam_user -pexam_password labexam -N -B -e "SELECT table_name FROM information_schema.tables WHERE table_schema = 'labexam' AND table_name LIKE '${dbName.toLowerCase()}__%';"`, async (err, stdout) => {
          if (stdout && stdout.trim()) {
            const tbls = stdout.trim().split(/\s+/).join(', ');
            await new Promise(r => exec(`mysql -u exam_user -pexam_password labexam -e "DROP TABLE IF EXISTS ${tbls};"`, r));
          }
          removeVirtualDatabase(dbName);
          if (currentActiveSqlDatabase.toLowerCase() === dbName.toLowerCase()) {
            currentActiveSqlDatabase = 'labexam';
          }
          resolve({
            success: true,
            output: 'Query OK, 0 rows affected (0.01 sec)',
            activeDatabase: currentActiveSqlDatabase,
            executionTimeMs: duration
          });
        });
      });
    }
  }

  // Multi-statement queries or general SQL
  const useMatches = [...query.matchAll(/(?:^|[\s;])USE\s+[`"']?([a-zA-Z0-9_$]+)[`"']?/gi)];
  let switchedToDb = null;
  if (useMatches.length > 0) {
    switchedToDb = useMatches[useMatches.length - 1][1];
  }

  let targetDb = (database && typeof database === 'string' && database.trim())
    ? database.trim()
    : (switchedToDb || currentActiveSqlDatabase || 'labexam');

  const effectiveActiveDb = switchedToDb || targetDb;
  const isTargetVirtual = isVirtualDatabase(effectiveActiveDb);

  let queryToExecute = query;
  let dbToConnect = 'labexam';

  if (isTargetVirtual) {
    queryToExecute = queryToExecute.replace(/(?:^|[\s;])CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"']?[a-zA-Z0-9_$]+[`"']?;?/gi, ';');
    queryToExecute = queryToExecute.replace(/(?:^|[\s;])USE\s+[`"']?[a-zA-Z0-9_$]+[`"']?;?/gi, ';');
    queryToExecute = rewriteSqlForVirtualDb(queryToExecute, effectiveActiveDb);
    dbToConnect = 'labexam';
  } else {
    const hasCreateDb = /(?:^|[\s;])CREATE\s+DATABASE\s+/i.test(query);
    dbToConnect = hasCreateDb ? 'labexam' : targetDb;
  }

  const isShowTables = /^\s*SHOW\s+TABLES/i.test(query.trim());

  return new Promise((resolve) => {
    const proc = spawn('mysql', [
      '-u', 'exam_user',
      '-pexam_password',
      '-D', dbToConnect,
      '--table',
      '-e', queryToExecute
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      if (code === 0) {
        if (switchedToDb) {
          currentActiveSqlDatabase = switchedToDb;
        } else if (targetDb) {
          currentActiveSqlDatabase = targetDb;
        }

        let cleanStdout = stdout.trim();
        if (isShowTables && isVirtualDatabase(currentActiveSqlDatabase)) {
          cleanStdout = formatVirtualShowTables(stdout, currentActiveSqlDatabase);
        }

        resolve({
          success: true,
          output: cleanStdout,
          activeDatabase: currentActiveSqlDatabase,
          executionTimeMs: durationMs
        });
      } else {
        const cleanedStderr = stderr.replace(/mysql: \[Warning\] Using a password on the command line interface can be insecure\.\r?\n?/g, '').trim();

        // If native execution failed with ERROR 1044 Access Denied, transparently self-heal via virtual engine
        if (cleanedStderr.includes('1044') || /access denied/i.test(cleanedStderr)) {
          const matchedDb = (cleanedStderr.match(/database '([a-zA-Z0-9_$]+)'/i) || [])[1] || effectiveActiveDb;
          if (matchedDb && matchedDb.toLowerCase() !== 'labexam') {
            virtualDatabases.add(matchedDb);
            currentActiveSqlDatabase = matchedDb;

            let retryQuery = query.replace(/(?:^|[\s;])CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"']?[a-zA-Z0-9_$]+[`"']?;?/gi, ';')
                                  .replace(/(?:^|[\s;])USE\s+[`"']?[a-zA-Z0-9_$]+[`"']?;?/gi, ';');
            retryQuery = rewriteSqlForVirtualDb(retryQuery, matchedDb);

            if (!retryQuery.replace(/[;\s]/g, '')) {
              return resolve({
                success: true,
                output: 'Query OK, 1 row affected (0.01 sec)',
                activeDatabase: currentActiveSqlDatabase,
                executionTimeMs: durationMs
              });
            }

            const retryProc = spawn('mysql', [
              '-u', 'exam_user',
              '-pexam_password',
              '-D', 'labexam',
              '--table',
              '-e', retryQuery
            ]);

            let retryStdout = '';
            let retryStderr = '';
            retryProc.stdout.on('data', (d) => { retryStdout += d.toString(); });
            retryProc.stderr.on('data', (d) => { retryStderr += d.toString(); });
            retryProc.on('close', (retCode) => {
              if (retCode === 0) {
                let out = retryStdout.trim();
                if (isShowTables) out = formatVirtualShowTables(retryStdout, currentActiveSqlDatabase);
                return resolve({
                  success: true,
                  output: out,
                  activeDatabase: currentActiveSqlDatabase,
                  executionTimeMs: Date.now() - startTime
                });
              } else {
                const retryCleanErr = retryStderr.replace(/mysql: \[Warning\] Using a password on the command line interface can be insecure\.\r?\n?/g, '').trim();
                return resolve({
                  success: false,
                  error: retryCleanErr || 'SQL execution failed',
                  output: retryStdout.trim(),
                  activeDatabase: currentActiveSqlDatabase,
                  executionTimeMs: Date.now() - startTime
                });
              }
            });
            return;
          }
        }

        resolve({
          success: false,
          error: cleanedStderr || 'SQL execution failed',
          output: stdout.trim(),
          activeDatabase: currentActiveSqlDatabase,
          executionTimeMs: durationMs
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        activeDatabase: currentActiveSqlDatabase,
        executionTimeMs: Date.now() - startTime
      });
    });
  });
}

async function handleResetSqlDatabase() {
  currentActiveSqlDatabase = 'labexam';
  virtualDatabases.clear();
  virtualDatabases.add('labexam');

  return new Promise((resolve) => {
    const runSql = (cmd, query) => {
      return new Promise((res) => {
        exec(`${cmd} -e "${query}"`, (err, stdout, stderr) => {
          res({ success: !err, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
        });
      });
    };

    (async () => {
      try {
        await runSql('sudo -n mysql', "DROP DATABASE IF EXISTS labexam; CREATE DATABASE labexam; GRANT ALL PRIVILEGES ON *.* TO 'exam_user'@'localhost'; FLUSH PRIVILEGES;");

        const customDbsRes = await runSql(
          'mysql -u exam_user -pexam_password -N -B',
          "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys', 'labexam');"
        );

        if (customDbsRes.stdout) {
          const dbs = customDbsRes.stdout.split(/\r?\n/).map(s => s.trim().replace(/[^a-zA-Z0-9_]/g, '')).filter(Boolean);
          for (const db of dbs) {
            await runSql('mysql -u exam_user -pexam_password', `DROP DATABASE IF EXISTS ${db};`);
            await runSql('sudo -n mysql', `DROP DATABASE IF EXISTS ${db};`);
          }
        }

        await runSql('mysql -u exam_user -pexam_password', "DROP DATABASE IF EXISTS labexam; CREATE DATABASE labexam;");

        const tablesRes = await runSql(
          'mysql -u exam_user -pexam_password labexam -N -B',
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'labexam';"
        );

        if (tablesRes.stdout) {
          const tables = tablesRes.stdout.split(/\r?\n/).map(s => s.trim().replace(/[^a-zA-Z0-9_]/g, '')).filter(Boolean);
          if (tables.length > 0) {
            const dropTablesList = tables.join(', ');
            await runSql('mysql -u exam_user -pexam_password labexam', `SET FOREIGN_KEY_CHECKS = 0; DROP TABLE IF EXISTS ${dropTablesList}; SET FOREIGN_KEY_CHECKS = 1;`);
          }
        }

        resolve({ success: true, message: 'Database and custom tables reset successfully' });
      } catch (err) {
        resolve({ success: false, error: err.message });
      }
    })();
  });
}

function registerVirtualSqlIPC(ipcMain) {
  ipcMain.handle('run-sql-cell', (event, payload) => handleRunSqlCell(event, payload));
  ipcMain.handle('reset-sql-database', () => handleResetSqlDatabase());
}

module.exports = {
  handleRunSqlCell,
  handleResetSqlDatabase,
  registerVirtualSqlIPC
};
