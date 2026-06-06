// ─── Morse lookup tables ───────────────────────────────────────────────────────────
var LETTER_TO_MORSE = {
    'A':'.-',   'B':'-...', 'C':'-.-.', 'D':'-..',  'E':'.',
    'F':'..-.', 'G':'--.',  'H':'....', 'I':'..',   'J':'.---',
    'K':'-.-',  'L':'.-..', 'M':'--',   'N':'-.',   'O':'---',
    'P':'.--.', 'Q':'--.-', 'R':'.-.',  'S':'...',  'T':'-',
    'U':'..-',  'V':'...-', 'W':'.--',  'X':'-..-', 'Y':'-.--',
    'Z':'--..'
};

var DIGIT_TO_MORSE = {
    '0':'-----', '1':'.----', '2':'..---', '3':'...--', '4':'....-',
    '5':'.....', '6':'-....', '7':'--...', '8':'---..', '9':'----.'
};

var VALID_MORSE_CHARS = /^[.\-/\s]*$/;

function getKeyboardMode() {
    return localStorage.getItem('mv-keyboard-mode') || window._keyboardMode || 'alphabet';
}

function setKeyboardModePref(mode) {
    localStorage.setItem('mv-keyboard-mode', mode);
}

if (window._keyboardMode) {
    setKeyboardModePref(window._keyboardMode);
}

function charToMorse(ch) {
    if (!ch || ch.length !== 1) return null;
    var upper = ch.toUpperCase();
    if (LETTER_TO_MORSE[upper]) return LETTER_TO_MORSE[upper] + ' ';
    if (DIGIT_TO_MORSE[ch]) return DIGIT_TO_MORSE[ch] + ' ';
    return null;
}

function insertAtCursor(el, text) {
    var start = el.selectionStart;
    var end   = el.selectionEnd;
    var val   = el.value;
    el.value  = val.slice(0, start) + text + val.slice(end);
    var pos   = start + text.length;
    el.setSelectionRange(pos, pos);
    scrollTextareaToCursor(el);
}

