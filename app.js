// Global değişkenler
let questions = [];
let answers = [];
let allQuestions = [];
let allAnswers = [];
let units = []; // Ünite bazlı sorular
let currentQuestionIndex = 0;
let score = 0;
let currentMode = '';
let currentUnit = null;
let selectedUnits = [];
let userAnswers = [];
let attemptCount = 0;
let examAnswers = [];
let examStartTime = null;
let timerInterval = null;
let markedQuestions = new Set();
let draggedElement = null;
let selectedOption = null;
let bulkState = null;
let fbAnswerStates = [];
let mcAnswerStates = [];
let questionUnitNames = [];
let currentFileName = ''; // Yüklü dosyanın adı

const CACHE_KEY = 'sorcoz.cache.v1';
const PROGRESS_KEY = 'sorcoz.progress.v1';
const MC_AUTO_NEXT_DELAY_MS = 1100;
let mcAutoAdvanceTimer = null;

function hasLocalStorage() {
    return typeof localStorage !== 'undefined' && localStorage;
}

function shuffleArray(input) {
    const arr = Array.isArray(input) ? [...input] : [];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function uniqueStrings(input) {
    const out = [];
    const seen = new Set();
    (Array.isArray(input) ? input : []).forEach((v) => {
        const s = String(v ?? '').trim();
        if (!s) return;
        if (seen.has(s)) return;
        seen.add(s);
        out.push(s);
    });
    return out;
}

function buildUniqueOptions({ correctAnswer, pools, desiredCount, allowDuplicates = false }) {
    const correct = String(correctAnswer ?? '').trim();
    if (!correct) return [];
    
    // Boşluk doldurma için allowDuplicates=true ise, tekrarlayan cevapları kaldırma
    const pool = allowDuplicates 
        ? [].concat(...(Array.isArray(pools) ? pools : [])).map(v => String(v ?? '').trim()).filter(Boolean)
        : uniqueStrings([].concat(...(Array.isArray(pools) ? pools : [])));
    
    // Doğru cevap dışındaki tüm seçenekler
    const distractors = pool.filter(a => a !== correct);
    
    // İhtiyaç olan çeldirici sayısı (toplam - 1, çünkü doğru cevap zaten var)
    const neededDistractors = Math.max(0, (desiredCount || 4) - 1);
    
    // Çeldiricileri karıştır ve al
    const picked = shuffleArray(distractors).slice(0, neededDistractors);
    
    // Doğru cevabı MUTLAKA ekle + seçilen çeldiriciler
    const combined = [correct, ...picked];
    
    // Karıştır ve döndür (uniqueStrings kullanma - zaten doğru cevap 1 kere, distractors zaten farklı)
    return shuffleArray(combined);
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function loadCachePayload() {
    if (!hasLocalStorage()) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const payload = safeJsonParse(raw);
    if (!payload || payload.v !== 1) return null;

    const u = payload.units;
    const q = payload.allQuestions;
    const a = payload.allAnswers;
    if (!Array.isArray(u) || !Array.isArray(q) || !Array.isArray(a)) return null;
    if (q.length !== a.length) return null;

    for (const unit of u) {
        if (!unit || typeof unit !== 'object') return null;
        if (!Array.isArray(unit.questions) || !Array.isArray(unit.answers)) return null;
        if (unit.questions.length !== unit.answers.length) return null;
    }

    return payload;
}

function refreshCacheButtons() {
    const useBtn = document.getElementById('btn-use-cache');
    const clearBtn = document.getElementById('btn-clear-cache');
    if (!useBtn || !clearBtn) return;

    const payload = loadCachePayload();
    const has = !!payload;
    useBtn.style.display = has ? 'inline-block' : 'none';
    clearBtn.style.display = has ? 'inline-block' : 'none';

    if (has) {
        const fn = payload.fileName ? ` (${payload.fileName})` : '';
        useBtn.textContent = `🕘 Son yüklenen dosyayı kullan${fn}`;
    }
}

function persistCache(fileNameForCache = '') {
    try {
        if (!hasLocalStorage()) {
            refreshCacheButtons();
            return;
        }
        const payload = {
            v: 1,
            savedAt: Date.now(),
            fileName: String(fileNameForCache || '').trim(),
            units,
            allQuestions,
            allAnswers
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch {
        // ignore (storage disabled/full)
    }
    refreshCacheButtons();
}

function clearCache() {
    try {
        if (!hasLocalStorage()) {
            refreshCacheButtons();
            return;
        }
        localStorage.removeItem(CACHE_KEY);
    } catch {
        // ignore
    }
    refreshCacheButtons();
}

// ===== İlerleme Takibi Fonksiyonları =====
function loadProgress() {
    if (!hasLocalStorage()) return {};
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function saveProgress(progressData) {
    if (!hasLocalStorage()) return;
    try {
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressData));
    } catch {
        // ignore
    }
}

function markUnitComplete(fileName, unitName, mode) {
    const progress = loadProgress();
    if (!progress[fileName]) {
        progress[fileName] = {};
    }
    if (!progress[fileName][unitName]) {
        progress[fileName][unitName] = {};
    }
    progress[fileName][unitName][mode] = true;
    saveProgress(progress);
}

function isUnitComplete(fileName, unitName, mode) {
    const progress = loadProgress();
    return !!(progress[fileName]?.[unitName]?.[mode]);
}

function getCompletedUnitsForFile(fileName) {
    const progress = loadProgress();
    return progress[fileName] || {};
}

function clearProgressForFile(fileName) {
    const progress = loadProgress();
    delete progress[fileName];
    saveProgress(progress);
}

function renderProgressSummary() {
    const summaryEl = document.getElementById('progress-summary');
    if (!summaryEl || !currentFileName || units.length <= 1) {
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }

    const completedUnits = getCompletedUnitsForFile(currentFileName);
    const hasAnyProgress = Object.keys(completedUnits).length > 0;

    if (!hasAnyProgress) {
        summaryEl.style.display = 'none';
        return;
    }

    const realUnits = units.filter(u => u.unitName !== 'Tüm Sorular');
    const modes = ['fillblank', 'multiple-choice', 'exam'];
    const modeNames = {
        'fillblank': '✍️ Boşluk',
        'multiple-choice': '✅ Çoktan',
        'exam': '📝 Sınav'
    };

    let html = '<h3>📊 İlerlemeniz</h3>';
    
    realUnits.forEach(unit => {
        const unitProgress = completedUnits[unit.unitName] || {};
        const completedModes = modes.filter(m => unitProgress[m]);
        
        if (completedModes.length > 0) {
            const badges = completedModes.map(m => 
                `<span class="progress-unit-badge completed">${modeNames[m]} ✓</span>`
            ).join('');
            
            html += `
                <div style="margin-top: 12px;">
                    <strong>${unit.unitName}:</strong>
                    <div class="progress-unit-list" style="margin-top: 6px;">${badges}</div>
                </div>
            `;
        }
    });

    summaryEl.innerHTML = html;
    summaryEl.style.display = 'block';
}

function restoreFromCache() {
    const payload = loadCachePayload();
    if (!payload) {
        alert('Cache bulunamadı veya bozulmuş. Lütfen dosyayı yeniden yükleyin.');
        refreshCacheButtons();
        return;
    }

    units = payload.units;
    allQuestions = payload.allQuestions;
    allAnswers = payload.allAnswers;

    questions = [...allQuestions];
    answers = [...allAnswers];
    currentUnit = null;
    selectedUnits = [];
    userAnswers = [];
    score = 0;
    currentQuestionIndex = 0;
    questionUnitNames = [];

    currentFileName = payload.fileName || '';
    fileName.textContent = payload.fileName || 'Son yüklenen dosya';
    if (units.length > 0) {
        questionCount.textContent = `${units.length} ünite, toplam ${allQuestions.length} soru bulundu`;
    } else {
        questionCount.textContent = `${allQuestions.length} soru bulundu`;
    }

    if (uploadArea && fileInfo && modeSelection) {
        uploadArea.style.display = 'none';
        fileInfo.style.display = 'flex';
        modeSelection.style.display = 'block';
    }

    if (typeof createModeCards === 'function') {
        try {
            createModeCards();
        } catch {
            // ignore (partial DOM)
        }
    }

    try {
        renderAnalysisSummary();
    } catch {
        // ignore
    }
}

function computeAnalysisSummary() {
    const realUnits = (units || []).filter(u => u && u.unitName !== 'Tüm Sorular');
    const unitCount = realUnits.length;
    const totalQuestions = (allQuestions || []).length;
    const totalAnswers = (allAnswers || []).length;

    const missingAnswers = (allAnswers || []).filter(a => !String(a ?? '').trim()).length;
    const uniqueAnswerCount = uniqueStrings(allAnswers || []).length;
    const duplicateAnswerCount = Math.max(0, totalAnswers - uniqueAnswerCount);

    const unitMismatches = realUnits
        .filter(u => Array.isArray(u.questions) && Array.isArray(u.answers) && u.questions.length !== u.answers.length)
        .map(u => `${u.unitName} (${u.questions.length}/${u.answers.length})`);

    const warnings = [];
    if (totalQuestions !== totalAnswers) warnings.push(`Soru/Cevap sayısı farklı: ${totalQuestions}/${totalAnswers}`);
    if (missingAnswers > 0) warnings.push(`Boş cevap: ${missingAnswers}`);
    if (unitMismatches.length > 0) warnings.push(`Ünite içi eşleşme sorunu: ${unitMismatches.join(', ')}`);

    return {
        unitCount,
        totalQuestions,
        totalAnswers,
        missingAnswers,
        duplicateAnswerCount,
        warnings
    };
}

function renderAnalysisSummary() {
    const el = document.getElementById('analysis-summary');
    if (!el) return;

    const hasData = Array.isArray(allQuestions) && allQuestions.length > 0;
    if (!hasData) {
        el.style.display = 'none';
        el.textContent = '';
        return;
    }

    const s = computeAnalysisSummary();
    const lines = [
        `Detaylı Analiz:`,
        `• Üniteler: ${s.unitCount}`,
        `• Sorular: ${s.totalQuestions}`,
        `• Cevaplar: ${s.totalAnswers}`,
        `• Boş cevap: ${s.missingAnswers}`,
        `• Tekrarlayan cevap metni: ${s.duplicateAnswerCount}`
    ];
    if (s.warnings.length > 0) {
        lines.push(`• Uyarı: ${s.warnings.join(' | ')}`);
    }

    el.textContent = lines.join('\n');
    el.style.display = 'block';
}

function setCurrentUnitLabel(labelText) {
    const fb = document.getElementById('fb-unit-label');
    const mc = document.getElementById('mc-unit-label');
    const ex = document.getElementById('exam-unit-label');
    const label = String(labelText || '').trim();
    const show = !!label;
    [fb, mc, ex].forEach((el) => {
        if (!el) return;
        el.textContent = label;
        el.style.display = show ? 'block' : 'none';
    });
}

function getUnitLabelForIndex(index) {
    const i = Number(index);
    if (!Number.isFinite(i) || i < 0) return '';
    const fromMap = questionUnitNames[i];
    if (fromMap) return fromMap;
    if (currentUnit?.unitName) return currentUnit.unitName;
    return '';
}

// DOM Elementleri
const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const questionCount = document.getElementById('question-count');
const removeFileBtn = document.getElementById('remove-file');
const modeSelection = document.getElementById('mode-selection');
const fillBlankGame = document.getElementById('fillblank-game');
const multipleChoiceGame = document.getElementById('multiple-choice-game');
const examGame = document.getElementById('exam-game');
const resultSection = document.getElementById('result-section');
const unitBulkGame = document.getElementById('unit-bulk-game');
const unitPicker = document.getElementById('unit-picker');

function isElementVisible(el) {
    if (!el) return false;
    try {
        if (typeof window !== 'undefined' && window.getComputedStyle) {
            return window.getComputedStyle(el).display !== 'none';
        }
    } catch {
        // ignore
    }
    return el.style.display !== 'none';
}

function hasLoadedFileData() {
    return (Array.isArray(allQuestions) && allQuestions.length > 0)
        || (Array.isArray(units) && units.length > 0);
}

function setFileInfoForGameplay(isGameplay) {
    if (!fileInfo) return;
    if (isGameplay) {
        fileInfo.style.display = 'none';
        return;
    }
    fileInfo.style.display = hasLoadedFileData() ? 'flex' : 'none';
}

// Cache buttons
const btnUseCache = document.getElementById('btn-use-cache');
const btnClearCache = document.getElementById('btn-clear-cache');
if (btnUseCache) btnUseCache.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    restoreFromCache();
});
if (btnClearCache) btnClearCache.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearCache();
});

