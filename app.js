/* ============================================
   LinguaFlow — AI Translation Tool
   Application Logic (app.js)
   ============================================ */

// ---- DOM Element References ----
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
    sourceLang:   $('#source-language'),
    targetLang:   $('#target-language'),
    sourceText:   $('#source-text'),
    targetText:   $('#target-text'),
    translateBtn: $('#translate-btn'),
    swapBtn:      $('#swap-languages'),
    clearSource:  $('#clear-source'),
    pasteSource:  $('#paste-source'),
    speakSource:  $('#speak-source'),
    copyTarget:   $('#copy-target'),
    speakTarget:  $('#speak-target'),
    downloadTarget: $('#download-target'),
    charCounter:  $('#char-counter'),
    matchBadge:   $('#match-badge'),
    copyFeedback: $('#copy-feedback'),
    themeToggle:  $('#theme-toggle'),
    historyList:  $('#history-list'),
    historyEmpty: $('#history-empty'),
    clearHistory: $('#clear-history'),
    toast:        $('#toast'),
    toastMessage: $('#toast-message'),
    btnLoader:    $('#btn-loader'),
};

// ---- Constants ----
const API_URL = 'https://api.mymemory.translated.net/get';
const MAX_CHARS = 5000;
const HISTORY_KEY = 'linguaflow_history';
const THEME_KEY = 'linguaflow_theme';
const MAX_HISTORY = 15;

// Language code to name mapping
const LANG_NAMES = {
    'auto': 'Auto Detect', 'en': 'English', 'es': 'Spanish', 'fr': 'French',
    'de': 'German', 'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
    'zh-CN': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean', 'ar': 'Arabic',
    'hi': 'Hindi', 'bn': 'Bengali', 'ta': 'Tamil', 'te': 'Telugu',
    'ur': 'Urdu', 'tr': 'Turkish', 'nl': 'Dutch', 'pl': 'Polish',
    'sv': 'Swedish', 'th': 'Thai', 'vi': 'Vietnamese', 'id': 'Indonesian',
    'ms': 'Malay'
};

// BCP 47 language tags for SpeechSynthesis
const SPEECH_LANG_MAP = {
    'auto': 'en-US', 'en': 'en-US', 'es': 'es-ES', 'fr': 'fr-FR',
    'de': 'de-DE', 'it': 'it-IT', 'pt': 'pt-BR', 'ru': 'ru-RU',
    'zh-CN': 'zh-CN', 'ja': 'ja-JP', 'ko': 'ko-KR', 'ar': 'ar-SA',
    'hi': 'hi-IN', 'bn': 'bn-IN', 'ta': 'ta-IN', 'te': 'te-IN',
    'ur': 'ur-PK', 'tr': 'tr-TR', 'nl': 'nl-NL', 'pl': 'pl-PL',
    'sv': 'sv-SE', 'th': 'th-TH', 'vi': 'vi-VN', 'id': 'id-ID',
    'ms': 'ms-MY'
};

// ---- State ----
let isTranslating = false;
let translationHistory = [];
let debounceTimer = null;

// ---- Initialization ----
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadHistory();
    bindEvents();
});

// ---- Theme Management ----
function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    } else {
        // Default to dark
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    showToast(`Switched to ${next} mode`, 'info');
}

// ---- Event Bindings ----
function bindEvents() {
    // Theme
    els.themeToggle.addEventListener('click', toggleTheme);

    // Source text input
    els.sourceText.addEventListener('input', handleSourceInput);

    // Translate
    els.translateBtn.addEventListener('click', handleTranslate);

    // Keyboard shortcut: Ctrl+Enter to translate
    els.sourceText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleTranslate();
        }
    });

    // Swap languages
    els.swapBtn.addEventListener('click', handleSwap);

    // Source actions
    els.clearSource.addEventListener('click', handleClear);
    els.pasteSource.addEventListener('click', handlePaste);
    els.speakSource.addEventListener('click', () => speak(els.sourceText.value, els.sourceLang.value));

    // Target actions
    els.copyTarget.addEventListener('click', handleCopy);
    els.speakTarget.addEventListener('click', () => {
        const text = els.targetText.textContent;
        if (text && !text.includes('Translation will appear')) {
            speak(text, els.targetLang.value);
        }
    });
    els.downloadTarget.addEventListener('click', handleDownload);

    // History
    els.clearHistory.addEventListener('click', clearHistory);
}

// ---- Source Text Handling ----
function handleSourceInput() {
    const len = els.sourceText.value.length;
    els.charCounter.textContent = `${len.toLocaleString()} / ${MAX_CHARS.toLocaleString()}`;

    // Visual feedback for character limit
    els.charCounter.classList.remove('near-limit', 'at-limit');
    if (len >= MAX_CHARS) {
        els.charCounter.classList.add('at-limit');
    } else if (len >= MAX_CHARS * 0.85) {
        els.charCounter.classList.add('near-limit');
    }

    // Auto-translate with debounce (after 1s of inactivity)
    clearTimeout(debounceTimer);
    if (len > 0 && len <= MAX_CHARS) {
        debounceTimer = setTimeout(() => {
            handleTranslate();
        }, 1000);
    }
}