function scrollTextareaToCursor(textarea) {
    if (!textarea) return;
    var style = window.getComputedStyle(textarea);
    var lineHeight = parseFloat(style.lineHeight);
    if (isNaN(lineHeight)) lineHeight = parseFloat(style.fontSize) * 1.4 || 20;
    var textBefore = textarea.value.substring(0, textarea.selectionStart);
    var lines = textBefore.split('\n').length;
    var cursorTop = (lines - 1) * lineHeight;
    var paddingTop = parseFloat(style.paddingTop) || 0;
    cursorTop += paddingTop;
    if (cursorTop < textarea.scrollTop) {
        textarea.scrollTop = Math.max(0, cursorTop - lineHeight);
    } else if (cursorTop + lineHeight > textarea.scrollTop + textarea.clientHeight) {
        textarea.scrollTop = cursorTop + lineHeight - textarea.clientHeight + lineHeight;
    }
    if (typeof textarea.scrollIntoView === 'function') {
        textarea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function insertWordSeparator(el) {
    var val = el.value;
    var pos = el.selectionStart;
    var before = val.slice(0, pos).trimEnd();
    if (before.endsWith('/')) return;
    insertAtCursor(el, '/ ');
}

function updateMorseInputUI(textarea, badge, keyboard, hint) {
    var mode = getKeyboardMode();
    if (badge) {
        badge.textContent = mode === 'morse' ? 'morse keyboard' : 'auto-convert on';
    }
    if (keyboard) {
        keyboard.style.display = mode === 'morse' ? '' : 'none';
    }
    if (hint) {
        hint.textContent = mode === 'morse'
            ? 'Use the Morse keyboard below, or type . - / and space directly.'
            : 'Letters and numbers auto-convert to Morse as you type.';
    }
    if (textarea) {
        textarea.setAttribute('inputmode', mode === 'morse' ? 'none' : 'text');
        textarea.classList.toggle('morse-mode-active', mode === 'morse');
    }
}

function setupMorseInput(textarea) {
    if (!textarea) return;

    var badge    = document.getElementById('morseBadge');
    var keyboard = document.getElementById('morseKeyboard');
    var hint     = document.getElementById('morseInputHint');
    var converting = false;

    updateMorseInputUI(textarea, badge, keyboard, hint);

    function applyConversionAtCursor(insertedChar) {
        if (getKeyboardMode() !== 'alphabet') return false;
        if (insertedChar === ' ') {
            insertWordSeparator(textarea);
            scrollTextareaToCursor(textarea);
            return true;
        }
        var morse = charToMorse(insertedChar);
        if (morse) {
            var pos = textarea.selectionStart;
            if (pos > 0) {
                var val = textarea.value;
                textarea.value = val.slice(0, pos - 1) + morse + val.slice(pos);
                var newPos = pos - 1 + morse.length;
                textarea.setSelectionRange(newPos, newPos);
            } else {
                insertAtCursor(textarea, morse);
            }
            scrollTextareaToCursor(textarea);
            return true;
        }
        return false;
    }

    function stripInvalidMorseChars() {
        var cleaned = textarea.value.replace(/[^.\-/\s]/g, '');
        if (cleaned !== textarea.value) {
            var pos = textarea.selectionStart;
            textarea.value = cleaned;
            textarea.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
    }

    // beforeinput — works on modern mobile browsers
    textarea.addEventListener('beforeinput', function (e) {
        var mode = getKeyboardMode();
        if (mode === 'morse') {
            if (e.inputType === 'insertText' && e.data && !/^[.\-/\s]$/.test(e.data)) {
                e.preventDefault();
            }
            return;
        }
        if (e.inputType !== 'insertText' || !e.data) return;
        if (e.data.length !== 1) return;

        if (e.data === ' ' || charToMorse(e.data)) {
            e.preventDefault();
            converting = true;
            if (e.data === ' ') {
                insertWordSeparator(textarea);
            } else {
                insertAtCursor(textarea, charToMorse(e.data));
            }
            converting = false;
            scrollTextareaToCursor(textarea);
            return;
        }
        if (e.data !== '.' && e.data !== '-' && e.data !== '/') {
            e.preventDefault();
        }
    });

    // input fallback — Android virtual keyboards that skip beforeinput
    textarea.addEventListener('input', function () {
        if (converting) return;
        var mode = getKeyboardMode();

        if (mode === 'morse') {
            stripInvalidMorseChars();
            return;
        }

        var pos = textarea.selectionStart;
        if (pos <= 0) return;
        var inserted = textarea.value.charAt(pos - 1);
        if (inserted === ' ' || LETTER_TO_MORSE[inserted.toUpperCase()] || DIGIT_TO_MORSE[inserted]) {
            converting = true;
            applyConversionAtCursor(inserted);
            converting = false;
            scrollTextareaToCursor(textarea);
        } else if (!/^[.\-/\s]$/.test(inserted)) {
            converting = true;
            var val = textarea.value;
            textarea.value = val.slice(0, pos - 1) + val.slice(pos);
            textarea.setSelectionRange(pos - 1, pos - 1);
            converting = false;
        }
    });

    // Desktop keyboard shortcuts
    textarea.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var mode = getKeyboardMode();

        if (mode === 'morse') {
            if (e.key === 'Backspace' || e.key === 'Delete' ||
                e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ||
                e.key === 'Tab') {
                return;
            }
            if (e.key === ' ') {
                e.preventDefault();
                insertAtCursor(textarea, ' ');
                return;
            }
            if (e.key === '.' || e.key === '-' || e.key === '/') return;
            e.preventDefault();
            return;
        }

        // Alphabet mode: space handled here for desktop responsiveness
        if (e.key === ' ') {
            e.preventDefault();
            insertWordSeparator(textarea);
            return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete' ||
            e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' ||
            e.key === 'Tab') {
            return;
        }
        var morse = charToMorse(e.key);
        if (morse) {
            e.preventDefault();
            insertAtCursor(textarea, morse);
            return;
        }
        if (e.key === '.' || e.key === '-' || e.key === '/') return;
        if (e.key.length === 1) e.preventDefault();
    });

    if (keyboard) {
        keyboard.querySelectorAll('.morse-key').forEach(function (btn) {
            btn.addEventListener('click', function () {
                textarea.focus();
                if (btn.dataset.action === 'backspace') {
                    var start = textarea.selectionStart;
                    var end   = textarea.selectionEnd;
                    if (start !== end) {
                        textarea.value = textarea.value.slice(0, start) + textarea.value.slice(end);
                        textarea.setSelectionRange(start, start);
                    } else if (start > 0) {
                        textarea.value = textarea.value.slice(0, start - 1) + textarea.value.slice(start);
                        textarea.setSelectionRange(start - 1, start - 1);
                    }
                    scrollTextareaToCursor(textarea);
                    return;
                }
                var ch = btn.dataset.insert;
                if (ch === ' ') {
                    insertAtCursor(textarea, ' ');
                } else {
                    insertAtCursor(textarea, ch);
                }
                scrollTextareaToCursor(textarea);
            });
        });
    }
}

var MORSE_PREVIEW_LINES = 4;
var MORSE_PREVIEW_CHARS = 240;

function truncateMorsePreview(text) {
    var lines = text.split('\n');
    if (lines.length > MORSE_PREVIEW_LINES) {
        return lines.slice(0, MORSE_PREVIEW_LINES).join('\n');
    }
    if (text.length > MORSE_PREVIEW_CHARS) {
        return text.slice(0, MORSE_PREVIEW_CHARS).replace(/\s+$/, '');
    }
    return text;
}

function initMorsePreview() {
    var display   = document.getElementById('morseDisplay');
    var toggleBtn = document.getElementById('morseToggleBtn');
    var ellipsis  = document.getElementById('morseEllipsis');
    if (!display || !toggleBtn) return;

    var fullText = display.textContent || '';
    var preview  = truncateMorsePreview(fullText);
    var needsTruncation = preview.length < fullText.length ||
        preview.split('\n').length < fullText.split('\n').length;

    if (!needsTruncation) return;

    display.dataset.fullText = fullText;
    display.dataset.previewText = preview;
    display.textContent = preview;
    display.classList.add('morse-display-collapsed');
    if (ellipsis) ellipsis.style.display = '';
    toggleBtn.style.display = '';

    toggleBtn.addEventListener('click', function () {
        var expanded = display.classList.contains('morse-display-expanded');
        if (expanded) {
            display.textContent = display.dataset.previewText;
            display.classList.remove('morse-display-expanded');
            display.classList.add('morse-display-collapsed');
            if (ellipsis) ellipsis.style.display = '';
            toggleBtn.textContent = 'See More';
        } else {
            display.textContent = display.dataset.fullText;
            display.classList.add('morse-display-expanded');
            display.classList.remove('morse-display-collapsed');
            if (ellipsis) ellipsis.style.display = 'none';
            toggleBtn.textContent = 'See Less';
        }
    });
}

function setupUnsavedChangesGuard() {
    var form = document.getElementById('noteForm');
    var overlay = document.getElementById('unsavedModalOverlay');
    if (!form || !overlay) return;

    var bypassGuard = false;
    var pendingUrl = null;
    var titleEl = document.getElementById('title');
    var morseEl = document.getElementById('morse_text');
    var passEl  = document.getElementById('passcode');
    var customEl = document.getElementById('useCustomToggle');

    function snapshot() {
        return JSON.stringify({
            title: titleEl ? titleEl.value : '',
            morse: morseEl ? morseEl.value : '',
            pass: passEl ? passEl.value : '',
            custom: customEl ? customEl.checked : false
        });
    }

    var initial = snapshot();

    function isDirty() {
        return snapshot() !== initial;
    }

    function openUnsavedModal(url) {
        pendingUrl = url;
        overlay.classList.add('is-open');
    }

    function closeUnsavedModal() {
        overlay.classList.remove('is-open');
        pendingUrl = null;
    }

    document.querySelectorAll('.nav-leave-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
            if (bypassGuard || !isDirty()) return;
            e.preventDefault();
            openUnsavedModal(link.getAttribute('href'));
        });
    });

    window.addEventListener('beforeunload', function (e) {
        if (!bypassGuard && isDirty()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    form.addEventListener('submit', function () {
        bypassGuard = true;
    });

    var saveBtn = document.getElementById('unsavedSaveBtn');
    var discardBtn = document.getElementById('unsavedDiscardBtn');
    var cancelBtn = document.getElementById('unsavedCancelBtn');
    var closeBtn = document.getElementById('unsavedModalClose');

    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            closeUnsavedModal();
            bypassGuard = true;
            if (typeof form.requestSubmit === 'function') form.requestSubmit();
            else form.submit();
        });
    }
    if (discardBtn) {
        discardBtn.addEventListener('click', function () {
            bypassGuard = true;
            var dest = pendingUrl;
            closeUnsavedModal();
            if (dest) window.location.href = dest;
        });
    }
    if (cancelBtn) cancelBtn.addEventListener('click', closeUnsavedModal);
    if (closeBtn) closeBtn.addEventListener('click', closeUnsavedModal);
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeUnsavedModal();
    });
}