refreshCacheButtons();

// Event Listeners - Upload
const uploadBtn = document.getElementById('btn-upload');
if (uploadBtn) {
    uploadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
}

uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.add('dragover');
});

uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('dragover');
});

uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.txt')) {
        processFile(file);
    } else {
        alert('⚠️ Lütfen sadece .txt dosyası yükleyin!');
    }
});

fileInput.addEventListener('change', handleFileSelect);
removeFileBtn.addEventListener('click', removeFile);

// Event Listeners - Oyun
document.getElementById('back-from-fillblank').addEventListener('click', backToModeSelection);
document.getElementById('back-from-mc').addEventListener('click', backToModeSelection);
document.getElementById('back-from-exam').addEventListener('click', backToModeSelection);
document.getElementById('back-from-unit-bulk').addEventListener('click', backToModeSelection);
document.getElementById('back-from-unit-picker').addEventListener('click', backToModeSelection);

document.getElementById('fb-check').addEventListener('click', checkFillBlankAnswer);
document.getElementById('fb-next').addEventListener('click', nextFillBlankQuestion);
const fbPrevBtn = document.getElementById('fb-prev');
if (fbPrevBtn) fbPrevBtn.addEventListener('click', prevFillBlankQuestion);

document.getElementById('mc-check').addEventListener('click', checkMultipleChoiceAnswer);
document.getElementById('mc-retry').addEventListener('click', retryMultipleChoiceQuestion);
document.getElementById('mc-next').addEventListener('click', nextMultipleChoiceQuestion);
const mcPrevBtn = document.getElementById('mc-prev');
if (mcPrevBtn) mcPrevBtn.addEventListener('click', prevMultipleChoiceQuestion);

document.getElementById('exam-prev').addEventListener('click', () => navigateExamQuestion(-1));
document.getElementById('exam-next').addEventListener('click', () => navigateExamQuestion(1));
document.getElementById('exam-mark').addEventListener('click', toggleMarkQuestion);
document.getElementById('exam-finish').addEventListener('click', finishExam);

document.getElementById('restart-same').addEventListener('click', restartSameTest);
document.getElementById('new-test').addEventListener('click', newTest);
document.getElementById('show-review').addEventListener('click', showReview);

document.getElementById('unit-bulk-toggle-mode').addEventListener('click', toggleUnitBulkMode);
document.getElementById('unit-bulk-check').addEventListener('click', checkUnitBulkExam);

document.getElementById('unit-select-all').addEventListener('click', () => setAllUnitCheckboxes(true));
document.getElementById('unit-clear-all').addEventListener('click', () => setAllUnitCheckboxes(false));
document.getElementById('unit-picker-start').addEventListener('click', startSelectedFromPicker);

// Dosya işleme
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.name.endsWith('.txt')) {
            processFile(file);
        } else {
            alert('⚠️ Lütfen sadece .txt dosyası seçin!');
            fileInput.value = '';
        }
    }
}

function processFile(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        parseQuestions(content);
        
        currentFileName = file.name;
        fileName.textContent = file.name;
        
        if (units.length > 0) {
            questionCount.textContent = `${units.length} ünite, toplam ${allQuestions.length} soru bulundu`;
        } else {
            questionCount.textContent = `${allQuestions.length} soru bulundu`;
        }
        
        uploadArea.style.display = 'none';
        fileInfo.style.display = 'flex';
        modeSelection.style.display = 'block';
        
        createModeCards();

        // Cache: tekrar upload zorunluluğunu kaldır
        persistCache(file.name);

        renderAnalysisSummary();
    };
    reader.readAsText(file, 'UTF-8');
}

