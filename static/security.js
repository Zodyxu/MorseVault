/**
 * MorseVault — privacy & content-extraction hardening (web + WebView).
 * Exposes window.MorseVaultSecurity for Android WebView lifecycle hooks.
 */
(function () {
    'use strict';

    var overlay = null;
    var privacyActive = false;

    function getOverlay() {
        if (!overlay) overlay = document.getElementById('privacyOverlay');
        return overlay;
    }

    function showPrivacyOverlay() {
        privacyActive = true;
        document.body.classList.add('privacy-active');
        var el = getOverlay();
        if (el) {
            el.setAttribute('aria-hidden', 'false');
        }
        clearClipboardQuietly();
    }

    function hidePrivacyOverlay() {
        privacyActive = false;
        document.body.classList.remove('privacy-active');
        var el = getOverlay();
        if (el) {
            el.setAttribute('aria-hidden', 'true');
        }
    }

    function clearClipboardQuietly() {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText('').catch(function () {});
            }
        } catch (e) { /* clipboard API unavailable */ }
    }

    function blockEvent(e) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    /** Apply copy/paste/cut/select/drag protection to an element. */
    function applyContentProtection(el, opts) {
        if (!el || el.dataset.mvProtected === '1') return;
        opts = opts || {};
        el.dataset.mvProtected = '1';
        el.classList.add('protected-text');

        var events = ['copy', 'cut', 'paste', 'selectstart', 'contextmenu', 'dragstart', 'drop'];
        events.forEach(function (ev) {
            el.addEventListener(ev, blockEvent, true);
        });

        el.addEventListener('keydown', function (e) {
            if (e.ctrlKey || e.metaKey) {
                var k = e.key.toLowerCase();
                if (k === 'c' || k === 'x' || k === 'a' || k === 'u' || k === 's' || k === 'p' || k === 'v') {
                    if (!opts.allowPaste || k !== 'v') {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            }
        }, true);

        // Mobile long-press selection
        el.addEventListener('touchstart', function (e) {
            if (opts.allowInput) return;
            if (e.touches.length > 1) e.preventDefault();
        }, { passive: false });

        if (opts.allowInput) {
            el.classList.add('protected-input');
        }
    }

    function initPrivacyScreen() {
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'hidden') {
                showPrivacyOverlay();
            } else if (document.visibilityState === 'visible') {
                hidePrivacyOverlay();
            }
        });

        window.addEventListener('pagehide', showPrivacyOverlay);
        window.addEventListener('pageshow', function (e) {
            if (e.persisted) hidePrivacyOverlay();
        });

        window.addEventListener('blur', function () {
            showPrivacyOverlay();
        });

        window.addEventListener('focus', function () {
            if (document.visibilityState === 'visible') {
                hidePrivacyOverlay();
            }
        });
    }

    function initDocumentProtections() {
        document.addEventListener('contextmenu', function (e) {
            var t = e.target;
            if (t.closest('.protected-text, .protected-input, .secure-content, .morse-display, .translation-display, .morse-input, #morse_text')) {
                blockEvent(e);
            }
        }, true);

        document.addEventListener('copy', function (e) {
            if (e.target.closest('.protected-text, .protected-input, .secure-content, .morse-display, .translation-display, .morse-input, #morse_text')) {
                blockEvent(e);
            }
        }, true);

        document.addEventListener('cut', function (e) {
            if (e.target.closest('.protected-text, .protected-input, .secure-content, .morse-display, .translation-display, .morse-input, #morse_text')) {
                blockEvent(e);
            }
        }, true);

        document.addEventListener('paste', function (e) {
            if (e.target.closest('.protected-text, .protected-input, .morse-display, .translation-display, #morse_text')) {
                blockEvent(e);
            }
        }, true);

        document.addEventListener('dragstart', function (e) {
            if (e.target.closest('.protected-text, .secure-content, .morse-display, .translation-display')) {
                blockEvent(e);
            }
        }, true);

        window.addEventListener('beforeprint', blockEvent);

        // Disable right-click on secure main content (allow on form controls like settings inputs)
        document.querySelector('main')?.addEventListener('contextmenu', function (e) {
            if (!e.target.closest('input, textarea, select, button, a, label')) {
                blockEvent(e);
            }
        }, true);
    }

    function protectAllSensitiveElements() {
        var selectors = [
            '.morse-display',
            '.translation-display',
            '#morseDisplay',
            '#translationText',
            '#morse_text',
            '.morse-input'
        ];
        selectors.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (el) {
                var isInput = el.tagName === 'TEXTAREA' || el.id === 'morse_text';
                applyContentProtection(el, { allowInput: isInput, allowPaste: false });
            });
        });

        document.querySelectorAll('.secure-content').forEach(function (el) {
            applyContentProtection(el, { allowInput: false });
        });
    }

    function init() {
        initPrivacyScreen();
        initDocumentProtections();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', protectAllSensitiveElements);
        } else {
            protectAllSensitiveElements();
        }
    }

    window.MorseVaultSecurity = {
        showPrivacyOverlay: showPrivacyOverlay,
        hidePrivacyOverlay: hidePrivacyOverlay,
        applyContentProtection: applyContentProtection,
        protectAllSensitiveElements: protectAllSensitiveElements,
        clearClipboardQuietly: clearClipboardQuietly
    };

    init();
})();