// ─── Theme ───────────────────────────────────────────────────────────────────────
(function () {
    function getTheme() { return localStorage.getItem('mv-theme') || 'light'; }
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('mv-theme', theme);
    }

    var t1 = document.getElementById('themeToggle');
    if (t1) t1.addEventListener('click', function () { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); });

    var t2 = document.getElementById('themeToggleSettings');
    if (t2) t2.addEventListener('click', function () { applyTheme(getTheme() === 'dark' ? 'light' : 'dark'); });
})();

// ─── Toast notifications ─────────────────────────────────────────────────────────
(function () {
    function showToast(msg) {
        var container = document.getElementById('toastContainer');
        if (!container) return;
        var toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = msg;
        container.appendChild(toast);
        requestAnimationFrame(function () {
            requestAnimationFrame(function () { toast.classList.add('toast-visible'); });
        });
        setTimeout(function () {
            toast.classList.remove('toast-visible');
            setTimeout(function () { toast.remove(); }, 350);
        }, 2800);
    }

    var el = document.getElementById('pageToast');
    if (el && !el.dataset.shown) {
        var msg = el.dataset.msg;
        if (msg) {
            el.dataset.shown = '1';
            setTimeout(function () { showToast(msg); }, 100);
        }
    }

    window.showToast = showToast;
})();