function parseQuestions(content) {
    questions = [];
    answers = [];
    allQuestions = [];
    allAnswers = [];
    units = [];

    const normalized = String(content || '').replace(/\r\n/g, '\n');

    // 0) Ünite blokları (bazı dosyalarda başında "+" var, bazılarında yok) ve her ünitede ayrı cevap anahtarı
    // Bu formatta dosyada birden fazla "CEVAP ANAHTARI" vardır.
    const unitBlockHeaderRegex = /^\s*(?:\+\s*)?(\d+)\s*\.\s*(?:[ÜüUu])[Nn](?:[İIıi])[Tt][Ee]\s*:?.*$/gmi;
    const headerMatches = Array.from(normalized.matchAll(unitBlockHeaderRegex));
    const answerKeyCount = (normalized.match(/CEVAP\s*(?:LAR\s+)?ANAHTARI\s*:/ig) || []).length;

    if (headerMatches.length > 0 && answerKeyCount > 1) {
        for (let i = 0; i < headerMatches.length; i++) {
            const unitNo = headerMatches[i][1];
            const start = headerMatches[i].index;
            const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : normalized.length;
            const block = normalized.slice(start, end);

            const answerKeyMatch = block.match(/CEVAP\s*(?:LAR\s+)?ANAHTARI\s*:\s*(.+)/i);
            if (!answerKeyMatch) {
                continue;
            }

            const unitAnswers = answerKeyMatch[1]
                .split(',')
                .map(a => a.trim())
                .filter(Boolean);

            const beforeKey = block.substring(0, block.toLowerCase().indexOf(answerKeyMatch[0].toLowerCase()));
            const lines = beforeKey.split('\n').map(l => l.trim()).filter(Boolean);

            const unitQuestions = [];
            for (const line of lines) {
                // Ayraç çizgilerini ve başlık satırlarını atla
                if (/^-{10,}$/.test(line)) continue;
                if (line.startsWith('+')) continue;
                if (/^\s*\d+\s*\.\s*(?:[ÜüUu])[Nn](?:[İIıi])[Tt][Ee]/.test(line)) continue;

                const normalizedLine = line
                    .replace(/""\s*ve\s*""/g, '_______')
                    .replace(/“”\s*ve\s*“”/g, '_______');

                if (/_{3,}/.test(normalizedLine) && normalizedLine.length > 5) {
                    unitQuestions.push(normalizedLine);
                }
            }

            const mappedAnswers = unitQuestions.map((_, idx) => unitAnswers[idx] ?? '');
            if (unitQuestions.length > 0) {
                units.push({
                    unitName: `${unitNo}. Ünite`,
                    questions: unitQuestions,
                    answers: mappedAnswers
                });

                questions.push(...unitQuestions);
                answers.push(...mappedAnswers);
            }
        }
    } else {
        // Eski format (tek cevap anahtarı)
        const answerKeyMatch = normalized.match(/CEVAP\s*(?:LAR\s+)?ANAHTARI\s*:\s*(.+)/i);
        if (!answerKeyMatch) {
            alert('Cevap anahtarı bulunamadı! Dosya formatı hatalı.');
            return;
        }

        const answerKeyText = answerKeyMatch[1];
        answers = answerKeyText.split(',').map(a => a.trim()).filter(a => a);

        const questionsText = normalized.substring(0, answerKeyMatch.index);

        // 1) Ayraç ile ünite ayırma (----- gibi uzun çizgi)
        const separatorRegex = /\n\s*-{20,}\s*\n/g;
        const hasSeparator = separatorRegex.test(questionsText);

        const unitHeaderRegex = /^(\d+)\.\s*(?:[ÜüUu])[Nn](?:[İIıi])[Tt][Ee]/;

        let globalAnswerIndex = 0;

        if (hasSeparator) {
            const parts = questionsText.split(/\n\s*-{20,}\s*\n/);

            parts.forEach((part, partIndex) => {
                const rawLines = part.split(/\n/).map(l => l.trim()).filter(Boolean);
                if (rawLines.length === 0) return;

                let inferredUnitName = `${partIndex + 1}. Ünite`;
                for (const l of rawLines.slice(0, 5)) {
                    const m = l.match(unitHeaderRegex);
                    if (m) {
                        inferredUnitName = `${m[1]}. Ünite`;
                        break;
                    }
                }

                const unitQuestions = [];
                const unitAnswerIndices = [];

                rawLines.forEach((line) => {
                    const normalizedLine = line
                        .replace(/""\s*ve\s*""/g, '_______')
                        .replace(/“”\s*ve\s*“”/g, '_______');

                    if (/_{3,}/.test(normalizedLine) && normalizedLine.length > 5) {
                        questions.push(normalizedLine);
                        unitQuestions.push(normalizedLine);
                        unitAnswerIndices.push(globalAnswerIndex);
                        globalAnswerIndex++;
                    }
                });

                if (unitQuestions.length > 0) {
                    units.push({
                        unitName: inferredUnitName,
                        questions: unitQuestions,
                        answers: unitAnswerIndices.map(idx => answers[idx])
                    });
                }
            });
        } else {
            // 2) Satır satır ünite başlığı ile ayırma
            const lines = questionsText.split(/\n/);

            let currentUnitName = null;
            let currentUnitQuestions = [];
            let currentUnitAnswerIndices = [];

            for (let line of lines) {
                line = line.trim();

                const unitMatch = line.match(unitHeaderRegex);

                if (unitMatch) {
                    if (currentUnitName && currentUnitQuestions.length > 0) {
                        const unitAnswers = currentUnitAnswerIndices.map(idx => answers[idx]);
                        units.push({
                            unitName: currentUnitName,
                            questions: currentUnitQuestions,
                            answers: unitAnswers
                        });
                    }

                    currentUnitName = `${unitMatch[1]}. Ünite`;
                    currentUnitQuestions = [];
                    currentUnitAnswerIndices = [];
                } else {
                    const normalizedLine = line
                        .replace(/""\s*ve\s*""/g, '_______')
                        .replace(/“”\s*ve\s*“”/g, '_______');

                    if (/_{3,}/.test(normalizedLine) && normalizedLine.length > 5) {
                        questions.push(normalizedLine);
                        currentUnitQuestions.push(normalizedLine);
                        currentUnitAnswerIndices.push(globalAnswerIndex);
                        globalAnswerIndex++;
                    }
                }
            }

            if (currentUnitName && currentUnitQuestions.length > 0) {
                const unitAnswers = currentUnitAnswerIndices.map(idx => answers[idx]);
                units.push({
                    unitName: currentUnitName,
                    questions: currentUnitQuestions,
                    answers: unitAnswers
                });
            }
        }
    }
    
    if (units.length === 0 && questions.length > 0) {
        units.push({
            unitName: 'Tüm Sorular',
            questions: questions,
            answers: answers
        });
    }

    // Aktif set varsayılan: tüm sorular
    allQuestions = [...questions];
    allAnswers = [...answers];
    questions = [...allQuestions];
    answers = [...allAnswers];
    selectedUnits = [];
    questionUnitNames = [];
    
    console.log('Toplam ünite:', units.length);
    console.log('Toplam soru:', questions.length);
}