// ---- Translation ----
async function handleTranslate() {
    const sourceText = els.sourceText.value.trim();
    if (!sourceText) {
        showToast('Please enter some text to translate', 'error');
        els.sourceText.focus();
        return;
    }

    if (isTranslating) return;

    const sourceLang = els.sourceLang.value;
    const targetLang = els.targetLang.value;

    // Prevent same-language translation (when not auto-detect)
    if (sourceLang !== 'auto' && sourceLang === targetLang) {
        showToast('Source and target languages must be different', 'error');
        return;
    }

    isTranslating = true;
    setLoadingState(true);

    try {
        // Build the language pair (e.g., "en|es")
        const langPair = `${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;

        const params = new URLSearchParams({
            q: sourceText,
            langpair: langPair,
        });

        const response = await fetch(`${API_URL}?${params.toString()}`);

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json();

        if (data.responseStatus === 200 || data.responseStatus === '200') {
            const translatedText = data.responseData.translatedText;
            const match = data.responseData.match;

            // Display translated text
            displayTranslation(translatedText);

            // Show match confidence
            showMatchBadge(match);

            // Add to history
            addToHistory(sourceText, translatedText, sourceLang, targetLang);

            showToast('Translation complete!', 'success');
        } else {
            throw new Error(data.responseDetails || 'Translation failed');
        }
    } catch (error) {
        console.error('Translation Error:', error);

        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showToast('Network error. Please check your internet connection.', 'error');
        } else {
            showToast(`Translation failed: ${error.message}`, 'error');
        }
    } finally {
        isTranslating = false;
        setLoadingState(false);
    }
}

function displayTranslation(text) {
    els.targetText.innerHTML = '';
    els.targetText.classList.remove('loading');

    // Animate characters appearing
    const decoded = decodeHTMLEntities(text);
    els.targetText.textContent = decoded;
    els.targetText.style.animation = 'fadeIn 0.4s ease';
    setTimeout(() => {
        els.targetText.style.animation = '';
    }, 400);
}

function decodeHTMLEntities(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return doc.documentElement.textContent;
}

function showMatchBadge(match) {
    if (match !== undefined && match !== null) {
        const percent = Math.round(parseFloat(match) * 100);
        els.matchBadge.textContent = `${percent}% match`;
        els.matchBadge.classList.add('visible');

        // Color based on quality
        if (percent >= 80) {
            els.matchBadge.style.background = 'rgba(52, 211, 153, 0.15)';
            els.matchBadge.style.color = 'var(--success)';
        } else if (percent >= 50) {
            els.matchBadge.style.background = 'rgba(251, 191, 36, 0.15)';
            els.matchBadge.style.color = 'var(--warning)';
        } else {
            els.matchBadge.style.background = 'rgba(248, 113, 113, 0.15)';
            els.matchBadge.style.color = 'var(--error)';
        }
    }
}

function setLoadingState(loading) {
    els.translateBtn.classList.toggle('loading', loading);
    els.translateBtn.disabled = loading;

    if (loading) {
        els.targetText.innerHTML = '<span class="placeholder-text">Translating...</span>';
        els.targetText.classList.add('loading');
        els.matchBadge.classList.remove('visible');
    }
}

// ---- Swap Languages ----
function handleSwap() {
    const srcVal = els.sourceLang.value;
    const tgtVal = els.targetLang.value;

    // Can't swap if source is auto-detect
    if (srcVal === 'auto') {
        showToast('Cannot swap when source is set to Auto Detect', 'info');
        return;
    }

    // Swap language selections
    els.sourceLang.value = tgtVal;
    els.targetLang.value = srcVal;

    // Swap texts if translation exists
    const translatedText = els.targetText.textContent;
    if (translatedText && !translatedText.includes('Translation will appear') && !translatedText.includes('Translating')) {
        els.sourceText.value = translatedText;
        handleSourceInput(); // Update char counter

        // Auto-translate swapped text
        handleTranslate();
    }
}

// ---- Source Actions ----
function handleClear() {
    els.sourceText.value = '';
    els.targetText.innerHTML = '<span class="placeholder-text">Translation will appear here...</span>';
    els.charCounter.textContent = '0 / 5,000';
    els.charCounter.classList.remove('near-limit', 'at-limit');
    els.matchBadge.classList.remove('visible');
    els.sourceText.focus();
    clearTimeout(debounceTimer);
}

async function handlePaste() {
    try {
        const text = await navigator.clipboard.readText();
        els.sourceText.value = text;
        handleSourceInput();
        els.sourceText.focus();
        showToast('Text pasted from clipboard', 'info');
    } catch {
        showToast('Unable to access clipboard. Please paste manually.', 'error');
    }
}

// ---- Target Actions ----
async function handleCopy() {
    const text = els.targetText.textContent;
    if (!text || text.includes('Translation will appear') || text.includes('Translating')) {
        showToast('No translation to copy', 'error');
        return;
    }

    try {
        await navigator.clipboard.writeText(text);

        // Show inline feedback
        els.copyFeedback.classList.add('show');
        setTimeout(() => els.copyFeedback.classList.remove('show'), 1500);

        showToast('Translation copied to clipboard!', 'success');
    } catch {
        showToast('Failed to copy to clipboard', 'error');
    }
}

function handleDownload() {
    const text = els.targetText.textContent;
    if (!text || text.includes('Translation will appear') || text.includes('Translating')) {
        showToast('No translation to download', 'error');
        return;
    }

    const sourceLangName = LANG_NAMES[els.sourceLang.value] || els.sourceLang.value;
    const targetLangName = LANG_NAMES[els.targetLang.value] || els.targetLang.value;

    const content = [
        '═══════════════════════════════════════',
        '  LinguaFlow — Translation Export',
        '═══════════════════════════════════════',
        '',
        `Date: ${new Date().toLocaleString()}`,
        `From: ${sourceLangName}`,
        `To:   ${targetLangName}`,
        '',
        '── Source Text ────────────────────────',
        els.sourceText.value,
        '',
        '── Translation ───────────────────────',
        text,
        '',
        '═══════════════════════════════════════',
        'Powered by LinguaFlow • CodeAlpha AI Internship',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translation_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Translation downloaded!', 'success');
}

// ---- Text-to-Speech ----
function speak(text, langCode) {
    if (!text || !text.trim()) {
        showToast('No text to speak', 'error');
        return;
    }

    if (!('speechSynthesis' in window)) {
        showToast('Text-to-speech not supported in this browser', 'error');
        return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_LANG_MAP[langCode] || 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;

    // Try to find a matching voice
    const voices = window.speechSynthesis.getVoices();
    const matchingVoice = voices.find(v => v.lang.startsWith(langCode)) ||
                          voices.find(v => v.lang.startsWith(langCode.split('-')[0]));
    if (matchingVoice) {
        utterance.voice = matchingVoice;
    }

    utterance.onstart = () => showToast('🔊 Speaking...', 'info');
    utterance.onerror = () => showToast('Speech synthesis error', 'error');

    window.speechSynthesis.speak(utterance);
}

// Load voices (they load asynchronously in some browsers)
if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
}

// ---- Translation History ----
function loadHistory() {
    try {
        const saved = localStorage.getItem(HISTORY_KEY);
        translationHistory = saved ? JSON.parse(saved) : [];
        renderHistory();
    } catch {
        translationHistory = [];
    }
}

function saveHistory() {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(translationHistory));
    } catch {
        // localStorage full or unavailable
    }
}

function addToHistory(source, translated, srcLang, tgtLang) {
    // Avoid duplicates (same source text and same target lang)
    const exists = translationHistory.findIndex(
        h => h.source === source && h.tgtLang === tgtLang
    );
    if (exists !== -1) {
        translationHistory.splice(exists, 1);
    }

    translationHistory.unshift({
        source: source.substring(0, 200),
        translated: translated.substring(0, 200),
        srcLang,
        tgtLang,
        timestamp: Date.now(),
    });

    // Limit history size
    if (translationHistory.length > MAX_HISTORY) {
        translationHistory = translationHistory.slice(0, MAX_HISTORY);
    }

    saveHistory();
    renderHistory();
}

function renderHistory() {
    if (translationHistory.length === 0) {
        els.historyEmpty.style.display = 'flex';
        // Remove all history items
        els.historyList.querySelectorAll('.history-item').forEach(el => el.remove());
        return;
    }

    els.historyEmpty.style.display = 'none';

    // Clear existing items
    els.historyList.querySelectorAll('.history-item').forEach(el => el.remove());

    translationHistory.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';
        div.innerHTML = `
            <span class="history-item-text" title="${escapeHTML(item.source)}">${escapeHTML(item.source)}</span>
            <span class="history-item-arrow">→</span>
            <span class="history-item-text" title="${escapeHTML(item.translated)}">${escapeHTML(item.translated)}</span>
            <button class="history-item-delete" data-index="${index}" title="Remove" aria-label="Remove history item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        // Click to restore
        div.addEventListener('click', (e) => {
            if (e.target.closest('.history-item-delete')) return;
            els.sourceText.value = item.source;
            els.sourceLang.value = item.srcLang;
            els.targetLang.value = item.tgtLang;
            handleSourceInput();
            displayTranslation(item.translated);
            showToast('Restored from history', 'info');
        });

        // Delete button
        div.querySelector('.history-item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            translationHistory.splice(index, 1);
            saveHistory();
            renderHistory();
        });

        els.historyList.appendChild(div);
    });
}

function clearHistory() {
    translationHistory = [];
    saveHistory();
    renderHistory();
    showToast('History cleared', 'info');
}

// ---- Toast Notification ----
let toastTimeout;
function showToast(message, type = 'info') {
    clearTimeout(toastTimeout);

    els.toastMessage.textContent = message;
    els.toast.className = 'toast show ' + type;

    toastTimeout = setTimeout(() => {
        els.toast.classList.remove('show');
    }, 2500);
}

// ---- Utility Functions ----
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
