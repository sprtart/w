// --- Глобальные переменные ---
var height = 6, width = 5;
var row = 0, col = 0;
var gameOver = false;
var word = "";
var wordList = [], guessList = [], excludeSet = new Set();
var winCount = 0;

// Переменные для контроля рекламы ВКонтакте
let gamesPlayedSinceAd = 0; 
let lastAdTime = 0; 
const AD_COOLDOWN_MS = 4 * 60 * 1000; // 3 минуты в миллисекундах
const GAMES_BEFORE_AD = 3; // Показывать рекламу не раньше чем через 2 сыгранные игры

// Яндекс SDK переменные
let ysdk = null;
let player = null;
let adPreloadInterval = null; 
let audioContextUnlocked = false;


let clickSound = new Audio('assets/sounds/tap.mp3');
let successSound = new Audio('assets/sounds/success.wav');

let failSound = new Audio('assets/sounds/fail.wav');
let errorSound = new Audio('assets/sounds/error.wav'); 

// Настройка громкости (по желанию)
errorSound.volume = 0.1;
failSound.volume = 0.3;

// Настройка громкости (по желанию)
clickSound.volume = 0.4;
successSound.volume = 0.5;

function playSound(audio) {
    if (!audio) return;
    audio.currentTime = 0;
    // Используем промис, чтобы не ждать ответа от аудио-движка
    audio.play().catch(() => {}); 
}
function preloadAds() {
    vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'interstitial' })
        .catch(e => console.log("Фоновая предзагрузка:", e));
}

// --- 1. ЕДИНАЯ ИНИЦИАЛИЗАЦИЯ ---
async function initGame() {
    try {
        vkBridge.send('VKWebAppInit');
        applyInitialTheme();

        await loadAssets();
        loadWinCount();
        initUI();

        // 1. Показываем баннер (согласно п. 5.1.4.1 «б»)
        showBanner();

        // 2. Первый вызов предзагрузки сразу
        preloadAds();
        
        // 3. Запускаем таймер для фоновой предзагрузки раз в минуту (согласно рекомендациям VK)
        adPreloadInterval = setInterval(preloadAds, 60000);

        // 4. Запускаем игру
        startNewGame();

    } catch (e) {
        console.error("Ошибка инициализации:", e);
        initUI();
        startNewGame();
    }
}

function unlockAudio() {
    if (audioContextUnlocked) return;

    // Пытаемся "проиграть" пустые звуки, чтобы браузер понял, что пользователь разрешил звук
    clickSound.play().then(() => {
        clickSound.pause();
        clickSound.currentTime = 0;
        audioContextUnlocked = true;
        console.log("Звук разблокирован");
    }).catch(e => console.log("Звук все еще заблокирован до первого клика"));
}

function showBanner() {
    // Проверяем, существует ли вообще vkBridge (на случай запуска вне ВК)
    if (typeof vkBridge !== 'undefined') {
        vkBridge.send('VKWebAppShowBannerAd', {
            banner_location: 'bottom'
        })
        .then((data) => {
            if (data.result) {
                console.log("Баннер успешно показан");
            }
        })
        .catch((err) => {
            console.error("Ошибка при показе баннера:", err);
        });
    }
}
// Привязываем запуск к загрузке окна
window.onload = initGame;

// Функцию initYandexSDK УДАЛИ ПОЛНОСТЬЮ

function showFullscreenAd(onComplete) {
    const now = Date.now();
    
    // Проверки (кулдаун 5 минут, 3 игры)
    if ((now - lastAdTime) < AD_COOLDOWN_MS || gamesPlayedSinceAd < GAMES_BEFORE_AD) {
        onComplete();
        return;
    }

    // По правилам: показ ТОЛЬКО при смене экрана/уровня
    // Мы не вызываем Check внутри показа, мы просто вызываем Show, 
    // так как мы сделали предзагрузку в фоне по таймеру.
    vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' })
        .then((data) => {
            if (data.result) {
                lastAdTime = Date.now();
                gamesPlayedSinceAd = 0;
                onComplete();
            } else {
                onComplete();
            }
        })
        .catch(() => onComplete());
}