function splitAnswerParts(answerText) {
    const raw = (answerText || '').trim();
    if (!raw) return [];
    const parts = raw.split(/\s*(?:\||;|,)\s*/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : [raw];
}

function normalizeText(text) {
    return (text || '').trim();
}

function setFeedback(el, message, type) {
    el.textContent = message;
    el.className = `feedback-message ${type}`;
    el.style.display = 'block';
}

function hideFeedback(el) {
    el.style.display = 'none';
}

function removeFile() {
    const inFlow = hasLoadedFileData() && !isElementVisible(modeSelection);
    if (inFlow) {
        const ok = confirm('Devam eden çalışma/sınav var. Dosyayı silersen ilerlemen sıfırlanır. Devam edilsin mi?');
        if (!ok) return;
    }

    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (mcAutoAdvanceTimer) {
        clearTimeout(mcAutoAdvanceTimer);
        mcAutoAdvanceTimer = null;
    }

    if (typeof hideAllGameSections === 'function') {
        hideAllGameSections();
    }
    const reviewSection = document.getElementById('review-section');
    if (reviewSection) reviewSection.style.display = 'none';

    fileInput.value = '';
    uploadArea.style.display = 'block';
    fileInfo.style.display = 'none';
    modeSelection.style.display = 'none';
    questions = [];
    answers = [];
    allQuestions = [];
    allAnswers = [];
    units = [];
    selectedUnits = [];
    questionUnitNames = [];
    currentMode = '';
    currentUnit = null;
    currentQuestionIndex = 0;
    score = 0;
    userAnswers = [];
    bulkState = null;
    currentFileName = '';
    setCurrentUnitLabel('');

    refreshCacheButtons();
    renderAnalysisSummary();
}

// Mod kartlarını dinamik oluştur
function createModeCards() {
    const modeCards = document.querySelector('.mode-cards');
    modeCards.innerHTML = '';

    // İlerleme özeti göster
    renderProgressSummary();

    // Toplu boşluk doldurma (ünite seçmeli)
    if (units.length > 1) {
        const bulkCard = document.createElement('div');
        bulkCard.className = 'mode-card unit-card';
        bulkCard.innerHTML = `
            <div class="mode-icon">🧩</div>
            <h3>Boşluk Doldurma (Toplu)</h3>
            <p>Ünite seç → sorular alt alta</p>
            <ul class="mode-features">
                <li>✓ Tekil veya çoğul ünite seç</li>
                <li>✓ Tıkla veya sürükle</li>
            </ul>
            <button class="btn-primary">Ünite Seç</button>
        `;
        bulkCard.addEventListener('click', () => openUnitPicker('unit-bulk-practice'));
        modeCards.appendChild(bulkCard);
    }
    
    // Genel modlar
    const generalModes = [
        {
            icon: '✍️',
            title: 'Tüm Sorular - Boşluk Doldurma',
            description: 'Tüm sorularla çalış',
            features: ['Tüm üniteler', 'Karışık sıralama'],
            mode: 'fillblank'
        },
        {
            icon: '✅',
            title: 'Çoktan Seçmeli',
            description: 'Doğru şıkkı işaretleyerek çöz',
            features: ['4 şıklı sorular', 'Anında feedback'],
            mode: 'multiple-choice'
        },
        {
            icon: '📝',
            title: 'Deneme Sınavı',
            description: 'Tam sınav deneyimi',
            features: ['Tüm sorular', 'Zamanlı mod'],
            mode: 'exam'
        }
    ];
    
    generalModes.forEach(m => {
        const card = document.createElement('div');
        card.className = 'mode-card';
        card.innerHTML = `
            <div class="mode-icon">${m.icon}</div>
            <h3>${m.title}</h3>
            <p>${m.description}</p>
            <ul class="mode-features">
                ${m.features.map(f => `<li>✓ ${f}</li>`).join('')}
            </ul>
            <button class="btn-primary">Başla</button>
        `;
        
        card.addEventListener('click', () => {
            if (units.length > 1) {
                openUnitPicker(m.mode);
            } else {
                startGame(m.mode, { fromPicker: true });
            }
        });
        modeCards.appendChild(card);
    });
}

// Oyun başlatma
function startGame(mode, options = {}) {
    currentMode = mode;
    currentQuestionIndex = 0;
    score = 0;
    userAnswers = [];
    attemptCount = 0;
    fbAnswerStates = [];
    mcAnswerStates = [];

    setCurrentUnitLabel('');

    // Oyun/picker sırasında üstteki dosya bar'ını gizle (yanlışlıkla silmeyi önle)
    setFileInfoForGameplay(true);

    modeSelection.style.display = 'none';

    if (!options.fromPicker && (mode === 'fillblank' || mode === 'multiple-choice' || mode === 'exam' || mode === 'unit-bulk-practice' || mode === 'unit-bulk-exam')) {
        if (units.length > 1) {
            openUnitPicker(mode);
            return;
        }
    }
    
    if (mode === 'unit-bulk-practice') {
        unitBulkGame.style.display = 'block';
        renderUnitBulk(false);
    } else if (mode === 'unit-bulk-exam') {
        unitBulkGame.style.display = 'block';
        renderUnitBulk(true);
    } else if (mode === 'unit-fillblank') {
        fillBlankGame.style.display = 'block';
        document.getElementById('fb-total-questions').textContent = currentUnit.questions.length;
        document.getElementById('fb-score').textContent = '0';
        fbAnswerStates = new Array(currentUnit.questions.length).fill(null);
        loadUnitFillBlankQuestion();
    } else if (mode === 'fillblank') {
        currentUnit = null;
        fillBlankGame.style.display = 'block';
        document.getElementById('fb-total-questions').textContent = questions.length;
        document.getElementById('fb-score').textContent = '0';
        fbAnswerStates = new Array(questions.length).fill(null);
        loadFillBlankQuestion();
    } else if (mode === 'multiple-choice') {
        multipleChoiceGame.style.display = 'block';
        document.getElementById('mc-total-questions').textContent = questions.length;
        document.getElementById('mc-score').textContent = '0';
        mcAnswerStates = new Array(questions.length).fill(null);
        loadMultipleChoiceQuestion();
    } else if (mode === 'exam') {
        examGame.style.display = 'block';
        document.getElementById('exam-total-questions').textContent = questions.length;
        examAnswers = new Array(questions.length).fill(null);
        markedQuestions = new Set();
        examStartTime = Date.now();
        startTimer();
        loadExamQuestion();
        createQuestionGrid();
    }
}

function openUnitPicker(targetMode) {
    hideAllGameSections();
    unitPicker.style.display = 'block';

    // Ünite seçimi de akışın bir parçası: üst bar gizli kalsın
    setFileInfoForGameplay(true);

    const titleEl = document.getElementById('unit-picker-title');
    const feedbackEl = document.getElementById('unit-picker-feedback');
    hideFeedback(feedbackEl);

    const modeNameMap = {
        'unit-bulk-practice': 'Boşluk Doldurma (Toplu) - Çalışma',
        'unit-bulk-exam': 'Boşluk Doldurma (Toplu) - Sınav',
        'fillblank': 'Boşluk Doldurma',
        'multiple-choice': 'Çoktan Seçmeli',
        'exam': 'Deneme Sınavı'
    };
    titleEl.textContent = modeNameMap[targetMode] || 'Ünite Seç';

    unitPicker.dataset.targetMode = targetMode;

    const list = document.getElementById('unit-picker-list');
    list.innerHTML = '';

    units
        .filter(u => u.unitName !== 'Tüm Sorular')
        .forEach((unit, index) => {
            const id = `unit-cb-${index}`;
            
            // Ünitenin tamamlanma durumunu kontrol et
            const isCompleted = currentFileName && isUnitComplete(currentFileName, unit.unitName, targetMode);
            const completionMark = isCompleted ? ' <span style="color: var(--success-color); font-weight: bold;">✓</span>' : '';
            
            const row = document.createElement('div');
            row.className = 'unit-picker-item';
            row.innerHTML = `
                <div class="unit-picker-left">
                    <input type="checkbox" id="${id}" class="unit-checkbox" data-unit-index="${index}">
                    <div>
                        <label for="${id}">${unit.unitName}${completionMark}</label>
                        <div class="unit-picker-meta">${unit.questions.length} soru</div>
                    </div>
                </div>
                <button class="btn-primary unit-quick-start" data-quick-unit="${index}">Hızlı Başla</button>
            `;

            row.querySelector('.unit-quick-start').addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startWithUnitSelection(targetMode, [index]);
            });

            list.appendChild(row);
        });

    // varsayılan: hepsi seçili
    setAllUnitCheckboxes(true);

    try {
        unitPicker.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
        // ignore
    }
}

function setAllUnitCheckboxes(checked) {
    const boxes = document.querySelectorAll('.unit-checkbox');
    boxes.forEach(cb => {
        cb.checked = checked;
    });
}

function startSelectedFromPicker() {
    const targetMode = unitPicker.dataset.targetMode;
    const feedbackEl = document.getElementById('unit-picker-feedback');
    hideFeedback(feedbackEl);

    const selected = Array.from(document.querySelectorAll('.unit-checkbox'))
        .filter(cb => cb.checked)
        .map(cb => Number(cb.dataset.unitIndex));

    if (selected.length === 0) {
        setFeedback(feedbackEl, '⚠️ En az 1 ünite seçmelisiniz.', 'info');
        setTimeout(() => hideFeedback(feedbackEl), 2500);
        return;
    }

    startWithUnitSelection(targetMode, selected);
}

function startWithUnitSelection(targetMode, unitIndexes) {
    selectedUnits = unitIndexes;

    const picked = unitIndexes.map(i => units.filter(u => u.unitName !== 'Tüm Sorular')[i]).filter(Boolean);
    const mergedQuestions = [];
    const mergedAnswers = [];
    const mergedUnitNames = [];
    picked.forEach(u => {
        mergedQuestions.push(...u.questions);
        mergedAnswers.push(...u.answers);
        mergedUnitNames.push(...new Array(u.questions.length).fill(u.unitName));
    });

    // Aktif soru seti: seçilen üniteler
    questions = mergedQuestions;
    answers = mergedAnswers;
    questionUnitNames = mergedUnitNames;

    // Toplu mod için currentUnit'u seçilenlere göre sanal bir ünite yap
    if (targetMode === 'unit-bulk-practice' || targetMode === 'unit-bulk-exam') {
        const unitNames = picked.map(u => u.unitName).join(', ');
        currentUnit = {
            unitName: unitIndexes.length === 1 ? picked[0].unitName : `Seçilen Üniteler: ${unitNames}`,
            questions: mergedQuestions,
            answers: mergedAnswers
        };
        hideAllGameSections();
        startGame(targetMode, { fromPicker: true });
        return;
    }

    currentUnit = null;
    hideAllGameSections();
    startGame(targetMode, { fromPicker: true });
}

function hideAllGameSections() {
    fillBlankGame.style.display = 'none';
    multipleChoiceGame.style.display = 'none';
    examGame.style.display = 'none';
    resultSection.style.display = 'none';
    unitBulkGame.style.display = 'none';
    unitPicker.style.display = 'none';
}