// ─── Main DOMContentLoaded ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {

    // ── Clear button ─────────────────────────────────────────────────────────────
    var clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            ['title', 'morse_text', 'passcode'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
            var t = document.getElementById('title');
            if (t) t.focus();
        });
    }

    // ── Custom passcode toggle (create / edit pages) ──────────────────────────────
    var useCustomToggle    = document.getElementById('useCustomToggle');
    var customPasscodeField = document.getElementById('customPasscodeField');
    var defaultPasscodeNote = document.getElementById('defaultPasscodeNote');

    if (useCustomToggle && customPasscodeField) {
        useCustomToggle.addEventListener('change', function () {
            var show = useCustomToggle.checked;
            customPasscodeField.style.display = show ? '' : 'none';
            if (defaultPasscodeNote) defaultPasscodeNote.style.display = show ? 'none' : '';
        });
    }

    // ── Auto Morse conversion in textarea ─────────────────────────────────────────
    setupMorseInput(document.getElementById('morse_text'));

    // ── Unsaved changes guard (create / edit) ─────────────────────────────────────
    setupUnsavedChangesGuard();

    // ── Morse preview expand/collapse (view note) ─────────────────────────────────
    initMorsePreview();

    // ── Settings: keyboard mode radio visual toggle ───────────────────────────────
    document.querySelectorAll('.keyboard-mode-option input[type=radio]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            document.querySelectorAll('.keyboard-mode-option').forEach(function (opt) {
                opt.classList.remove('keyboard-mode-active');
            });
            radio.closest('.keyboard-mode-option').classList.add('keyboard-mode-active');
            setKeyboardModePref(radio.value);
        });
    });

    // ── Search notes & folders ────────────────────────────────────────────────────
    var searchInput  = document.getElementById('noteSearch');
    var notesGrid    = document.getElementById('notesGrid');
    var foldersGrid  = document.getElementById('foldersGrid');
    var emptySearch  = document.getElementById('emptySearch');

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            var query   = searchInput.value.toLowerCase().trim();
            var visible = 0;

            if (foldersGrid) {
                foldersGrid.querySelectorAll('.folder-card').forEach(function (card) {
                    var match = !query || (card.dataset.name || '').includes(query);
                    card.style.display = match ? '' : 'none';
                    if (match) visible++;
                });
            }
            if (notesGrid) {
                notesGrid.querySelectorAll('.note-card').forEach(function (card) {
                    var match = !query || (card.dataset.title || '').includes(query);
                    card.style.display = match ? '' : 'none';
                    if (match) visible++;
                });
            }
            if (emptySearch) emptySearch.style.display = (query && visible === 0) ? 'block' : 'none';
        });
    }

    // ── Copy / selection protection (legacy targets; security.js handles global) ──
    if (window.MorseVaultSecurity) {
        window.MorseVaultSecurity.protectAllSensitiveElements();
    } else {
        function applyProtection(el) {
            if (!el) return;
            var block = function (e) { e.preventDefault(); };
            var blockKeys = function (e) {
                if ((e.ctrlKey || e.metaKey) && ['c','x','a','u','s','p','v'].includes(e.key.toLowerCase()))
                    e.preventDefault();
            };
            el.addEventListener('copy',        block);
            el.addEventListener('cut',         block);
            el.addEventListener('paste',       block);
            el.addEventListener('selectstart', block);
            el.addEventListener('contextmenu', block);
            el.addEventListener('keydown',     blockKeys);
            el.addEventListener('dragstart',   block);
        }
        applyProtection(document.getElementById('morseDisplay'));
        applyProtection(document.getElementById('translationText'));
    }

    // ── Generic modal helpers ─────────────────────────────────────────────────────
    function openModal(overlay, focusEl) {
        overlay.classList.add('is-open');
        if (focusEl) setTimeout(function () { focusEl.focus(); }, 60);
    }

    function closeModal(overlay, inputs, errorEl) {
        overlay.classList.remove('is-open');
        if (inputs) inputs.forEach(function (el) { if (el) el.value = ''; });
        if (errorEl) errorEl.textContent = '';
    }

    // ── Translate modal ───────────────────────────────────────────────────────────
    var translateBtn      = document.getElementById('translateBtn');
    var modalOverlay      = document.getElementById('modalOverlay');
    var modalClose        = document.getElementById('modalClose');
    var modalCancelBtn    = document.getElementById('modalCancelBtn');
    var passcodeForm      = document.getElementById('passcodeForm');
    var passcodeInput     = document.getElementById('passcodeInput');
    var modalError        = document.getElementById('modalError');
    var modalSubmit       = document.getElementById('modalSubmit');
    var timerSelect       = document.getElementById('timerSelect');
    var translationResult = document.getElementById('translationResult');
    var translationText   = document.getElementById('translationText');
    var translationTimer  = document.getElementById('translationTimer');

    if (translateBtn && modalOverlay) {
        var noteId        = translateBtn.dataset.noteId;
        var hideTimeout   = null;
        var lockTimeout   = null;
        var autoLockSecs  = parseInt(translateBtn.dataset.autoLock || 'never', 10) || 0;

        function startAutoLock() {
            if (!autoLockSecs) return;
            clearTimeout(lockTimeout);
            lockTimeout = setTimeout(reLock, autoLockSecs * 1000);
        }

        function resetAutoLock() {
            if (!autoLockSecs) return;
            if (translationResult && translationResult.style.display !== 'none') {
                clearTimeout(lockTimeout);
                lockTimeout = setTimeout(reLock, autoLockSecs * 1000);
            }
        }

        function reLock() {
            if (!translationResult || translationResult.style.display === 'none') return;
            translationResult.style.display = 'none';
            translateBtn.textContent = 'Translate Here';
            translateBtn.classList.remove('btn-translated');
            translateBtn.disabled = false;
            if (translationTimer) translationTimer.textContent = '';
            if (hideTimeout) { clearInterval(hideTimeout); hideTimeout = null; }
            if (window.showToast) window.showToast('Note re-locked due to inactivity');
        }

        document.addEventListener('mousemove', resetAutoLock);
        document.addEventListener('keydown',   resetAutoLock);
        document.addEventListener('touchstart', resetAutoLock);

        translateBtn.addEventListener('click', function () {
            passcodeInput.value = '';
            modalError.textContent = '';
            modalSubmit.disabled = false;
            modalSubmit.textContent = 'Unlock';
            openModal(modalOverlay, passcodeInput);
        });

        modalClose.addEventListener('click', function () {
            closeModal(modalOverlay, [passcodeInput], modalError);
        });
        modalCancelBtn.addEventListener('click', function () {
            closeModal(modalOverlay, [passcodeInput], modalError);
        });
        modalOverlay.addEventListener('click', function (e) {
            if (e.target === modalOverlay) closeModal(modalOverlay, [passcodeInput], modalError);
        });

        function startAutoHide(seconds) {
            if (seconds === 'never' || !seconds) {
                if (translationTimer) translationTimer.textContent = '';
                return;
            }
            var remaining = parseInt(seconds, 10);

            function label(s) {
                if (s >= 3600) return 'Hides in ' + Math.ceil(s/3600) + 'h';
                if (s >= 60)   return 'Hides in ' + Math.ceil(s/60) + 'm';
                return 'Hides in ' + s + 's';
            }

            if (translationTimer) translationTimer.textContent = label(remaining);
            hideTimeout = setInterval(function () {
                remaining--;
                if (translationTimer) translationTimer.textContent = label(remaining);
                if (remaining <= 0) {
                    clearInterval(hideTimeout);
                    translationResult.style.display = 'none';
                    translateBtn.textContent = 'Translate Here';
                    translateBtn.classList.remove('btn-translated');
                    translateBtn.disabled = false;
                    if (translationTimer) translationTimer.textContent = '';
                }
            }, 1000);
        }

        passcodeForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var passcode = passcodeInput.value.trim();
            if (!passcode) return;
            modalSubmit.disabled = true;
            modalSubmit.textContent = 'Checking...';
            modalError.textContent = '';

            var fd = new FormData();
            fd.append('passcode', passcode);

            fetch('/translate/' + noteId, { method: 'POST', body: fd })
                .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                .then(function (res) {
                    if (res.s === 200 && res.d.translation !== undefined) {
                        translationText.textContent = res.d.translation || '(empty)';
                        if (window.MorseVaultSecurity) {
                            window.MorseVaultSecurity.applyContentProtection(translationText);
                        }
                        if (hideTimeout) clearInterval(hideTimeout);
                        translationResult.style.display = 'block';
                        translateBtn.textContent = 'Translated';
                        translateBtn.classList.add('btn-translated');
                        translateBtn.disabled = true;
                        closeModal(modalOverlay, [passcodeInput], modalError);
                        var dur = timerSelect ? timerSelect.value : '30';
                        startAutoHide(dur);
                        startAutoLock();
                        if (window.showToast) window.showToast('Translation unlocked');
                    } else if (res.s === 403) {
                        modalError.textContent = 'Incorrect passcode. Try again.';
                        passcodeInput.value = '';
                        passcodeInput.focus();
                        modalSubmit.disabled = false;
                        modalSubmit.textContent = 'Unlock';
                    } else {
                        modalError.textContent = 'Something went wrong. Please try again.';
                        modalSubmit.disabled = false;
                        modalSubmit.textContent = 'Unlock';
                    }
                })
                .catch(function () {
                    modalError.textContent = 'Network error. Please try again.';
                    modalSubmit.disabled = false;
                    modalSubmit.textContent = 'Unlock';
                });
        });
    }

    // ── Edit passcode modal ───────────────────────────────────────────────────────
    var editBtn           = document.getElementById('editBtn');
    var editModalOverlay  = document.getElementById('editModalOverlay');
    var editModalClose    = document.getElementById('editModalClose');
    var editModalCancel   = document.getElementById('editModalCancelBtn');
    var editPasscodeForm  = document.getElementById('editPasscodeForm');
    var editPasscodeInput = document.getElementById('editPasscodeInput');
    var editModalError    = document.getElementById('editModalError');
    var editModalSubmit   = document.getElementById('editModalSubmit');

    if (editBtn && editModalOverlay) {
        var editNoteId = editBtn.dataset.noteId;

        editBtn.addEventListener('click', function () {
            editPasscodeInput.value = '';
            editModalError.textContent = '';
            editModalSubmit.disabled = false;
            editModalSubmit.textContent = 'Unlock Edit';
            openModal(editModalOverlay, editPasscodeInput);
        });

        editModalClose.addEventListener('click', function () {
            closeModal(editModalOverlay, [editPasscodeInput], editModalError);
        });
        editModalCancel.addEventListener('click', function () {
            closeModal(editModalOverlay, [editPasscodeInput], editModalError);
        });
        editModalOverlay.addEventListener('click', function (e) {
            if (e.target === editModalOverlay) closeModal(editModalOverlay, [editPasscodeInput], editModalError);
        });

        editPasscodeForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var passcode = editPasscodeInput.value.trim();
            if (!passcode) return;
            editModalSubmit.disabled = true;
            editModalSubmit.textContent = 'Checking...';
            editModalError.textContent = '';

            var fd = new FormData();
            fd.append('passcode', passcode);

            fetch('/edit/' + editNoteId + '/unlock', { method: 'POST', body: fd })
                .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                .then(function (res) {
                    if (res.s === 200 && res.d.success) {
                        window.location.href = res.d.redirect;
                    } else if (res.s === 403) {
                        editModalError.textContent = 'Incorrect passcode. Try again.';
                        editPasscodeInput.value = '';
                        editPasscodeInput.focus();
                        editModalSubmit.disabled = false;
                        editModalSubmit.textContent = 'Unlock Edit';
                    } else {
                        editModalError.textContent = (res.d && res.d.error) || 'Something went wrong. Please try again.';
                        editModalSubmit.disabled = false;
                        editModalSubmit.textContent = 'Unlock Edit';
                    }
                })
                .catch(function () {
                    editModalError.textContent = 'Network error. Please try again.';
                    editModalSubmit.disabled = false;
                    editModalSubmit.textContent = 'Unlock Edit';
                });
        });
    }

    // ── Delete modal ──────────────────────────────────────────────────────────────
    var deleteBtn          = document.getElementById('deleteBtn');
    var deleteModalOverlay = document.getElementById('deleteModalOverlay');
    var deleteModalClose   = document.getElementById('deleteModalClose');
    var deleteModalCancel  = document.getElementById('deleteModalCancelBtn');
    var deleteForm         = document.getElementById('deleteForm');
    var deletePasscodeInput= document.getElementById('deletePasscodeInput');
    var deleteModalError   = document.getElementById('deleteModalError');
    var deleteModalSubmit  = document.getElementById('deleteModalSubmit');

    if (deleteBtn && deleteModalOverlay) {
        var delNoteId = deleteBtn.dataset.noteId;

        deleteBtn.addEventListener('click', function () {
            deletePasscodeInput.value = '';
            deleteModalError.textContent = '';
            deleteModalSubmit.disabled = false;
            deleteModalSubmit.textContent = 'Delete Note';
            openModal(deleteModalOverlay, deletePasscodeInput);
        });

        deleteModalClose.addEventListener('click', function () {
            closeModal(deleteModalOverlay, [deletePasscodeInput], deleteModalError);
        });
        deleteModalCancel.addEventListener('click', function () {
            closeModal(deleteModalOverlay, [deletePasscodeInput], deleteModalError);
        });
        deleteModalOverlay.addEventListener('click', function (e) {
            if (e.target === deleteModalOverlay)
                closeModal(deleteModalOverlay, [deletePasscodeInput], deleteModalError);
        });

        deleteForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var passcode = deletePasscodeInput.value.trim();
            if (!passcode) return;
            deleteModalSubmit.disabled = true;
            deleteModalSubmit.textContent = 'Deleting...';
            deleteModalError.textContent = '';

            var fd = new FormData();
            fd.append('passcode', passcode);

            fetch('/delete/' + delNoteId, { method: 'POST', body: fd })
                .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                .then(function (res) {
                    if (res.s === 200 && res.d.success) {
                        var dest = (res.d.redirect) || (window._backUrl) || '/';
                        var sep = dest.indexOf('?') >= 0 ? '&' : '?';
                        setTimeout(function () { window.location.href = dest + sep + 'toast=deleted'; }, 400);
                    } else if (res.s === 403) {
                        deleteModalError.textContent = 'Incorrect passcode. Try again.';
                        deletePasscodeInput.value = '';
                        deletePasscodeInput.focus();
                        deleteModalSubmit.disabled = false;
                        deleteModalSubmit.textContent = 'Delete Note';
                    } else {
                        deleteModalError.textContent = 'Something went wrong. Please try again.';
                        deleteModalSubmit.disabled = false;
                        deleteModalSubmit.textContent = 'Delete Note';
                    }
                })
                .catch(function () {
                    deleteModalError.textContent = 'Network error. Please try again.';
                    deleteModalSubmit.disabled = false;
                    deleteModalSubmit.textContent = 'Delete Note';
                });
        });
    }

    // ── Global Escape key for any open modal ──────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (editModalOverlay && editModalOverlay.classList.contains('is-open'))
            closeModal(editModalOverlay, [editPasscodeInput], editModalError);
        if (modalOverlay      && modalOverlay.classList.contains('is-open'))
            closeModal(modalOverlay, [passcodeInput], modalError);
        if (deleteModalOverlay && deleteModalOverlay.classList.contains('is-open'))
            closeModal(deleteModalOverlay, [deletePasscodeInput], deleteModalError);
        var unsavedOverlay = document.getElementById('unsavedModalOverlay');
        if (unsavedOverlay && unsavedOverlay.classList.contains('is-open'))
            unsavedOverlay.classList.remove('is-open');
    });

    // ── Settings: timer option visual toggle ──────────────────────────────────────
    var timerOptions = document.querySelectorAll('.timer-option input[type=radio]');
    timerOptions.forEach(function (radio) {
        radio.addEventListener('change', function () {
            document.querySelectorAll('.timer-option').forEach(function (opt) {
                opt.classList.remove('timer-option-active');
            });
            radio.closest('.timer-option').classList.add('timer-option-active');
        });
    });

    // ── Account recovery OTP (forgot passcode / forgot security question only) ───
    function sendRecoveryOtp(purpose, email, statusEl, onSuccess) {
        if (statusEl) { statusEl.textContent = 'Sending...'; statusEl.style.color = ''; }
        var fd = new FormData();
        fd.append('purpose', purpose);
        fd.append('email', email);
        fetch('/send-recovery-otp', { method: 'POST', body: fd })
            .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
            .then(function (res) {
                if (res.s === 200 && res.d.success) {
                    if (statusEl) { statusEl.textContent = res.d.message || 'Code sent.'; statusEl.style.color = '#15803d'; }
                    if (onSuccess) onSuccess(res.d);
                } else {
                    if (statusEl) { statusEl.textContent = (res.d && res.d.error) || 'Failed to send.'; statusEl.style.color = '#dc2626'; }
                }
            })
            .catch(function () {
                if (statusEl) { statusEl.textContent = 'Network error.'; statusEl.style.color = '#dc2626'; }
            });
    }

    var sendRecoveryOtpBtn  = document.getElementById('sendRecoveryOtpBtn');
    var recoveryEmailInput  = document.getElementById('recoveryEmail');
    var recoveryCodeForm    = document.getElementById('recoveryCodeForm');
    var recoveryOtpStatus   = document.getElementById('recoveryOtpStatus');

    if (sendRecoveryOtpBtn && recoveryEmailInput) {
        sendRecoveryOtpBtn.addEventListener('click', function () {
            var email = recoveryEmailInput.value.trim();
            var purpose = sendRecoveryOtpBtn.dataset.purpose || 'recovery_passcode';
            if (!email) {
                if (recoveryOtpStatus) { recoveryOtpStatus.textContent = 'Enter your account email.'; recoveryOtpStatus.style.color = '#dc2626'; }
                return;
            }
            sendRecoveryOtp(purpose, email, recoveryOtpStatus, function () {
                if (recoveryCodeForm) recoveryCodeForm.style.display = '';
                sendRecoveryOtpBtn.textContent = 'Resend Code';
            });
        });
    }

    // ── Morse Code Reference Table modal ──────────────────────────────────────────
    var morseTableBtn     = document.getElementById('morseTableBtn');
    var morseTableOverlay = document.getElementById('morseTableOverlay');
    var morseTableClose   = document.getElementById('morseTableClose');
    var morseTableSearch  = document.getElementById('morseTableSearch');
    var morseTableGrid    = document.getElementById('morseTableGrid');
    var morseTableEmpty   = document.getElementById('morseTableEmpty');

    if (morseTableBtn && morseTableOverlay) {
        morseTableBtn.addEventListener('click', function () {
            if (morseTableSearch) morseTableSearch.value = '';
            filterMorseTable('');
            morseTableOverlay.classList.add('is-open');
            setTimeout(function () { if (morseTableSearch) morseTableSearch.focus(); }, 60);
        });

        morseTableClose.addEventListener('click', function () {
            morseTableOverlay.classList.remove('is-open');
        });

        morseTableOverlay.addEventListener('click', function (e) {
            if (e.target === morseTableOverlay) morseTableOverlay.classList.remove('is-open');
        });

        if (morseTableSearch) {
            morseTableSearch.addEventListener('input', function () {
                filterMorseTable(morseTableSearch.value.trim().toUpperCase());
            });
        }
    }

    function filterMorseTable(query) {
        if (!morseTableGrid) return;
        var rows = morseTableGrid.querySelectorAll('.mtrow');
        var visible = 0;
        rows.forEach(function (row) {
            var ch   = row.dataset.char  || '';
            var code = row.dataset.code  || '';
            var match = !query || ch.includes(query) || code.includes(query.toLowerCase());
            row.style.display = match ? '' : 'none';
            if (match) visible++;
        });
        if (morseTableEmpty) morseTableEmpty.style.display = visible === 0 ? 'block' : 'none';
    }

    // ── New Folder inline form ────────────────────────────────────────────────────
    var newFolderBtn    = document.getElementById('newFolderBtn');
    var newFolderForm   = document.getElementById('newFolderForm');
    var newFolderName   = document.getElementById('newFolderName');
    var newFolderSave   = document.getElementById('newFolderSave');
    var newFolderCancel = document.getElementById('newFolderCancel');
    var folderFormError = document.getElementById('folderFormError');

    if (newFolderBtn && newFolderForm) {
        newFolderBtn.addEventListener('click', function () {
            newFolderForm.style.display = newFolderForm.style.display === 'none' ? '' : 'none';
            if (newFolderForm.style.display !== 'none') {
                newFolderName.value = '';
                if (folderFormError) folderFormError.style.display = 'none';
                newFolderName.focus();
            }
        });
        if (newFolderCancel) {
            newFolderCancel.addEventListener('click', function () {
                newFolderForm.style.display = 'none';
            });
        }
        if (newFolderSave) {
            newFolderSave.addEventListener('click', function () { doCreateFolder(); });
        }
        if (newFolderName) {
            newFolderName.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doCreateFolder(); }
                if (e.key === 'Escape') { newFolderForm.style.display = 'none'; }
            });
        }

        function doCreateFolder() {
            var name = newFolderName.value.trim();
            if (!name) {
                if (folderFormError) { folderFormError.textContent = 'Folder name cannot be empty.'; folderFormError.style.display = ''; }
                newFolderName.focus();
                return;
            }
            if (folderFormError) folderFormError.style.display = 'none';
            newFolderSave.disabled = true;
            var fd = new FormData();
            fd.append('name', name);
            if (window._currentFolderId) fd.append('parent_id', window._currentFolderId);
            fetch('/folder/create', { method: 'POST', body: fd })
                .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                .then(function (res) {
                    if (res.s === 200 && res.d.success) {
                        window.location.reload();
                    } else {
                        if (folderFormError) { folderFormError.textContent = (res.d && res.d.error) || 'Failed to create folder.'; folderFormError.style.display = ''; }
                        newFolderSave.disabled = false;
                    }
                })
                .catch(function () {
                    if (folderFormError) { folderFormError.textContent = 'Network error.'; folderFormError.style.display = ''; }
                    newFolderSave.disabled = false;
                });
        }
    }

    // ── Folder rename modal ───────────────────────────────────────────────────────
    var folderRenameOverlay = document.getElementById('folderRenameOverlay');
    var folderRenameInput   = document.getElementById('folderRenameInput');
    var folderRenameConfirm = document.getElementById('folderRenameConfirm');
    var folderRenameCancel  = document.getElementById('folderRenameCancel');
    var folderRenameClose   = document.getElementById('folderRenameClose');
    var folderRenameError   = document.getElementById('folderRenameError');
    var _renameFolderId     = null;

    document.querySelectorAll('.folder-rename-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _renameFolderId = btn.dataset.id;
            if (folderRenameInput)  folderRenameInput.value = btn.dataset.name || '';
            if (folderRenameError)  folderRenameError.style.display = 'none';
            if (folderRenameOverlay) {
                folderRenameOverlay.style.display = 'flex';
                setTimeout(function () { if (folderRenameInput) folderRenameInput.focus(); }, 60);
            }
        });
    });

    function closeFolderRename() {
        if (folderRenameOverlay) folderRenameOverlay.style.display = 'none';
    }
    if (folderRenameClose)  folderRenameClose.addEventListener('click', closeFolderRename);
    if (folderRenameCancel) folderRenameCancel.addEventListener('click', closeFolderRename);
    if (folderRenameOverlay) {
        folderRenameOverlay.addEventListener('click', function (e) {
            if (e.target === folderRenameOverlay) closeFolderRename();
        });
    }
    if (folderRenameInput) {
        folderRenameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); doRenameFolder(); }
            if (e.key === 'Escape') closeFolderRename();
        });
    }
    if (folderRenameConfirm) {
        folderRenameConfirm.addEventListener('click', doRenameFolder);
    }

    function doRenameFolder() {
        var name = folderRenameInput ? folderRenameInput.value.trim() : '';
        if (!name || !_renameFolderId) return;
        if (folderRenameError) folderRenameError.style.display = 'none';
        folderRenameConfirm.disabled = true;
        var fd = new FormData();
        fd.append('name', name);
        fetch('/folder/' + _renameFolderId + '/rename', { method: 'POST', body: fd })
            .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
            .then(function (res) {
                if (res.s === 200 && res.d.success) {
                    window.location.reload();
                } else {
                    if (folderRenameError) { folderRenameError.textContent = (res.d && res.d.error) || 'Failed to rename.'; folderRenameError.style.display = ''; }
                    folderRenameConfirm.disabled = false;
                }
            })
            .catch(function () {
                if (folderRenameError) { folderRenameError.textContent = 'Network error.'; folderRenameError.style.display = ''; }
                folderRenameConfirm.disabled = false;
            });
    }

    // ── Folder delete modal ───────────────────────────────────────────────────────
    var folderDeleteOverlay = document.getElementById('folderDeleteOverlay');
    var folderDeleteConfirm = document.getElementById('folderDeleteConfirm');
    var folderDeleteCancel  = document.getElementById('folderDeleteCancel');
    var folderDeleteClose   = document.getElementById('folderDeleteClose');
    var folderDeleteName    = document.getElementById('folderDeleteName');
    var folderDeleteError   = document.getElementById('folderDeleteError');
    var _deleteFolderId     = null;

    document.querySelectorAll('.folder-delete-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            _deleteFolderId = btn.dataset.id;
            if (folderDeleteName)  folderDeleteName.textContent = btn.dataset.name || '';
            if (folderDeleteError) folderDeleteError.style.display = 'none';
            if (folderDeleteOverlay) folderDeleteOverlay.style.display = 'flex';
        });
    });

    function closeFolderDelete() {
        if (folderDeleteOverlay) folderDeleteOverlay.style.display = 'none';
    }
    if (folderDeleteClose)  folderDeleteClose.addEventListener('click', closeFolderDelete);
    if (folderDeleteCancel) folderDeleteCancel.addEventListener('click', closeFolderDelete);
    if (folderDeleteOverlay) {
        folderDeleteOverlay.addEventListener('click', function (e) {
            if (e.target === folderDeleteOverlay) closeFolderDelete();
        });
    }
    if (folderDeleteConfirm) {
        folderDeleteConfirm.addEventListener('click', function () {
            if (!_deleteFolderId) return;
            folderDeleteConfirm.disabled = true;
            if (folderDeleteError) folderDeleteError.style.display = 'none';
            fetch('/folder/' + _deleteFolderId + '/delete', { method: 'POST' })
                .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                .then(function (res) {
                    if (res.s === 200 && res.d.success) {
                        window.location.reload();
                    } else {
                        if (folderDeleteError) { folderDeleteError.textContent = (res.d && res.d.error) || 'Could not delete folder.'; folderDeleteError.style.display = ''; }
                        folderDeleteConfirm.disabled = false;
                    }
                })
                .catch(function () {
                    if (folderDeleteError) { folderDeleteError.textContent = 'Network error.'; folderDeleteError.style.display = ''; }
                    folderDeleteConfirm.disabled = false;
                });
        });
    }

    // ── Move note modal ───────────────────────────────────────────────────────────
    var moveBtn          = document.getElementById('moveBtn');
    var moveModalOverlay = document.getElementById('moveModalOverlay');
    var moveModalClose   = document.getElementById('moveModalClose');
    var moveCancelBtn    = document.getElementById('moveCancelBtn');
    var moveFolderSelect = document.getElementById('moveFolderSelect');
    var moveConfirm      = document.getElementById('moveConfirm');
    var moveModalError   = document.getElementById('moveModalError');

    if (moveBtn && moveModalOverlay) {
        moveBtn.addEventListener('click', function () {
            if (moveModalError) moveModalError.style.display = 'none';
            // Load folders via AJAX
            moveFolderSelect.innerHTML = '<option value="">&#8962; Home (no folder)</option>';
            fetch('/api/folders')
                .then(function (r) { return r.json(); })
                .then(function (folders) {
                    folders.forEach(function (f) {
                        var opt = document.createElement('option');
                        opt.value = f.id;
                        opt.textContent = '\u00a0'.repeat(f.depth * 3) + '\uD83D\uDCC1 ' + f.name;
                        if (window._folderId && f.id === window._folderId) opt.selected = true;
                        moveFolderSelect.appendChild(opt);
                    });
                    moveModalOverlay.style.display = 'flex';
                })
                .catch(function () {
                    moveModalOverlay.style.display = 'flex';
                });
        });

        function closeMoveModal() { moveModalOverlay.style.display = 'none'; }
        if (moveModalClose) moveModalClose.addEventListener('click', closeMoveModal);
        if (moveCancelBtn)  moveCancelBtn.addEventListener('click',  closeMoveModal);
        moveModalOverlay.addEventListener('click', function (e) {
            if (e.target === moveModalOverlay) closeMoveModal();
        });

        if (moveConfirm) {
            moveConfirm.addEventListener('click', function () {
                if (!window._noteId) return;
                moveConfirm.disabled = true;
                if (moveModalError) moveModalError.style.display = 'none';
                var fd = new FormData();
                fd.append('folder_id', moveFolderSelect.value || '');
                fetch('/note/' + window._noteId + '/move', { method: 'POST', body: fd })
                    .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
                    .then(function (res) {
                        if (res.s === 200 && res.d.success) {
                            var base = window.location.pathname;
                            setTimeout(function () { window.location.href = base + '?toast=moved'; }, 400);
                        } else {
                            if (moveModalError) { moveModalError.textContent = (res.d && res.d.error) || 'Failed to move note.'; moveModalError.style.display = ''; }
                            moveConfirm.disabled = false;
                        }
                    })
                    .catch(function () {
                        if (moveModalError) { moveModalError.textContent = 'Network error.'; moveModalError.style.display = ''; }
                        moveConfirm.disabled = false;
                    });
            });
        }
    }

    // ── Escape closes Morse table modal too ───────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && morseTableOverlay && morseTableOverlay.classList.contains('is-open')) {
            morseTableOverlay.classList.remove('is-open');
        }
    });

});