// Загрузка слов
async function loadAssets() {
    try {
        const [mainResponse, excludeResponse] = await Promise.all([
            fetch('assets/words/five-letter-words.json').catch(() => ({ error: true })),
            fetch('assets/words/exclude-words.json').catch(() => ({ ok: false }))
        ]);

        if (mainResponse.error || !mainResponse.ok) throw new Error("Ошибка словаря");
        
        const allWords = await mainResponse.json();
        // Внутри loadAssets после получения allWords:
        guessList = allWords.map(w => w.toLowerCase().replace(/ё/g, 'е'));
        // Убираем дубликаты, которые могли появиться (например, "все" и "всё" теперь оба "все")
        guessList = [...new Set(guessList)]; 
        wordList = [...guessList];

        if (excludeResponse.ok) {
            const rawExclude = await excludeResponse.json();
            excludeSet = new Set(rawExclude.map(w => w.toLowerCase()));
        }
    } catch (e) {
        console.error("Ошибка загрузки ассетов:", e);
    }
}

// --- 2. ЛОГИКА СОХРАНЕНИЯ И СЧЕТА ---
function loadWinCount() {
    winCount = parseInt(localStorage.getItem('wordle-win-count')) || 0;
    updateTitleScore();
}

function saveWinCount() {
    // Оставляем локальное сохранение на всякий случай
    localStorage.setItem('wordle-win-count', winCount);
    
    // Сохраняем прогресс в облако ВКонтакте
    vkBridge.send('VKWebAppStorageSet', {
        key: 'wordle-win-count',
        value: winCount.toString()
    })
    .then(() => console.log("Рекорд сохранен в VK Storage"))
    .catch(err => console.error("Ошибка сохранения в VK:", err));
}

function updateTitleScore() {
    const title = document.getElementById("title");
    if (title) title.textContent = `Слов: ${winCount}`;
}

// --- 3. ИГРОВОЙ ЦИКЛ ---
function startNewGame() {
    gameOver = false;
    selectNewWord(); 
    row = 0; col = 0; 
    clearBoardAndKeyboard(); 
    updateTileCursorsAndSelection(); 

}

function selectNewWord() {
    let candidateWord = "";
    let attempts = 0;
    do {
        candidateWord = wordList[Math.floor(Math.random() * wordList.length)];
        attempts++;
        if (attempts > 500) break;
    } while (excludeSet.has(candidateWord));
    word = candidateWord.toUpperCase().replace(/Ё/g, 'Е');
}

// --- 4. ОБРАБОТКА ВВОДА ---
function processInput(eventData) {
    if (gameOver) return;
    let key = eventData.key ? eventData.key.toUpperCase().replace(/Ё/g, 'Е') : "";
    const code = eventData.code;

    // Звук на любое нажатие (стрелки, буквы, бэкспейс)
    if (key || code) {
        playSound(clickSound);
    }

    if (code === "ArrowLeft" || key === "ArrowLeft") {
        col = (col >= width) ? width - 1 : (col - 1 + width) % width;
        updateTileCursorsAndSelection();
        return;
    }
    if (code === "ArrowRight" || key === "ArrowRight") {
        col = (col >= width) ? 0 : (col + 1) % width;
        updateTileCursorsAndSelection();
        return;
    }

    if (/^[а-яА-ЯёЁ]$/.test(key) && key.length === 1) {
        if (col < width) {
            let currentTile = document.getElementById(`${row}-${col}`);
            if (currentTile) currentTile.textContent = key.toUpperCase();

            let guess = "";
            let full = true;
            for (let c = 0; c < width; c++) {
                let txt = document.getElementById(`${row}-${c}`).textContent;
                if (!txt) full = false;
                guess += txt;
            }

            if (full) {
                col = width; 
                updateTileCursorsAndSelection();
                setTimeout(() => updateGameState(guess), 150);
            } else {
                if (col < width - 1) col++;
                updateTileCursorsAndSelection();
            }
        }
    } else if (key === "Backspace" || code === "Backspace" || key === "⌫") {
        let tile = document.getElementById(`${row}-${col}`);
        if (col > 0 && (!tile || !tile.textContent)) {
            col--;
            document.getElementById(`${row}-${col}`).textContent = "";
        } else if (tile) {
            tile.textContent = "";
        }
        updateTileCursorsAndSelection();
    }
}