function toggleUnitBulkMode() {
    if (!currentUnit) return;
    if (currentMode === 'unit-bulk-exam') {
        startGame('unit-bulk-practice');
    } else {
        startGame('unit-bulk-exam');
    }
}

function renderUnitBulk(examMode) {
    if (!currentUnit) return;

    const titleEl = document.getElementById('unit-bulk-title');
    titleEl.textContent = `${currentUnit.unitName} (${currentUnit.questions.length} soru)`;

    const feedbackEl = document.getElementById('unit-bulk-feedback');
    hideFeedback(feedbackEl);

    const toggleBtn = document.getElementById('unit-bulk-toggle-mode');
    const checkBtn = document.getElementById('unit-bulk-check');
    toggleBtn.textContent = examMode ? 'Çalışma Modu' : 'Sınav Modu';
    checkBtn.style.display = examMode ? 'inline-block' : 'none';

    const indices = currentUnit.questions.map((_, i) => i).sort(() => Math.random() - 0.5);
    bulkState = {
        unit: currentUnit,
        indices,
        examMode,
        checkedOnce: false
    };

    renderUnitBulkAnswerBank(currentUnit.answers);
    renderUnitBulkQuestions();
}

function renderUnitBulkAnswerBank(unitAnswers) {
    const container = document.getElementById('unit-bulk-options');
    container.innerHTML = '';

    // BÜTÜN cevapları kullan (unique yapma) - aynı cevap birden fazla sorunun yanıtı olabilir
    const answersWithId = unitAnswers.map((text, index) => ({ id: `a${index}`, text }));
    const shuffled = shuffleArray(answersWithId);

    shuffled.forEach((a) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'answer-option';
        optionDiv.textContent = a.text;
        optionDiv.draggable = true;
        optionDiv.dataset.answer = a.text;
        optionDiv.dataset.answerId = a.id;

        optionDiv.addEventListener('dragstart', handleDragStart);
        optionDiv.addEventListener('dragend', handleDragEnd);
        optionDiv.addEventListener('click', handleOptionClick);

        container.appendChild(optionDiv);
    });
}

