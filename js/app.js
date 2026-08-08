(function () {
  'use strict';

  var APP_ID = 'org.webosbrew.keyreplacer';
  var APP_VERSION_FALLBACK = '0.9.0';
  var APP_DIR = '/media/developer/apps/usr/palm/applications/' + APP_ID;
  var CONFIG_PATH = '/var/lib/webosbrew/remapper_config.json';
  var STARTUP_PATH = '/var/lib/webosbrew/startup.sh';
  var DAEMON_PATH = '/var/lib/webosbrew/key_redirector.sh';
  var DAEMON_LOG = '/var/lib/webosbrew/key_redirector.log';
  var STARTUP_MARKER_BEGIN = '# BEGIN org.webosbrew.keyreplacer';
  var STARTUP_MARKER_END = '# END org.webosbrew.keyreplacer';
  var LUNA_TIMEOUT_MS = 20000;

  var KEY_DEFS = [
    {
      key: 'netflix',
      label: 'Netflix Key',
      matchIds: ['netflix', 'com.webos.app.netflix', 'com.netflix.ninja']
    },
    {
      key: 'amazon',
      label: 'Prime Video Key',
      matchIds: ['amazon', 'com.webos.app.amazon', 'amazon.prime']
    },
    {
      key: 'disney',
      label: 'Disney+ Key',
      matchIds: ['com.disney.disneyplus-prod', 'disneyplus', 'com.webos.app.disneyplus']
    },
    {
      key: 'rakuten',
      label: 'Rakuten TV Key',
      matchIds: ['ui30', 'rakutentv', 'com.rakuten.tv']
    },
    {
      key: 'lgchannels',
      label: 'LG Channels Key',
      matchIds: ['com.webos.app.lgchannels']
    },
    {
      key: 'alexa',
      label: 'Alexa / Voice Key',
      matchIds: ['amazon.alexa.view']
    }
  ];

  var HDMI_OPTIONS = [
    { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
    { id: 'com.webos.app.hdmi2', title: 'HDMI 2' },
    { id: 'com.webos.app.hdmi3', title: 'HDMI 3' },
    { id: 'com.webos.app.hdmi4', title: 'HDMI 4' }
  ];

  var els = {
    statusBanner: document.getElementById('statusBanner'),
    enabledToggle: document.getElementById('enabledToggle'),
    enabledLabel: document.getElementById('enabledLabel'),
    btnSave: document.getElementById('btnSave'),
    btnReload: document.getElementById('btnReload'),
    message: document.getElementById('message'),
    appVersion: document.getElementById('appVersion'),
    selects: Array.prototype.slice.call(document.querySelectorAll('.mapping-select'))
  };

  var state = {
    ready: false,
    rooted: false,
    apps: [],
    config: defaultConfig()
  };

  function setAppVersionLabel(version) {
    if (!els.appVersion) {
      return;
    }
    els.appVersion.textContent = 'v' + String(version || APP_VERSION_FALLBACK);
  }

  function loadAppVersion() {
    setAppVersionLabel(APP_VERSION_FALLBACK);
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'appinfo.json', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) {
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var info = JSON.parse(xhr.responseText);
            if (info && info.version) {
              setAppVersionLabel(info.version);
            }
          } catch (err) {
            /* keep fallback */
          }
        }
      };
      xhr.send(null);
    } catch (err) {
      /* keep fallback */
    }
  }

  function defaultConfig() {
    var mappings = {};
    KEY_DEFS.forEach(function (def) {
      mappings[def.key] = 'none';
    });
    return { enabled: false, mappings: mappings };
  }

  function normalizeConfig(raw) {
    var cfg = defaultConfig();
    if (!raw || typeof raw !== 'object') {
      return cfg;
    }
    cfg.enabled = !!raw.enabled;
    if (raw.mappings && typeof raw.mappings === 'object') {
      KEY_DEFS.forEach(function (def) {
        var value = raw.mappings[def.key];
        if (value === undefined || value === null || value === '') {
          cfg.mappings[def.key] = 'none';
        } else {
          cfg.mappings[def.key] = String(value);
        }
      });
    }
    return cfg;
  }

  function setStatus(kind, text) {
    els.statusBanner.className = 'status-banner status-' + kind;
    els.statusBanner.textContent = text;
  }

  function setMessage(kind, text) {
    els.message.className = 'message' + (kind ? ' is-' + kind : '');
    els.message.textContent = text || '';
  }

  function updateEnabledLabel() {
    els.enabledLabel.textContent = els.enabledToggle.checked ? 'On' : 'Off';
  }

  function setControlsEnabled(enabled) {
    state.ready = enabled;
    els.btnSave.disabled = !enabled;
    els.enabledToggle.disabled = !enabled;
    els.selects.forEach(function (select) {
      select.disabled = !enabled;
    });
  }

  function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
  }

  function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function lunaRequest(uri, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (typeof window.PalmServiceBridge === 'undefined') {
        reject(new Error('PalmServiceBridge is not available. Run this app on a webOS TV.'));
        return;
      }

      var bridge;
      try {
        bridge = new window.PalmServiceBridge();
      } catch (err) {
        reject(err);
        return;
      }

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) {
          return;
        }
        settled = true;
        try {
          bridge.cancel();
        } catch (e) {
          /* ignore */
        }
        reject(new Error('Luna request timed out: ' + uri));
      }, timeoutMs || LUNA_TIMEOUT_MS);

      bridge.onservicecallback = function (message) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        var payload;
        try {
          payload = typeof message === 'string' ? JSON.parse(message) : message;
        } catch (parseErr) {
          reject(new Error('Invalid Luna response from ' + uri));
          return;
        }

        if (payload && payload.returnValue === false) {
          reject(new Error(payload.errorText || payload.error || 'Luna call failed: ' + uri));
          return;
        }

        resolve(payload || {});
      };

      try {
        bridge.call(uri, JSON.stringify(params || {}));
      } catch (callErr) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(callErr);
        }
      }
    });
  }

  function hbExec(command) {
    return lunaRequest('luna://org.webosbrew.hbchannel.service/exec', {
      command: command
    }).then(function (res) {
      return {
        stdout: res.stdoutString || '',
        stderr: res.stderrString || '',
        raw: res
      };
    });
  }

  function checkRoot() {
    return lunaRequest('luna://org.webosbrew.hbchannel.service/getConfiguration', {}).then(function (res) {
      var rooted = !!(res.root || res.isRoot || res.rooted);
      if (typeof res.root === 'boolean') {
        rooted = res.root;
      }
      if (typeof res.isRooted === 'boolean') {
        rooted = res.isRooted;
      }
      return {
        rooted: rooted,
        raw: res
      };
    }).catch(function () {
      return lunaRequest('luna://org.webosbrew.hbchannel.service/checkRoot', {}).then(function (res) {
        return {
          rooted: !!(res.root || res.isRoot || res.returnValue),
          raw: res
        };
      });
    });
  }

  function normalizeAppList(payload) {
    var apps = (payload && (payload.apps || payload.applist)) || [];
    if (!Array.isArray(apps)) {
      return [];
    }
    return apps
      .map(function (app) {
        return {
          id: app.id || app.appId || '',
          title: app.title || app.name || app.id || app.appId || ''
        };
      })
      .filter(function (app) {
        return !!app.id;
      });
  }

  function listAppsViaBridge() {
    return lunaRequest('luna://com.webos.service.applicationManager/listApps', {}).then(normalizeAppList)
      .catch(function () {
        return lunaRequest('luna://com.webos.applicationManager/listApps', {}).then(normalizeAppList);
      });
  }

  // Web apps are denied listApps over PalmServiceBridge; call it as root via HBChannel exec.
  function listAppsViaExec() {
    var cmd =
      'luna-send -n 1 -f luna://com.webos.applicationManager/listApps \'{}\' 2>/dev/null' +
      ' || luna-send -n 1 -f luna://com.webos.service.applicationManager/listApps \'{}\'';
    return hbExec(cmd).then(function (result) {
      var stdout = (result.stdout || '').trim();
      if (!stdout) {
        throw new Error(result.stderr || 'Empty listApps response from luna-send');
      }
      var payload;
      try {
        payload = JSON.parse(stdout);
      } catch (err) {
        throw new Error('Could not parse listApps JSON');
      }
      if (payload && payload.returnValue === false) {
        throw new Error(payload.errorText || payload.error || 'listApps failed');
      }
      return normalizeAppList(payload);
    });
  }

  function listApps() {
    return listAppsViaExec().catch(function (execErr) {
      return listAppsViaBridge().catch(function () {
        throw execErr;
      });
    });
  }

  function loadConfigFromDisk() {
    var cmd = 'if [ -f ' + shellQuote(CONFIG_PATH) + ' ]; then cat ' + shellQuote(CONFIG_PATH) + '; else echo "__MISSING__"; fi';
    return hbExec(cmd).then(function (result) {
      var stdout = (result.stdout || '').trim();
      if (!stdout || stdout === '__MISSING__') {
        return defaultConfig();
      }
      try {
        return normalizeConfig(JSON.parse(stdout));
      } catch (err) {
        setMessage('info', 'Config file was invalid; loaded defaults.');
        return defaultConfig();
      }
    });
  }

  function buildSelectOptions(select, selectedValue) {
    var fragment = document.createDocumentFragment();
    var seen = {};

    function addOption(id, title) {
      if (!id || seen[id]) {
        return;
      }
      seen[id] = true;
      var option = document.createElement('option');
      option.value = id;
      option.textContent = title;
      if (id === selectedValue) {
        option.selected = true;
      }
      fragment.appendChild(option);
    }

    addOption('none', 'Keep original function');

    HDMI_OPTIONS.forEach(function (item) {
      addOption(item.id, item.title);
    });

    var sortedApps = state.apps.slice().sort(function (a, b) {
      return String(a.title).localeCompare(String(b.title));
    });

    sortedApps.forEach(function (app) {
      if (app.id === 'none') {
        return;
      }
      addOption(app.id, app.title + ' (' + app.id + ')');
    });

    if (selectedValue && selectedValue !== 'none' && !seen[selectedValue]) {
      addOption(selectedValue, selectedValue + ' (saved)');
    }

    select.innerHTML = '';
    select.appendChild(fragment);
    if (selectedValue) {
      select.value = selectedValue;
    }
  }

  function populateAllSelects() {
    els.selects.forEach(function (select) {
      var key = select.getAttribute('data-key');
      var selected = (state.config.mappings && state.config.mappings[key]) || 'none';
      buildSelectOptions(select, selected);
    });
  }

  function applyConfigToUi(config) {
    state.config = normalizeConfig(config);
    els.enabledToggle.checked = !!state.config.enabled;
    updateEnabledLabel();
    populateAllSelects();
  }

  function readConfigFromUi() {
    var mappings = {};
    els.selects.forEach(function (select) {
      var key = select.getAttribute('data-key');
      var value = select.value || 'none';
      mappings[key] = value === '' ? 'none' : value;
    });
    return {
      enabled: !!els.enabledToggle.checked,
      mappings: mappings
    };
  }

  function escapeForSedJson(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function buildDaemonScript(config) {
    var lines = [
      '#!/bin/sh',
      '# managed by ' + APP_ID,
      '# Poll foreground app — more reliable on webOS than piped luna-send -i (stdbuf often missing).',
      'LOG=' + DAEMON_LOG,
      'LAST=""',
      'log() { echo "$(date "+%Y-%m-%d %H:%M:%S") $*" >> "$LOG"; }',
      'log "daemon start enabled=' + (config.enabled ? '1' : '0') + '"',
      '',
      'get_fg() {',
      '  out=$(luna-send -n 1 -f luna://com.webos.applicationManager/getForegroundAppInfo \'{}\' 2>/dev/null)',
      '  [ -n "$out" ] || out=$(luna-send -n 1 -f luna://com.webos.service.applicationManager/getForegroundAppInfo \'{}\' 2>/dev/null)',
      '  echo "$out" | sed -n \'s/.*"appId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\' | head -n 1',
      '}',
      '',
      'redirect() {',
      '  target="$1"',
      '  from="$2"',
      '  log "redirect $from -> $target"',
      '  luna-send -n 1 luna://com.webos.applicationManager/launch \'{"id":"\'"$target"\'"}\' >/dev/null 2>&1 || true',
      '  luna-send -n 1 luna://com.webos.applicationManager/closeByAppId \'{"id":"\'"$from"\'"}\' >/dev/null 2>&1 || true',
      '  luna-send -n 1 luna://com.webos.applicationManager/close \'{"id":"\'"$from"\'"}\' >/dev/null 2>&1 || true',
      '}',
      '',
      'while true; do',
      '  appId=$(get_fg)',
      '  if [ -n "$appId" ] && [ "$appId" != "$LAST" ]; then',
      '    LAST="$appId"',
      '    case "$appId" in'
    ];

    if (config.enabled) {
      KEY_DEFS.forEach(function (def) {
        var target = config.mappings[def.key];
        if (!target || target === 'none') {
          return;
        }
        var pattern = def.matchIds.join('|');
        var safeTarget = escapeForSedJson(target);
        lines.push('      ' + pattern + ')');
        lines.push('        redirect "' + safeTarget + '" "$appId"');
        lines.push('        ;;');
      });
    }

    lines.push('    esac');
    lines.push('  fi');
    lines.push('  usleep 200000 2>/dev/null || sleep 1');
    lines.push('done');
    lines.push('');
    return lines.join('\n');
  }

  function buildStartupBlock() {
    return [
      STARTUP_MARKER_BEGIN,
      'pkill -f ' + shellQuote(DAEMON_PATH) + ' 2>/dev/null || true',
      'if [ -x ' + shellQuote(DAEMON_PATH) + ' ]; then',
      '  nohup ' + DAEMON_PATH + ' >/dev/null 2>&1 &',
      'fi',
      STARTUP_MARKER_END
    ].join('\n');
  }

  function buildApplyScript(config) {
    var configJson = JSON.stringify(config, null, 2);
    var daemonScript = buildDaemonScript(config);
    var startupBlock = buildStartupBlock();
    var iconSrc = config.enabled
      ? APP_DIR + '/assets/icon_active.png'
      : APP_DIR + '/assets/icon_inactive.png';
    var toastMessage = config.enabled
      ? 'Key Remapper enabled and applied'
      : 'Key Remapper disabled and applied';

    var parts = [];
    parts.push('set -e');
    parts.push('mkdir -p /var/lib/webosbrew');
    parts.push('echo ' + shellQuote(toBase64(configJson)) + ' | base64 -d > ' + shellQuote(CONFIG_PATH));
    parts.push('echo ' + shellQuote(toBase64(daemonScript)) + ' | base64 -d > ' + shellQuote(DAEMON_PATH));
    parts.push('chmod +x ' + shellQuote(DAEMON_PATH));

    parts.push('if [ -f ' + shellQuote(iconSrc) + ' ]; then');
    parts.push('  cp -f ' + shellQuote(iconSrc) + ' ' + shellQuote(APP_DIR + '/icon.png'));
    // Point appinfo at distinct asset paths so SAM is less likely to keep a cached icon.png
    parts.push('  ICON_REL=' + shellQuote(config.enabled ? 'assets/icon_active.png' : 'assets/icon_inactive.png'));
    parts.push('  if [ -f ' + shellQuote(APP_DIR + '/appinfo.json') + ' ]; then');
    parts.push('    sed -i \'s#"icon"[[:space:]]*:[[:space:]]*"[^"]*"#"icon": "\'"$ICON_REL"\'"#\' ' + shellQuote(APP_DIR + '/appinfo.json'));
    parts.push('    sed -i \'s#"largeIcon"[[:space:]]*:[[:space:]]*"[^"]*"#"largeIcon": "\'"$ICON_REL"\'"#\' ' + shellQuote(APP_DIR + '/appinfo.json'));
    parts.push('    touch ' + shellQuote(APP_DIR + '/appinfo.json') + ' ' + shellQuote(APP_DIR + '/icon.png'));
    parts.push('  fi');
    parts.push('fi');

    parts.push('luna-send -n 1 luna://com.webos.service.applicationManager/rescanAppList \'{}\' >/dev/null 2>&1 || true');
    parts.push('luna-send -n 1 luna://com.webos.applicationManager/rescanAppList \'{}\' >/dev/null 2>&1 || true');
    parts.push('luna-send -n 1 luna://com.palm.applicationManager/rescan \'{}\' >/dev/null 2>&1 || true');
    // Soft-restart SAM so the home launcher reloads icons (auto-respawns on webOS)
    parts.push('pkill -9 -f /usr/sbin/sam >/dev/null 2>&1 || pkill -9 sam >/dev/null 2>&1 || true');
    parts.push('sleep 1');
    parts.push('luna-send -n 1 luna://com.webos.applicationManager/rescanAppList \'{}\' >/dev/null 2>&1 || true');

    parts.push('touch ' + shellQuote(STARTUP_PATH));
    parts.push('TMP_START=$(mktemp)');
    parts.push(
      'awk -v begin=' + shellQuote(STARTUP_MARKER_BEGIN) +
      ' -v end=' + shellQuote(STARTUP_MARKER_END) +
      ' \'BEGIN{skip=0} $0==begin{skip=1; next} $0==end{skip=0; next} skip==0{print}\' ' +
      shellQuote(STARTUP_PATH) + ' > "$TMP_START"'
    );
    parts.push('echo ' + shellQuote(toBase64(startupBlock)) + ' | base64 -d >> "$TMP_START"');
    parts.push('mv "$TMP_START" ' + shellQuote(STARTUP_PATH));
    parts.push('chmod +x ' + shellQuote(STARTUP_PATH));

    parts.push('pkill -f ' + shellQuote(DAEMON_PATH) + ' 2>/dev/null || true');
    parts.push('sleep 1');
    parts.push('if [ -x ' + shellQuote(DAEMON_PATH) + ' ]; then');
    parts.push('  nohup ' + DAEMON_PATH + ' >> ' + shellQuote(DAEMON_LOG) + ' 2>&1 &');
    parts.push('  echo $! > /var/lib/webosbrew/key_redirector.pid');
    parts.push('fi');
    parts.push('sleep 1');
    parts.push('if pgrep -f ' + shellQuote(DAEMON_PATH) + ' >/dev/null 2>&1; then');
    parts.push('  echo DAEMON_RUNNING');
    parts.push('else');
    parts.push('  echo DAEMON_NOT_RUNNING');
    parts.push('  tail -n 20 ' + shellQuote(DAEMON_LOG) + ' 2>/dev/null || true');
    parts.push('fi');
    parts.push(
      'luna-send -n 1 luna://com.webos.notification/createToast ' +
      shellQuote(JSON.stringify({ message: toastMessage, sourceId: APP_ID })) +
      ' >/dev/null 2>&1 || true'
    );
    parts.push('echo APPLY_OK');

    return parts.join('\n');
  }

  function saveAndApply() {
    if (!state.ready) {
      return;
    }

    var config = readConfigFromUi();
    state.config = config;
    setMessage('info', 'Saving and applying…');
    els.btnSave.disabled = true;

    var script = buildApplyScript(config);
    var command = 'echo ' + shellQuote(toBase64(script)) + ' | base64 -d | /bin/sh';

    return hbExec(command)
      .then(function (result) {
        var stdout = (result.stdout || '').trim();
        if (stdout.indexOf('APPLY_OK') === -1 && result.stderr) {
          throw new Error(result.stderr);
        }
        if (stdout.indexOf('DAEMON_NOT_RUNNING') !== -1) {
          throw new Error('Config saved but remapper daemon failed to start. Check /var/lib/webosbrew/key_redirector.log');
        }
        if (config.enabled && stdout.indexOf('DAEMON_RUNNING') === -1) {
          setMessage('info', 'Saved, but daemon status was unclear. Try the remapped key once; if unchanged, redeploy/check log.');
          return;
        }
        setMessage('success', config.enabled
          ? 'Saved. Remapper daemon is running. Home icon may take a moment (or a reboot) to refresh.'
          : 'Saved. Remapper is disabled. Home icon may take a moment (or a reboot) to refresh.');
      })
      .catch(function (err) {
        setMessage('error', 'Save failed: ' + (err.message || String(err)));
      })
      .then(function () {
        if (state.ready) {
          els.btnSave.disabled = false;
        }
      });
  }

  function reloadConfig() {
    if (!state.ready) {
      return Promise.resolve();
    }
    setMessage('info', 'Reloading configuration…');
    return loadConfigFromDisk()
      .then(function (config) {
        applyConfigToUi(config);
        setMessage('success', 'Configuration reloaded.');
      })
      .catch(function (err) {
        setMessage('error', 'Reload failed: ' + (err.message || String(err)));
      });
  }

  function initUiEvents() {
    els.enabledToggle.addEventListener('change', updateEnabledLabel);
    els.btnSave.addEventListener('click', function () {
      saveAndApply();
    });
    els.btnReload.addEventListener('click', function () {
      reloadConfig();
    });

    // Keep focused controls visible in the scroll pane (webOS often won't auto-scroll).
    var scrollRoot = document.getElementById('appScroll');
    document.addEventListener('focusin', function (event) {
      var target = event.target;
      if (!scrollRoot || !target || !scrollRoot.contains(target)) {
        return;
      }
      if (typeof target.scrollIntoView === 'function') {
        try {
          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch (err) {
          target.scrollIntoView(false);
        }
      }
    });
  }

  function bootstrap() {
    initUiEvents();
    loadAppVersion();
    updateEnabledLabel();
    setControlsEnabled(false);

    if (typeof window.PalmServiceBridge === 'undefined') {
      setStatus('error', 'PalmServiceBridge unavailable. This app must run on a rooted webOS TV with Homebrew Channel.');
      applyConfigToUi(defaultConfig());
      return;
    }

    checkRoot()
      .then(function (rootInfo) {
        state.rooted = !!rootInfo.rooted;
        if (!state.rooted) {
          setStatus('error', 'Homebrew Channel is reachable but root exec is not available. Elevate HBChannel and try again.');
          applyConfigToUi(defaultConfig());
          return null;
        }

        setStatus('ok', 'Homebrew Channel ready (root). Loading apps and configuration…');
        return Promise.all([
          listApps().catch(function (err) {
            setMessage('info', 'Installed apps could not be listed (' + (err.message || String(err)) + '). HDMI targets are still available.');
            return [];
          }),
          loadConfigFromDisk()
        ]);
      })
      .then(function (results) {
        if (!results) {
          return;
        }
        state.apps = results[0] || [];
        applyConfigToUi(results[1] || defaultConfig());
        setControlsEnabled(true);
        setStatus('ok', 'Ready. Root access confirmed. ' + state.apps.length + ' apps found.');
        if (state.apps.length) {
          setMessage('', '');
        }
      })
      .catch(function (err) {
        setStatus('error', 'Startup failed: ' + (err.message || String(err)));
        applyConfigToUi(defaultConfig());
        setControlsEnabled(false);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