function updateGameState(guess) {
    let guessLower = guess.toLowerCase();

    if (!guessList.includes(guessLower)) {
        displayMessage("Такого слова нет", 1500);
        shakeRow(row);
        playSound(errorSound);  
        col = width - 1;
        updateTileCursorsAndSelection();
        return;
    }

    gameOver = true;

    const evaluation = evaluateGuess(guess);
    animateTileFlip(row, evaluation);
    updateKeyboard(guess, evaluation);

    const currentRow = row;
    const animDuration = width * 200 + 300;

    setTimeout(() => {
        const isWin = evaluation.every(s => s === 'correct');
        const isLoss = !isWin && (row === height - 1);

if (isWin) {
            winCount++;
            saveWinCount();
            updateTitleScore();
            displayMessage("Правильно!", 3000);
            danceRow(currentRow);
            playSound(successSound);
            
            gamesPlayedSinceAd++; // Увеличиваем счетчик сыгранных игр
            
            setTimeout(() => {
                showFullscreenAd(startNewGame); // Пробуем показать рекламу перед новой игрой
            }, 3500);
            
        } else if (isLoss) {
            displayMessage(`Было слово: ${word}`, 5000);
            playSound(failSound);
            
            gamesPlayedSinceAd++; // Увеличиваем счетчик сыгранных игр
            
            setTimeout(() => {
                showFullscreenAd(startNewGame); // Пробуем показать рекламу перед новой игрой
            }, 5500);
        } else {
            // Игра продолжается на следующей строке
            gameOver = false;
            row++;
            col = 0;
            updateTileCursorsAndSelection();
        }
    }, animDuration);
}

// --- ВСЕ ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений в логике) ---

function evaluateGuess(guess) {
    let evaluation = Array(width).fill('absent');
    let freq = {};
    let gUp = guess.toUpperCase();
    for (let l of word) freq[l] = (freq[l] || 0) + 1;
    for (let i = 0; i < width; i++) {
        if (gUp[i] === word[i]) {
            evaluation[i] = 'correct';
            freq[word[i]]--;
        }
    }
    for (let i = 0; i < width; i++) {
        if (evaluation[i] === 'correct') continue;
        if (word.includes(gUp[i]) && freq[gUp[i]] > 0) {
            evaluation[i] = 'present';
            freq[gUp[i]]--;
        }
    }
    return evaluation;
}

function initializeBoardAndKeyboard() {
    let board = document.getElementById("board");
    board.innerHTML = '';
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            let tile = document.createElement("span");
            tile.id = `${r}-${c}`;
            tile.classList.add("tile");
            
            // Используем pointerdown для мгновенного отклика на плитках
            tile.addEventListener('pointerdown', (e) => {
                if (!gameOver && r === row) { 
                    e.preventDefault(); // Убирает задержку и фантомные клики
                    col = c; 
                    updateTileCursorsAndSelection(); 
                    playSound(clickSound);
                }
            });
            board.appendChild(tile);
        }
    }

    let keyboardLayout = [
        ["Й", "Ц", "У", "К", "Е", "Н", "Г", "Ш", "Щ", "З", "Х"],
        ["Ф", "Ы", "В", "А", "П", "Р", "О", "Л", "Д", "Ж", "Э"],
        ["Я", "Ч", "С", "М", "И", "Т", "Ь", "Б", "Ю", "⌫"]
    ];

    let container = document.getElementById("keyboard-container");
    container.innerHTML = '';
    keyboardLayout.forEach(rowKeys => {
        let rowEl = document.createElement("div");
        rowEl.classList.add("keyboard-row");
        rowKeys.forEach(key => {
            let btn = document.createElement("button");
            btn.dataset.key = key;
            if (key === "⌫") {
                btn.id = "Backspace";
                btn.classList.add("enter-key-tile");
                btn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7.07L2.4 12l4.66-7H22v14zm-11.59-2L14 13.41 17.59 17 19 15.59 15.41 12 19 8.41 17.59 7 14 10.59 10.41 7 9 8.41 12.59 12 9 15.59z"></path></svg>`;
            } else {
                btn.classList.add("key-tile");
                btn.textContent = key;
            }

            // МГНОВЕННЫЙ ВВОД: используем pointerdown вместо click
            btn.addEventListener("pointerdown", function(e) {
                e.preventDefault(); // Важно: предотвращает задержку 300мс и зум
                processInput({ key: this.dataset.key, code: this.id });
            });

            rowEl.appendChild(btn);
        });
        container.appendChild(rowEl);
    });
}

function initUI() {
    const helpButton = document.getElementById('help-button');
    const themeButton = document.getElementById('theme-button');
    const helpModal = document.getElementById('help-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const closeModalButton = document.getElementById('close-modal-button');

    helpButton.addEventListener('click', () => {
        helpModal.classList.remove('modal-hidden');
        modalOverlay.classList.remove('modal-hidden');
    });

    const closeH = () => {
        helpModal.classList.add('modal-hidden');
        modalOverlay.classList.add('modal-hidden');
    };

    themeButton.addEventListener('click', toggleTheme);
    closeModalButton.addEventListener('click', closeH);
    modalOverlay.addEventListener('click', closeH);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeH(); });
    
    document.removeEventListener("keyup", processPhysicalKeyPress);
    document.addEventListener("keyup", processPhysicalKeyPress);
    
    initializeBoardAndKeyboard();
    applyInitialTheme();
    document.body.addEventListener('pointerdown', unlockAudio, { once: true });
}