function renderUnitBulkQuestions() {
    const listEl = document.getElementById('unit-bulk-questions');
    listEl.innerHTML = '';

    const unit = bulkState?.unit;
    if (!unit) return;

    bulkState.indices.forEach((unitQuestionIndex, displayIndex) => {
        const questionText = unit.questions[unitQuestionIndex];
        const answerText = unit.answers[unitQuestionIndex];
        const expectedParts = splitAnswerParts(answerText);

        let blankIndex = 0;
        const html = questionText.replace(/_{3,}/g, () => {
            const expected = expectedParts[Math.min(blankIndex, expectedParts.length - 1)] || normalizeText(answerText);
            const span = `<span class="blank bulk-blank" data-uq="${unitQuestionIndex}" data-b="${blankIndex}" data-expected="${escapeHtml(expected)}"></span>`;
            blankIndex++;
            return span;
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'bulk-question-item';
        wrapper.innerHTML = `
            <div class="bulk-question-meta">Soru ${displayIndex + 1}</div>
            <div class="bulk-question-text">${html}</div>
        `;

        listEl.appendChild(wrapper);
    });

    const blanks = document.querySelectorAll('.bulk-blank');
    blanks.forEach((blank) => {
        blank.addEventListener('dragover', handleBlankDragOver);
        blank.addEventListener('dragleave', handleBlankDragLeave);
        blank.addEventListener('drop', handleUnitBulkBlankDrop);
        blank.addEventListener('click', handleUnitBulkBlankClick);
        blank.addEventListener('touchstart', handleUnitBulkBlankClick);
    });
}

function handleUnitBulkBlankDrop(e) {
    e.preventDefault();
    e.target.classList.remove('drop-target');

    if (!draggedElement || e.target.classList.contains('filled')) return;
    if (e.target.classList.contains('correct')) return;
    if (draggedElement.classList.contains('used')) return;

    fillUnitBulkBlankFromOption(e.target, draggedElement);
}

function handleUnitBulkBlankClick(e) {
    e.preventDefault();

    const blank = e.target;
    if (blank.classList.contains('filled') && blank.classList.contains('correct')) {
        return;
    }
    if (blank.classList.contains('filled')) {
        clearUnitBulkBlank(blank);
        return;
    }

    if (!selectedOption) return;
    if (selectedOption.classList.contains('used')) return;

    fillUnitBulkBlankFromOption(blank, selectedOption);
    selectedOption.classList.remove('selected-option');
    selectedOption = null;
}

function fillUnitBulkBlankFromOption(blankEl, optionEl) {
    blankEl.textContent = optionEl.textContent;
    blankEl.classList.add('filled');
    blankEl.dataset.filledAnswerId = optionEl.dataset.answerId || '';
    blankEl.dataset.filledAnswer = optionEl.textContent;

    if (bulkState?.examMode && bulkState.checkedOnce) {
        blankEl.classList.remove('correct', 'wrong');
    }

    optionEl.classList.add('used');
    optionEl.classList.remove('selected-option');

    if (!bulkState?.examMode) {
        markUnitBulkBlankImmediate(blankEl);
    }
}

function clearUnitBulkBlank(blankEl) {
    if (blankEl.classList.contains('correct')) {
        return;
    }
    const answerId = blankEl.dataset.filledAnswerId;
    blankEl.textContent = '';
    blankEl.classList.remove('filled', 'correct', 'wrong');
    blankEl.dataset.filledAnswerId = '';
    blankEl.dataset.filledAnswer = '';

    if (answerId) {
        const options = document.querySelectorAll('#unit-bulk-options .answer-option');
        options.forEach((opt) => {
            if (opt.dataset.answerId === answerId) {
                opt.classList.remove('used');
            }
        });
    }

    if (bulkState?.examMode && bulkState.checkedOnce) {
        blankEl.classList.remove('correct', 'wrong');
    }
}

function markUnitBulkBlankImmediate(blankEl) {
    const expected = normalizeText(blankEl.dataset.expected);
    const actual = normalizeText(blankEl.textContent);

    if (!actual) return;

    if (actual === expected) {
        blankEl.classList.add('correct');
        blankEl.classList.remove('wrong');
    } else {
        blankEl.classList.add('wrong');
        blankEl.classList.remove('correct');
        blankEl.classList.add('shake');
        setTimeout(() => blankEl.classList.remove('shake'), 400);
    }
}

function checkUnitBulkExam() {
    if (!bulkState?.examMode) return;

    const feedbackEl = document.getElementById('unit-bulk-feedback');
    hideFeedback(feedbackEl);

    const blanks = Array.from(document.querySelectorAll('.bulk-blank'));
    const unfilled = blanks.filter(b => !normalizeText(b.textContent));
    if (unfilled.length > 0) {
        setFeedback(feedbackEl, '⚠️ Lütfen tüm boşlukları doldurun!', 'info');
        setTimeout(() => hideFeedback(feedbackEl), 2500);
        return;
    }

    let correctCount = 0;
    blanks.forEach((blankEl) => {
        const expected = normalizeText(blankEl.dataset.expected);
        const actual = normalizeText(blankEl.textContent);

        if (actual === expected) {
            correctCount++;
            blankEl.classList.add('correct');
            blankEl.classList.remove('wrong');
        } else {
            blankEl.classList.add('wrong');
            blankEl.classList.remove('correct');
        }
    });

    bulkState.checkedOnce = true;
    const total = blanks.length;
    const wrongCount = total - correctCount;
    const pct = Math.round((correctCount / total) * 100);

    if (wrongCount === 0) {
        setFeedback(feedbackEl, `🎉 Harika! ${correctCount}/${total} doğru (%${pct})`, 'success');
    } else {
        setFeedback(feedbackEl, `✅ ${correctCount}/${total} doğru, ❌ ${wrongCount} yanlış (%${pct})`, 'error');
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Boşluk Doldurma - Genel
function loadFillBlankQuestion() {
    if (currentQuestionIndex >= questions.length) {
        showResults();
        return;
    }
    
    loadFillBlankQuestionHelper(questions[currentQuestionIndex], answers[currentQuestionIndex], answers);
}

// Boşluk Doldurma - Ünite
function loadUnitFillBlankQuestion() {
    if (currentQuestionIndex >= currentUnit.questions.length) {
        showResults();
        return;
    }
    
    loadFillBlankQuestionHelper(currentUnit.questions[currentQuestionIndex], currentUnit.answers[currentQuestionIndex], currentUnit.answers);
}

function loadFillBlankQuestionHelper(question, correctAnswer, allAnswers) {
    document.getElementById('fb-current-question').textContent = currentQuestionIndex + 1;
    setCurrentUnitLabel(getUnitLabelForIndex(currentQuestionIndex));
    const fbPrev = document.getElementById('fb-prev');
    if (fbPrev) fbPrev.disabled = currentQuestionIndex === 0;
    
    const questionContainer = document.getElementById('fb-question');
    
    let blankIndex = 0;
    const questionHTML = question.replace(/_{3,}/g, () => {
        return `<span class="blank" data-index="${blankIndex++}"></span>`;
    });
    
    questionContainer.innerHTML = questionHTML;
    
    const state = fbAnswerStates[currentQuestionIndex] || (fbAnswerStates[currentQuestionIndex] = {});
    let allOptions = state.options;
    if (!Array.isArray(allOptions)) {
        allOptions = buildUniqueOptions({
            correctAnswer,
            pools: [allAnswers, answers, allAnswers],
            desiredCount: 4,
            allowDuplicates: true  // Boşluk doldurma için tekrarlayan cevaplara izin ver
        });
        state.options = allOptions;
    }
    
    const optionsContainer = document.getElementById('fb-options');
    optionsContainer.innerHTML = '';
    
    allOptions.forEach(option => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'answer-option';
        optionDiv.textContent = option;
        optionDiv.draggable = true;
        optionDiv.dataset.answer = option;
        
        optionDiv.addEventListener('dragstart', handleDragStart);
        optionDiv.addEventListener('dragend', handleDragEnd);
        optionDiv.addEventListener('click', handleOptionClick);
        
        optionsContainer.appendChild(optionDiv);
    });
    
    const blanks = questionContainer.querySelectorAll('.blank');
    blanks.forEach(blank => {
        blank.addEventListener('dragover', handleBlankDragOver);
        blank.addEventListener('dragleave', handleBlankDragLeave);
        blank.addEventListener('drop', handleBlankDrop);
        blank.addEventListener('click', handleBlankClick);
        blank.addEventListener('touchstart', handleBlankClick);
    });

    // Restore previous answer (if any)
    if (state.userAnswer) {
        const firstBlank = blanks[0];
        if (firstBlank) {
            firstBlank.textContent = state.userAnswer;
            firstBlank.classList.add('filled');

            const options = document.querySelectorAll('#fb-options .answer-option');
            options.forEach(opt => {
                if (opt.textContent === state.userAnswer) {
                    opt.classList.add('used');
                }
            });
        }
    }

    const checkedAndCorrect = !!state.checked && state.correct === true;
    document.getElementById('fb-check').style.display = checkedAndCorrect ? 'none' : 'inline-block';
    document.getElementById('fb-next').style.display = checkedAndCorrect ? 'inline-block' : 'none';

    if (checkedAndCorrect) {
        blanks.forEach((b) => {
            b.classList.add('correct');
            b.classList.remove('wrong');
        });
        const options = document.querySelectorAll('#fb-options .answer-option');
        options.forEach(option => {
            option.draggable = false;
            option.style.opacity = '0.5';
        });
    }
}

// Drag & Drop handlers
function handleDragStart(e) {
    draggedElement = e.target;
    e.target.classList.add('dragging');
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
}

function handleOptionClick(e) {
    if (e.target.classList.contains('used')) return;
    
    const allOptions = document.querySelectorAll('.answer-option');
    allOptions.forEach(opt => opt.classList.remove('selected-option'));
    
    e.target.classList.add('selected-option');
    selectedOption = e.target;
}

function handleBlankDragOver(e) {
    e.preventDefault();
    e.target.classList.add('drop-target');
}

function handleBlankDragLeave(e) {
    e.target.classList.remove('drop-target');
}

function handleBlankDrop(e) {
    e.preventDefault();
    e.target.classList.remove('drop-target');

    if (e.target.classList.contains('correct')) return;
    
    if (draggedElement && !e.target.classList.contains('filled')) {
        e.target.textContent = draggedElement.textContent;
        e.target.classList.add('filled');
        draggedElement.classList.add('used');
    }
}

function handleBlankClick(e) {
    e.preventDefault();

    if (e.target.classList.contains('filled') && e.target.classList.contains('correct')) {
        return;
    }
    
    if (e.target.classList.contains('filled')) {
        const text = e.target.textContent;
        e.target.textContent = '';
        e.target.classList.remove('filled', 'correct', 'wrong');
        
        const options = document.querySelectorAll('.answer-option');
        options.forEach(option => {
            if (option.textContent === text) {
                option.classList.remove('used');
            }
        });
    } else if (selectedOption && !e.target.classList.contains('filled')) {
        e.target.textContent = selectedOption.textContent;
        e.target.classList.add('filled');
        selectedOption.classList.add('used');
        selectedOption.classList.remove('selected-option');
        selectedOption = null;
    }
}

function checkFillBlankAnswer() {
    const questionContainer = document.getElementById('fb-question');
    const blanks = questionContainer.querySelectorAll('.blank');
    const feedbackEl = document.getElementById('fb-feedback');
    
    const correctAnswer = currentUnit 
        ? currentUnit.answers[currentQuestionIndex] 
        : answers[currentQuestionIndex];
    
    let isCorrect = true;
    let allFilled = true;
    
    blanks.forEach(blank => {
        const userAnswer = blank.textContent.trim();
        
        if (!userAnswer) {
            allFilled = false;
            return;
        }
        
        if (userAnswer === correctAnswer) {
            blank.classList.add('correct');
            blank.classList.remove('wrong');
        } else {
            blank.classList.add('wrong');
            blank.classList.remove('correct');
            isCorrect = false;
            blank.classList.add('shake');
            setTimeout(() => blank.classList.remove('shake'), 400);
        }
    });
    
    if (!allFilled) {
        feedbackEl.textContent = '⚠️ Lütfen tüm boşlukları doldurun!';
        feedbackEl.className = 'feedback-message info';
        feedbackEl.style.display = 'block';
        setTimeout(() => feedbackEl.style.display = 'none', 3000);
        return;
    }
    
    if (isCorrect) {
        const state = fbAnswerStates[currentQuestionIndex] || (fbAnswerStates[currentQuestionIndex] = {});
        state.checked = true;
        state.correct = true;
        state.userAnswer = blanks[0]?.textContent.trim() || '';
        score = fbAnswerStates.filter(s => s && s.correct).length;
        document.getElementById('fb-score').textContent = score;
        feedbackEl.textContent = '🎉 Harika! Doğru cevap!';
        feedbackEl.className = 'feedback-message success';
        feedbackEl.style.display = 'block';
    } else {
        const state = fbAnswerStates[currentQuestionIndex] || (fbAnswerStates[currentQuestionIndex] = {});
        state.checked = true;
        state.correct = false;
        state.userAnswer = blanks[0]?.textContent.trim() || '';
        score = fbAnswerStates.filter(s => s && s.correct).length;
        document.getElementById('fb-score').textContent = score;
        feedbackEl.textContent = `❌ Yanlış! Doğru cevap: ${correctAnswer}`;
        feedbackEl.className = 'feedback-message error';
        feedbackEl.style.display = 'block';
    }
    
    const currentQuestion = currentUnit 
        ? currentUnit.questions[currentQuestionIndex] 
        : questions[currentQuestionIndex];
    
    userAnswers[currentQuestionIndex] = {
        question: currentQuestion,
        userAnswer: blanks[0]?.textContent.trim() || '',
        correctAnswer: correctAnswer,
        correct: isCorrect,
        index: currentQuestionIndex
    };
    
    document.getElementById('fb-check').style.display = 'none';
    document.getElementById('fb-next').style.display = 'inline-block';
    
    const options = document.querySelectorAll('.answer-option');
    options.forEach(option => {
        option.draggable = false;
        option.style.opacity = '0.5';
    });
}

function nextFillBlankQuestion() {
    currentQuestionIndex++;
    document.getElementById('fb-feedback').style.display = 'none';
    
    if (currentUnit) {
        loadUnitFillBlankQuestion();
    } else {
        loadFillBlankQuestion();
    }
}

function prevFillBlankQuestion() {
    if (currentQuestionIndex <= 0) return;
    currentQuestionIndex--;
    document.getElementById('fb-feedback').style.display = 'none';

    if (currentUnit) {
        loadUnitFillBlankQuestion();
    } else {
        loadFillBlankQuestion();
    }
}

// Çoktan Seçmeli
function loadMultipleChoiceQuestion() {
    if (mcAutoAdvanceTimer) {
        clearTimeout(mcAutoAdvanceTimer);
        mcAutoAdvanceTimer = null;
    }
    if (currentQuestionIndex >= questions.length) {
        showResults();
        return;
    }
    
    document.getElementById('mc-current-question').textContent = currentQuestionIndex + 1;
    setCurrentUnitLabel(getUnitLabelForIndex(currentQuestionIndex));
    const mcPrev = document.getElementById('mc-prev');
    if (mcPrev) mcPrev.disabled = currentQuestionIndex === 0;
    
    const question = questions[currentQuestionIndex];
    const correctAnswer = answers[currentQuestionIndex];
    
    const questionText = question.replace(/_{3,}/g, '...');
    document.getElementById('mc-question').textContent = questionText;
    
    const state = mcAnswerStates[currentQuestionIndex] || (mcAnswerStates[currentQuestionIndex] = {});
    let allOptions = state.options;
    if (!Array.isArray(allOptions)) {
        allOptions = buildUniqueOptions({
            correctAnswer,
            pools: [answers, allAnswers, currentUnit?.answers || []],
            desiredCount: 4
        });
        state.options = allOptions;
    }
    
    const optionsContainer = document.getElementById('mc-options');
    optionsContainer.innerHTML = '';
    
    allOptions.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'mc-option';
        optionDiv.textContent = `${String.fromCharCode(65 + index)}) ${option}`;
        optionDiv.dataset.answer = option;
        
        optionDiv.addEventListener('click', handleMCOptionClick);
        
        optionsContainer.appendChild(optionDiv);
    });

    // Restore selection/state
    if (state.selectedAnswer) {
        const opts = document.querySelectorAll('#mc-options .mc-option');
        opts.forEach((opt) => {
            if (opt.dataset.answer === state.selectedAnswer) {
                opt.classList.add('selected');
            }
        });
    }

    const resolved = state.resolved === true;
    // Dinamik mod: şık seçince otomatik kontrol
    document.getElementById('mc-check').style.display = 'none';
    document.getElementById('mc-retry').style.display = 'none';
    document.getElementById('mc-next').style.display = resolved ? 'inline-block' : 'none';

    attemptCount = Number.isFinite(state.attemptsUsed) ? state.attemptsUsed : 0;

    if (resolved) {
        const opts = document.querySelectorAll('#mc-options .mc-option');
        opts.forEach((opt) => {
            opt.classList.add('disabled');
            if (opt.dataset.answer === correctAnswer) {
                opt.classList.add('correct');
            }
        });
        if (state.selectedAnswer && state.selectedAnswer !== correctAnswer) {
            opts.forEach((opt) => {
                if (opt.dataset.answer === state.selectedAnswer) {
                    opt.classList.add('wrong');
                }
            });
        }
    }
}

function handleMCOptionClick(e) {
    if (e.target.classList.contains('disabled')) return;

    // Aynı seçeneğe tekrar tekrar basıp deneme hakkını yemesin
    if (e.target.classList.contains('selected')) return;

    const state = mcAnswerStates[currentQuestionIndex] || (mcAnswerStates[currentQuestionIndex] = {});
    if (state.resolved === true) return;
    
    const options = document.querySelectorAll('.mc-option');
    options.forEach(opt => opt.classList.remove('selected', 'wrong'));
    
    e.target.classList.add('selected');

    // Şık seçimi -> otomatik kontrol
    evaluateMultipleChoiceSelection(e.target);
}

function evaluateMultipleChoiceSelection(selectedOptionEl) {
    const feedbackEl = document.getElementById('mc-feedback');
    const options = document.querySelectorAll('.mc-option');
    const correctAnswer = answers[currentQuestionIndex];
    const userAnswer = selectedOptionEl?.dataset?.answer;

    if (!userAnswer) return;

    const state = mcAnswerStates[currentQuestionIndex] || (mcAnswerStates[currentQuestionIndex] = {});
    state.selectedAnswer = userAnswer;

    attemptCount++;
    state.attemptsUsed = attemptCount;

    // doğru
    if (userAnswer === correctAnswer) {
        try {
            if (navigator?.vibrate) navigator.vibrate(15);
        } catch {
            // ignore
        }
        options.forEach(option => {
            option.classList.add('disabled');
            if (option.dataset.answer === correctAnswer) {
                option.classList.add('correct');
                option.classList.add('pulse');
            }
        });

        state.resolved = true;
        state.correct = true;

        score = mcAnswerStates.filter(s => s && s.correct).length;
        document.getElementById('mc-score').textContent = score;

        feedbackEl.textContent = '✅ Doğru!';
        feedbackEl.className = 'feedback-message success';
        feedbackEl.style.display = 'block';

        userAnswers[currentQuestionIndex] = {
            question: questions[currentQuestionIndex],
            userAnswer: userAnswer,
            correctAnswer: correctAnswer,
            correct: true,
            attempts: attemptCount,
            index: currentQuestionIndex
        };

        // otomatik sonraki
        attemptCount = 0;
        state.attemptsUsed = 0;
        if (mcAutoAdvanceTimer) {
            clearTimeout(mcAutoAdvanceTimer);
            mcAutoAdvanceTimer = null;
        }
        mcAutoAdvanceTimer = setTimeout(() => {
            document.getElementById('mc-feedback').style.display = 'none';
            nextMultipleChoiceQuestion();
            mcAutoAdvanceTimer = null;
        }, MC_AUTO_NEXT_DELAY_MS);
        return;
    }

    // yanlış
    try {
        if (navigator?.vibrate) navigator.vibrate([25, 40, 25]);
    } catch {
        // ignore
    }
    selectedOptionEl.classList.add('wrong');
    selectedOptionEl.classList.add('shake');
    setTimeout(() => selectedOptionEl.classList.remove('shake'), 400);

    if (attemptCount >= 2) {
        options.forEach(option => {
            option.classList.add('disabled');
            if (option.dataset.answer === correctAnswer) {
                option.classList.add('correct');
                option.classList.add('pulse');
            }
        });

        feedbackEl.textContent = `❌ Doğru cevap: ${correctAnswer}`;
        feedbackEl.className = 'feedback-message error';
        feedbackEl.style.display = 'block';

        state.resolved = true;
        state.correct = false;

        score = mcAnswerStates.filter(s => s && s.correct).length;
        document.getElementById('mc-score').textContent = score;

        userAnswers[currentQuestionIndex] = {
            question: questions[currentQuestionIndex],
            userAnswer: userAnswer,
            correctAnswer: correctAnswer,
            correct: false,
            attempts: attemptCount,
            index: currentQuestionIndex
        };

        document.getElementById('mc-next').style.display = 'inline-block';
        attemptCount = 0;
        state.attemptsUsed = 0;
    } else {
        feedbackEl.textContent = '❌ Yanlış! Tekrar dene.';
        feedbackEl.className = 'feedback-message error';
        feedbackEl.style.display = 'block';

        // Kırmızı highlight ekranda kalmasın, kısa süre sonra temizle
        setTimeout(() => {
            selectedOptionEl.classList.remove('wrong');
        }, 900);
        setTimeout(() => {
            feedbackEl.style.display = 'none';
        }, 1200);
    }
}

function checkMultipleChoiceAnswer() {
    const selectedOption = document.querySelector('.mc-option.selected');
    const feedbackEl = document.getElementById('mc-feedback');
    
    if (!selectedOption) {
        feedbackEl.textContent = '⚠️ Lütfen bir şık seçin!';
        feedbackEl.className = 'feedback-message info';
        feedbackEl.style.display = 'block';
        setTimeout(() => feedbackEl.style.display = 'none', 3000);
        return;
    }
    
    // Dinamik modda buton kullanılmasa da geriye dönük uyumluluk: aynı evaluator'ı çağır.
    // evaluator attemptCount'ı kendi artırdığı için burada attemptCount'ı resetliyoruz.
    attemptCount = 0;
    evaluateMultipleChoiceSelection(selectedOption);
}

function retryMultipleChoiceQuestion() {
    const options = document.querySelectorAll('.mc-option');
    options.forEach(option => {
        option.classList.remove('selected', 'wrong');
    });
    
    document.getElementById('mc-feedback').style.display = 'none';
    document.getElementById('mc-retry').style.display = 'none';
    document.getElementById('mc-check').style.display = 'inline-block';
}

function nextMultipleChoiceQuestion() {
    currentQuestionIndex++;
    document.getElementById('mc-feedback').style.display = 'none';
    loadMultipleChoiceQuestion();
}

function prevMultipleChoiceQuestion() {
    if (currentQuestionIndex <= 0) return;
    currentQuestionIndex--;
    document.getElementById('mc-feedback').style.display = 'none';
    loadMultipleChoiceQuestion();
}

// Deneme Sınavı
function startTimer() {
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - examStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        document.getElementById('timer-display').textContent = 
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }, 1000);
}