function processPhysicalKeyPress(e) { processInput(e); }

function updateTileCursorsAndSelection() {
    document.querySelectorAll('.tile').forEach(t => t.classList.remove('selected', 'current-row'));
    for (let c = 0; c < width; c++) {
        const tile = document.getElementById(`${row}-${c}`);
        if (tile) {
            tile.classList.add('current-row');
            if (c === col && !gameOver) tile.classList.add('selected');
        }
    }
}

function clearBoardAndKeyboard() {
    // Выбираем плитки ТОЛЬКО внутри игрового поля (#board)
    // Раньше было просто '.tile', поэтому задевало и модалку
    document.querySelectorAll('#board .tile').forEach(t => {
        t.textContent = "";
        t.className = "tile"; // Теперь это сбросит только плитки на доске
    });

    // Сброс клавиатуры (тут всё ок)
    document.querySelectorAll('.key-tile, .enter-key-tile').forEach(k => {
        k.classList.remove('correct', 'present', 'absent');
    });
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function applyInitialTheme() {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-theme');
}

function displayMessage(message, duration = 2000) {
    let container = document.getElementById("toast-container") || document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        toast.addEventListener("transitionend", () => toast.remove());
    }, duration);
}

function updateKeyboard(guess, evaluation) {
    for (let i = 0; i < width; i++) {
        let letter = guess[i].toUpperCase();
        let state = evaluation[i];
        let keyBtn = document.querySelector(`[data-key='${letter}']`);
        if (!keyBtn) continue;
        if (state === 'correct') {
            keyBtn.classList.remove('present', 'absent');
            keyBtn.classList.add('correct');
        } else if (state === 'present' && !keyBtn.classList.contains('correct')) {
            keyBtn.classList.remove('absent');
            keyBtn.classList.add('present');
        } else if (state === 'absent' && !keyBtn.classList.contains('correct') && !keyBtn.classList.contains('present')) {
            keyBtn.classList.add('absent');
        }
    }
}

function shakeRow(rowIndex) {
    document.querySelectorAll(`#board > span[id^='${rowIndex}-']`).forEach(t => {
        t.classList.add('shake');
        t.addEventListener('animationend', () => t.classList.remove('shake'), { once: true });
    });
}

function danceRow(rowIndex) {
    document.querySelectorAll(`#board > span[id^='${rowIndex}-']`).forEach((t, i) => {
        setTimeout(() => {
            t.classList.add('dance');
            t.addEventListener('animationend', () => t.classList.remove('dance'), { once: true });
        }, i * 100);
    });
}

function animateTileFlip(rowIndex, evaluation) {
    const animDuration = 600;
    const stagger = 250;
    for (let c = 0; c < width; c++) {
        let tile = document.getElementById(`${rowIndex}-${c}`);
        setTimeout(() => {
            tile.classList.add('flip');
            setTimeout(() => {
                tile.classList.remove('correct', 'present', 'absent');
                tile.classList.add(evaluation[c]);
            }, animDuration / 2);
            tile.addEventListener('animationend', () => tile.classList.remove('flip'), { once: true });
        }, c * stagger);
    }
}

// ЗАПУСК ВСЕГО
window.onload = initGame;



// --- ЗАЩИТА ИНТЕРФЕЙСА ---

// 1. Запрет контекстного меню (правой кнопки мыши)
document.addEventListener('contextmenu', event => event.preventDefault());

// 2. Запрет масштабирования (Ctrl + колесико мыши)
document.addEventListener('wheel', function(event) {
    if (event.ctrlKey) {
        event.preventDefault();
    }
}, { passive: false });

// 3. Запрет масштабирования через жесты (pinch-to-zoom) на тачпадах и мобильных
document.addEventListener('touchstart', function(event) {
    if (event.touches.length > 1) {
        event.preventDefault();
    }
}, { passive: false });

// 4. Запрет зума через горячие клавиши (Ctrl + Plus, Minus, 0)
document.addEventListener('keydown', function(event) {
    if (event.ctrlKey && (event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0')) {
        event.preventDefault();
    }
});

// 5. Фикс для iOS: запрет двойного тапа для зума
let lastTouchEnd = 0;
document.addEventListener('touchend', function(event) {
    let now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        event.preventDefault();
    }
    lastTouchEnd = now;
}, false);

window.addEventListener('touchstart', function(e) {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

window.addEventListener('touchmove', function(e) {
    e.preventDefault();
}, { passive: false });