function loadExamQuestion() {
    document.getElementById('exam-current-question').textContent = currentQuestionIndex + 1;
    document.getElementById('exam-q-number').textContent = currentQuestionIndex + 1;
    setCurrentUnitLabel(getUnitLabelForIndex(currentQuestionIndex));
    
    const question = questions[currentQuestionIndex];
    const correctAnswer = answers[currentQuestionIndex];
    
    const questionText = question.replace(/_{3,}/g, '...');
    document.getElementById('exam-question').textContent = questionText;
    
    const wrongAnswers = answers.filter((_, idx) => idx !== currentQuestionIndex);
    const shuffledWrongs = wrongAnswers.sort(() => Math.random() - 0.5).slice(0, 3);
    const allOptions = [correctAnswer, ...shuffledWrongs].sort(() => Math.random() - 0.5);
    
    const optionsContainer = document.getElementById('exam-options');
    optionsContainer.innerHTML = '';
    
    allOptions.forEach((option, index) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'mc-option';
        optionDiv.textContent = `${String.fromCharCode(65 + index)}) ${option}`;
        optionDiv.dataset.answer = option;
        
        if (examAnswers[currentQuestionIndex] === option) {
            optionDiv.classList.add('selected');
        }
        
        optionDiv.addEventListener('click', handleExamOptionClick);
        optionsContainer.appendChild(optionDiv);
    });
    
    document.getElementById('exam-prev').disabled = currentQuestionIndex === 0;
    document.getElementById('exam-next').textContent = 
        currentQuestionIndex === questions.length - 1 ? 'Son Soru' : 'Sonraki →';
    
    const markBtn = document.getElementById('exam-mark');
    if (markedQuestions.has(currentQuestionIndex)) {
        markBtn.textContent = '🏴 İşareti Kaldır';
        markBtn.classList.add('active');
    } else {
        markBtn.textContent = '🏳️ İşaretle';
        markBtn.classList.remove('active');
    }
    
    updateQuestionGrid();
}

function handleExamOptionClick(e) {
    const options = document.querySelectorAll('#exam-options .mc-option');
    options.forEach(opt => opt.classList.remove('selected'));
    e.target.classList.add('selected');
    
    examAnswers[currentQuestionIndex] = e.target.dataset.answer;
    updateQuestionGrid();
}

function navigateExamQuestion(direction) {
    const newIndex = currentQuestionIndex + direction;
    if (newIndex >= 0 && newIndex < questions.length) {
        currentQuestionIndex = newIndex;
        loadExamQuestion();
    }
}

function toggleMarkQuestion() {
    if (markedQuestions.has(currentQuestionIndex)) {
        markedQuestions.delete(currentQuestionIndex);
    } else {
        markedQuestions.add(currentQuestionIndex);
    }
    loadExamQuestion();
}

function createQuestionGrid() {
    const gridContainer = document.getElementById('question-grid');
    gridContainer.innerHTML = '';
    
    for (let i = 0; i < questions.length; i++) {
        const bubble = document.createElement('div');
        bubble.className = 'question-bubble';
        bubble.textContent = i + 1;
        bubble.dataset.index = i;
        
        bubble.addEventListener('click', () => {
            currentQuestionIndex = i;
            loadExamQuestion();
        });
        
        gridContainer.appendChild(bubble);
    }
    
    updateQuestionGrid();
}

function updateQuestionGrid() {
    const bubbles = document.querySelectorAll('.question-bubble');
    bubbles.forEach((bubble, index) => {
        bubble.className = 'question-bubble';
        
        if (examAnswers[index] !== null) {
            bubble.classList.add('answered');
        }
        
        if (markedQuestions.has(index)) {
            bubble.classList.add('marked');
        }
        
        if (index === currentQuestionIndex) {
            bubble.classList.add('current');
        }
    });
}

function finishExam() {
    const unansweredCount = examAnswers.filter(a => a === null).length;
    
    if (unansweredCount > 0) {
        const confirm = window.confirm(
            `${unansweredCount} soru cevaplanmadı!\n\nSınavı bitirmek istediğinize emin misiniz?`
        );
        if (!confirm) return;
    }
    
    clearInterval(timerInterval);
    
    score = 0;
    userAnswers = [];
    
    examAnswers.forEach((userAnswer, index) => {
        const isCorrect = userAnswer === answers[index];
        if (isCorrect) score++;
        
        userAnswers.push({
            question: questions[index],
            userAnswer: userAnswer || 'Cevaplanmadı',
            correctAnswer: answers[index],
            correct: isCorrect
        });
    });
    
    showResults();
}

// Sonuçlar
function showResults() {
    fillBlankGame.style.display = 'none';
    multipleChoiceGame.style.display = 'none';
    examGame.style.display = 'none';
    resultSection.style.display = 'block';
    
    const total = currentUnit ? currentUnit.questions.length : questions.length;
    const correct = score;
    const wrong = total - correct;
    const percentage = Math.round((correct / total) * 100);
    
    // Ünite tamamlandığında işaretle (100% doğru ise)
    const unitName = currentUnit?.unitName || '';
    if (percentage === 100 && unitName && currentFileName) {
        markUnitComplete(currentFileName, unitName, currentMode);
    }
    
    document.getElementById('result-total').textContent = total;
    document.getElementById('result-correct').textContent = correct;
    document.getElementById('result-wrong').textContent = wrong;
    document.getElementById('result-percentage').textContent = percentage + '%';
    
    // Başlık güncelleme - hangi ünitenin bittiğini göster
    const resultTitle = document.getElementById('result-title');
    if (resultTitle) {
        if (unitName) {
            resultTitle.textContent = percentage === 100 
                ? `${unitName} Tamamlandı! ✓` 
                : `${unitName} Test Tamamlandı`;
        } else {
            resultTitle.textContent = 'Test Tamamlandı!';
        }
    }
    
    const resultIcon = document.getElementById('result-icon');
    if (percentage >= 90) {
        resultIcon.textContent = '🎉';
    } else if (percentage >= 70) {
        resultIcon.textContent = '😊';
    } else if (percentage >= 50) {
        resultIcon.textContent = '😐';
    } else {
        resultIcon.textContent = '😞';
    }
}

function showReview() {
    const reviewSection = document.getElementById('review-section');
    const wrongAnswersList = document.getElementById('wrong-answers-list');

    const wrongAnswers = (userAnswers || []).filter(Boolean).filter(answer => !answer.correct);
    
    if (wrongAnswers.length === 0) {
        wrongAnswersList.innerHTML = '<p style="text-align: center; color: var(--success-color); font-size: 1.2rem;">🎉 Tebrikler! Tüm soruları doğru cevapladınız!</p>';
    } else {
        wrongAnswersList.innerHTML = '';
        
        wrongAnswers.forEach((answer) => {
            const reviewItem = document.createElement('div');
            reviewItem.className = 'review-item';

            const qNo = Number.isFinite(answer.index) ? answer.index + 1 : '';
            
            reviewItem.innerHTML = `
                <div class="review-question">
                    <strong>Soru ${qNo}:</strong> ${answer.question}
                </div>
                <div class="review-answer wrong">
                    ❌ Sizin Cevabınız: ${answer.userAnswer}
                </div>
                <div class="review-answer correct">
                    ✅ Doğru Cevap: ${answer.correctAnswer}
                </div>
            `;
            
            wrongAnswersList.appendChild(reviewItem);
        });
    }
    
    reviewSection.style.display = 'block';
    reviewSection.scrollIntoView({ behavior: 'smooth' });
}

function backToModeSelection() {
    fillBlankGame.style.display = 'none';
    multipleChoiceGame.style.display = 'none';
    examGame.style.display = 'none';
    unitBulkGame.style.display = 'none';
    unitPicker.style.display = 'none';
    
    if (timerInterval) {
        clearInterval(timerInterval);
    }
    
    modeSelection.style.display = 'block';

    // Mode ekranına dönünce dosya bilgisi tekrar görünsün
    setFileInfoForGameplay(false);

    // İlerleme özetini güncelle
    renderProgressSummary();

    // Mode ekranına dönünce aktif seti tekrar tüm sorulara çek
    questions = [...allQuestions];
    answers = [...allAnswers];
    currentUnit = null;
    questionUnitNames = [];
    setCurrentUnitLabel('');
}

function restartSameTest() {
    resultSection.style.display = 'none';
    document.getElementById('review-section').style.display = 'none';
    startGame(currentMode);
}

function newTest() {
    resultSection.style.display = 'none';
    document.getElementById('review-section').style.display = 'none';
    removeFile();
    uploadArea.parentElement.style.display = 'block';
}

console.log('📚 Sınav Çalışma Uygulaması hazır!');
