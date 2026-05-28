// ============================================
// КОНФИГУРАЦИЯ (можно менять через интерфейс)
// ============================================
const CONFIG = {
    // Параметры игры
    gamesPerDay: 3.5,
    winRate: 50,
    drawRate: 5,
    simulationDays: 30,
    simulationsCount: 1,
    
    // Награды за матч
    rewards: {
        win: { cards: 2, coins: 100 },
        draw: { cards: 1, coins: 50 },
        loss: { cards: 1, coins: 25 }
    },
    
    // Вероятности выпадения карт
    probabilities: {
        basic: 70,
        strong: 20,
        epic: 7,
        rare: 3
    },
    
    // Параметры карт
    totalUniqueCards: 30,
    maxCopies: 4,
    
    // Цены в магазине
    prices: {
        basic: 175,
        strong: 500,
        epic: 850,
        rare: 1200
    },
    
    // Ежедневный бонус
    enableDailyBonus: true,
    dailyCoinsAmount: 500,
    
    // Уникальные карты
    uniqueCardInterval: 10, // Каждую N-ю карту делать уникальной
    guaranteedUniqueWins: 5, // Первые X побед дают только уникальные карты
    
    // Начальные условия
    startingCards: 6, // Начальные карты (уникальные базовые)
    startingCoins: 200, // Начальный бюджет монет
    firstWinBonusCards: 2 // Карты за первую победу (уникальные)
};

// ============================================
// СОСТОЯНИЕ СИМУЛЯЦИИ
// ============================================
let collectionChart = null;
let coinsChart = null;
let rarityChart = null;
let sourcesChart = null;
let lastSimulationResult = null; // Для экспорта в Excel

// ============================================
// УТИЛИТЫ
// ============================================

// Генерация случайного числа в диапазоне
function random(min, max) {
    return Math.random() * (max - min) + min;
}

// Генерация случайного целого числа
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Взвешенный случайный выбор
function weightedRandom(weights) {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let random = Math.random() * total;
    
    for (let i = 0; i < weights.length; i++) {
        random -= weights[i];
        if (random <= 0) return i;
    }
    return weights.length - 1;
}

// ============================================
// ЛОГИКА СИМУЛЯЦИИ
// ============================================

class CardGameSimulator {
    constructor(config) {
        this.config = { ...config };
        this.reset();
    }
    
    reset() {
        // Коллекция игрока: { cardId: count }
        this.collection = {};
        for (let i = 0; i < this.config.totalUniqueCards; i++) {
            this.collection[i] = 0;
        }
        
        // Баланс монет
        this.coins = this.config.startingCoins || 0;
        
        // Счётчики новых механик
        this.totalCardsObtained = 0; // Счётчик всех полученных карт (для механики "каждую N-ю карту")
        this.winsWithUniqueCards = 0; // Счётчик побед с уникальными картами (для механики "первые X побед")
        this.firstWinCompleted = false; // Флаг первой победы (для механики "2 уникальные карты")
        
        // Пул карт (какие ещё могут выпасть) — инициализируем ПЕРЕД выдачей начальных карт
        this.cardPool = this.initializeCardPool();
        
        // Статистика
        this.stats = {
            totalGames: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            cardsFromWins: 0,
            cardsFromDraws: 0,
            cardsFromLosses: 0,
            cardsFromDaily: 0,
            cardsBought: 0,
            coinsEarned: 0,
            coinsSpent: 0,
            duplicates: 0,
            dailyCoinsEarned: 0, // Монеты из ежедневного бонуса
            uniqueCardsFromInterval: 0, // Уникальных карт получено по интервалу
            uniqueCardsFromGuaranteed: 0, // Уникальных карт получено по гарантированным победам
            dailyProgress: [],
            collectionProgress: [],
            coinsProgress: [],
            rarityDistribution: { basic: 0, strong: 0, epic: 0, rare: 0 }
        };
        
        // Выдача начальных карт (6 уникальных базовых карт)
        if (this.config.startingCards > 0) {
            const basicCards = this.cardPool.filter(card => card.rarity === 'basic');
            const shuffled = basicCards.sort(() => Math.random() - 0.5);
            const startingCardCount = Math.min(this.config.startingCards, shuffled.length);
            
            for (let i = 0; i < startingCardCount; i++) {
                this.collection[shuffled[i].id] = 1;
                this.stats.rarityDistribution.basic++;
            }
        }
    }
    
    initializeCardPool() {
        // Создаём пул карт с учётом 4 редкостей
        const pool = [];
        const numBasic = Math.floor(this.config.totalUniqueCards * 0.5); // 50% базовых
        const numStrong = Math.floor(this.config.totalUniqueCards * 0.25); // 25% сильных
        const numEpic = Math.floor(this.config.totalUniqueCards * 0.15); // 15% эпических
        const numRare = this.config.totalUniqueCards - numBasic - numStrong - numEpic; // 10% редких
        
        let cardId = 0;
        
        // Базовые карты
        for (let i = 0; i < numBasic; i++) {
            pool.push({ id: cardId++, rarity: 'basic', index: i });
        }
        
        // Сильные карты
        for (let i = 0; i < numStrong; i++) {
            pool.push({ id: cardId++, rarity: 'strong', index: i });
        }
        
        // Эпические карты
        for (let i = 0; i < numEpic; i++) {
            pool.push({ id: cardId++, rarity: 'epic', index: i });
        }
        
        // Редкие карты
        for (let i = 0; i < numRare; i++) {
            pool.push({ id: cardId++, rarity: 'rare', index: i });
        }
        
        return pool;
    }
    
    // Получить редкость карты по вероятностям
    getCardRarity() {
        const rand = Math.random() * 100;
        const { basic, strong, epic, rare } = this.config.probabilities;
        
        if (rand < basic) return 'basic';
        if (rand < basic + strong) return 'strong';
        if (rand < basic + strong + epic) return 'epic';
        return 'rare';
    }
    
    // Получить случайную карту из пула (с учётом лимита копий)
    getRandomCard() {
        // Фильтруем карты, которые ещё можно получить (меньше maxCopies)
        const availableCards = this.cardPool.filter(card => 
            this.collection[card.id] < this.config.maxCopies
        );
        
        if (availableCards.length === 0) return null;
        
        // Выбираем редкость
        const rarity = this.getCardRarity();
        
        // Фильтруем по редкости
        const cardsOfRarity = availableCards.filter(card => card.rarity === rarity);
        
        // Если нет карт такой редкости, берём любую доступную
        const candidates = cardsOfRarity.length > 0 ? cardsOfRarity : availableCards;
        
        // Случайный выбор из кандидатов
        const card = candidates[randomInt(0, candidates.length - 1)];
        
        return card;
    }
    
    // Получить карту/монеты ежедневного бонуса
    getDailyBonus(day) {
        const dayInCycle = ((day - 1) % 7) + 1;
        
        // Дни 1-3: базовая карта
        if (dayInCycle <= 3) {
            const basicCards = this.cardPool.filter(card => 
                card.rarity === 'basic' && this.collection[card.id] < this.config.maxCopies
            );
            if (basicCards.length > 0) {
                return { 
                    type: 'card', 
                    card: basicCards[randomInt(0, basicCards.length - 1)] 
                };
            }
        }
        
        // Дни 4-6: сильная карта
        if (dayInCycle <= 6) {
            const strongCards = this.cardPool.filter(card => 
                card.rarity === 'strong' && this.collection[card.id] < this.config.maxCopies
            );
            if (strongCards.length > 0) {
                return { 
                    type: 'card', 
                    card: strongCards[randomInt(0, strongCards.length - 1)] 
                };
            }
            // Если сильных нет, даём базовую
            const basicCards = this.cardPool.filter(card => 
                card.rarity === 'basic' && this.collection[card.id] < this.config.maxCopies
            );
            if (basicCards.length > 0) {
                return { 
                    type: 'card', 
                    card: basicCards[randomInt(0, basicCards.length - 1)] 
                };
            }
        }
        
        // День 7: монеты
        if (dayInCycle === 7) {
            return { 
                type: 'coins', 
                amount: this.config.dailyCoinsAmount 
            };
        }
        
        return null;
    }
    
    // Получить уникальную карту (которой ещё нет в коллекции)
    getUniqueCard() {
        // Фильтруем карты, которых ещё нет в коллекции (count = 0)
        const uniqueCards = this.cardPool.filter(card => 
            this.collection[card.id] === 0
        );
        
        if (uniqueCards.length === 0) return null;
        
        // Случайный выбор из уникальных карт
        return uniqueCards[randomInt(0, uniqueCards.length - 1)];
    }
    
    // Получить карту с учётом новых механик (уникальные по интервалу и гарантированные победы)
    getCardWithMechanics(isWin = false) {
        // Механика 1: Первые X побед дают только уникальные карты
        if (isWin && this.config.guaranteedUniqueWins > 0 && this.winsWithUniqueCards < this.config.guaranteedUniqueWins) {
            const uniqueCard = this.getUniqueCard();
            if (uniqueCard) {
                this.winsWithUniqueCards++;
                this.stats.uniqueCardsFromGuaranteed++;
                return uniqueCard;
            }
            // Если уникальных карт нет, продолжаем обычную логику
        }
        
        // Механика 2: Каждую N-ю карту делать уникальной
        if (this.config.uniqueCardInterval > 0 && this.totalCardsObtained > 0 && 
            (this.totalCardsObtained + 1) % this.config.uniqueCardInterval === 0) {
            const uniqueCard = this.getUniqueCard();
            if (uniqueCard) {
                this.stats.uniqueCardsFromInterval++;
                return uniqueCard;
            }
            // Если уникальных карт нет, продолжаем обычную логику
        }
        
        // Обычная логика: случайная карта по вероятностям
        return this.getRandomCard();
    }
    
    // Добавить карту в коллекцию
    addCard(card, source = 'win') {
        if (!card) return false;
        
        const isDuplicate = this.collection[card.id] > 0;
        this.collection[card.id]++;
        
        if (isDuplicate) {
            this.stats.duplicates++;
        }
        
        this.stats.rarityDistribution[card.rarity]++;
        
        if (source === 'win') this.stats.cardsFromWins++;
        else if (source === 'draw') this.stats.cardsFromDraws++;
        else if (source === 'loss') this.stats.cardsFromLosses++;
        else if (source === 'daily') this.stats.cardsFromDaily++;
        
        return !isDuplicate;
    }
    
    // Купить карту в магазине
    buyCard(cardId) {
        const card = this.cardPool.find(c => c.id === cardId);
        if (!card) return false;
        
        if (this.collection[card.id] >= this.config.maxCopies) return false;
        
        const price = this.config.prices[card.rarity];
        if (this.coins < price) return false;
        
        this.coins -= price;
        this.stats.coinsSpent += price;
        this.addCard(card, 'bought');
        this.stats.cardsBought++;
        
        return true;
    }
    
    // Купить лучшую доступную карту
    buyBestAvailableCard() {
        // Приоритет: редкие > эпические > сильные > базовые
        const rarities = ['rare', 'epic', 'strong', 'basic'];
        
        for (const rarity of rarities) {
            const availableCards = this.cardPool.filter(card => 
                card.rarity === rarity && 
                this.collection[card.id] < this.config.maxCopies
            );
            
            if (availableCards.length > 0) {
                const price = this.config.prices[rarity];
                if (this.coins >= price) {
                    const card = availableCards[randomInt(0, availableCards.length - 1)];
                    this.buyCard(card.id);
                    return true;
                }
            }
        }
        
        return false;
    }
    
    // Симуляция одного дня
    simulateDay(day) {
        const gamesToday = Math.floor(this.config.gamesPerDay);
        const hasExtraGame = Math.random() < (this.config.gamesPerDay - gamesToday);
        const totalGames = gamesToday + (hasExtraGame ? 1 : 0);
        
        for (let game = 0; game < totalGames; game++) {
            this.stats.totalGames++;
            
            const rand = Math.random() * 100;
            const { winRate, drawRate } = this.config;
            
            let result;
            if (rand < winRate) {
                result = 'win';
                this.stats.wins++;
            } else if (rand < winRate + drawRate) {
                result = 'draw';
                this.stats.draws++;
            } else {
                result = 'loss';
                this.stats.losses++;
            }
            
            // Награды
            const reward = this.config.rewards[result];
            this.stats.coinsEarned += reward.coins;
            this.coins += reward.coins;
            
            // Механика: После первой победы выдаём 2 уникальные карты
            if (result === 'win' && !this.firstWinCompleted && this.config.firstWinBonusCards > 0) {
                for (let i = 0; i < this.config.firstWinBonusCards; i++) {
                    const uniqueCard = this.getUniqueCard();
                    if (uniqueCard) {
                        this.addCard(uniqueCard, 'win');
                        this.totalCardsObtained++;
                    }
                }
                this.firstWinCompleted = true;
            }
            
            // Карты за игру (с учётом новых механик)
            for (let i = 0; i < reward.cards; i++) {
                // Используем новую механику только для побед
                const isWin = result === 'win';
                const card = this.getCardWithMechanics(isWin);
                if (card) {
                    this.addCard(card, result);
                    this.totalCardsObtained++;
                }
            }
        }
        
        // Ежедневный бонус (обновлённая логика с монетами)
        if (this.config.enableDailyBonus) {
            const dailyBonus = this.getDailyBonus(day);
            if (dailyBonus) {
                if (dailyBonus.type === 'card' && dailyBonus.card) {
                    this.addCard(dailyBonus.card, 'daily');
                    this.totalCardsObtained++;
                } else if (dailyBonus.type === 'coins') {
                    this.coins += dailyBonus.amount;
                    this.stats.dailyCoinsEarned += dailyBonus.amount;
                    this.stats.coinsEarned += dailyBonus.amount;
                }
            }
        }
        
        // Покупка карт в магазине (тратим монеты на лучшие доступные)
        while (this.coins >= this.config.prices.basic) {
            if (!this.buyBestAvailableCard()) break;
        }
        
        // Запись прогресса
        const uniqueCards = Object.values(this.collection).filter(count => count > 0).length;
        this.stats.dailyProgress.push(day);
        this.stats.collectionProgress.push(uniqueCards);
        this.stats.coinsProgress.push(this.coins);
        
        return uniqueCards;
    }
    
    // Запуск симуляции
    run() {
        this.reset();
        
        let daysToCollect = null;
        
        for (let day = 1; day <= this.config.simulationDays; day++) {
            const uniqueCards = this.simulateDay(day);
            
            if (uniqueCards >= this.config.totalUniqueCards && !daysToCollect) {
                daysToCollect = day;
            }
        }
        
        return {
            daysToCollect,
            stats: { ...this.stats },
            collection: { ...this.collection },
            config: { ...this.config }
        };
    }
    
    // Множественная симуляция
    runMultiple(count) {
        const results = [];
        
        for (let i = 0; i < count; i++) {
            const result = this.run();
            results.push(result);
        }
        
        // Агрегация статистики
        const successfulRuns = results.filter(r => r.daysToCollect !== null);
        const daysList = successfulRuns.map(r => r.daysToCollect);
        
        return {
            individualResults: results,
            avgDaysToCollect: daysList.length > 0 ? 
                (daysList.reduce((a, b) => a + b, 0) / daysList.length).toFixed(1) : 'N/A',
            minDaysToCollect: daysList.length > 0 ? Math.min(...daysList) : 'N/A',
            maxDaysToCollect: daysList.length > 0 ? Math.max(...daysList) : 'N/A',
            successRate: ((successfulRuns.length / count) * 100).toFixed(1) + '%'
        };
    }
}

// ============================================
// ИНТЕРФЕЙС
// ============================================

function readConfigFromUI() {
    return {
        gamesPerDay: parseFloat(document.getElementById('gamesPerDay').value),
        winRate: parseFloat(document.getElementById('winRate').value),
        drawRate: parseFloat(document.getElementById('drawRate').value),
        simulationDays: parseInt(document.getElementById('simulationDays').value),
        simulationsCount: parseInt(document.getElementById('simulationsCount').value),
        
        rewards: {
            win: {
                cards: parseInt(document.getElementById('winCards').value),
                coins: parseInt(document.getElementById('winCoins').value)
            },
            draw: {
                cards: parseInt(document.getElementById('drawCards').value),
                coins: parseInt(document.getElementById('drawCoins').value)
            },
            loss: {
                cards: parseInt(document.getElementById('lossCards').value),
                coins: parseInt(document.getElementById('lossCoins').value)
            }
        },
        
        probabilities: {
            basic: parseFloat(document.getElementById('basicProb').value),
            strong: parseFloat(document.getElementById('strongProb').value),
            epic: parseFloat(document.getElementById('epicProb').value),
            rare: parseFloat(document.getElementById('rareProb').value)
        },
        
        totalUniqueCards: parseInt(document.getElementById('totalUniqueCards').value),
        maxCopies: parseInt(document.getElementById('maxCopies').value),
        
        prices: {
            basic: parseInt(document.getElementById('priceBasic').value),
            strong: parseInt(document.getElementById('priceStrong').value),
            epic: parseInt(document.getElementById('priceEpic').value),
            rare: parseInt(document.getElementById('priceRare').value)
        },
        
        enableDailyBonus: document.getElementById('enableDailyBonus').checked,
        dailyCoinsAmount: parseInt(document.getElementById('dailyCoinsAmount').value),
        uniqueCardInterval: parseInt(document.getElementById('uniqueCardInterval').value),
        guaranteedUniqueWins: parseInt(document.getElementById('guaranteedUniqueWins').value),
        
        // Начальные условия
        startingCards: parseInt(document.getElementById('startingCards').value),
        startingCoins: parseInt(document.getElementById('startingCoins').value),
        firstWinBonusCards: parseInt(document.getElementById('firstWinBonusCards').value)
    };
}

function displayResults(result, isMultiple = false) {
    document.getElementById('resultsPanel').style.display = 'block';
    
    if (isMultiple) {
        // Статистика по множественным запускам
        document.getElementById('multiSimStats').style.display = 'block';
        document.getElementById('avgDaysToCollect').textContent = result.avgDaysToCollect;
        document.getElementById('minDaysToCollect').textContent = result.minDaysToCollect;
        document.getElementById('maxDaysToCollect').textContent = result.maxDaysToCollect;
        document.getElementById('successRate').textContent = result.successRate;
        
        // Берём средний результат для отображения
        const avgResult = result.individualResults[0];
        displaySingleResult(avgResult);
    } else {
        document.getElementById('multiSimStats').style.display = 'none';
        displaySingleResult(result);
    }
    
    // Прокрутка к результатам
    document.getElementById('resultsPanel').scrollIntoView({ behavior: 'smooth' });
}

function displaySingleResult(result) {
    const { stats, daysToCollect } = result;
    
    // Ключевые метрики
    document.getElementById('daysToCollect').textContent = daysToCollect || 'Не собрано';
    document.getElementById('totalCardsObtained').textContent = 
        stats.cardsFromWins + stats.cardsFromDraws + stats.cardsFromLosses + stats.cardsFromDaily + stats.cardsBought;
    document.getElementById('cardsFromWins').textContent = stats.cardsFromWins;
    document.getElementById('cardsBought').textContent = stats.cardsBought;
    document.getElementById('coinsEarned').textContent = stats.coinsEarned;
    document.getElementById('coinsSpent').textContent = stats.coinsSpent;
    document.getElementById('coinsBalance').textContent = stats.coinsEarned - stats.coinsSpent;
    
    const totalCards = stats.cardsFromWins + stats.cardsFromDraws + stats.cardsFromLosses + stats.cardsFromDaily + stats.cardsBought;
    const dupRate = totalCards > 0 ? ((stats.duplicates / totalCards) * 100).toFixed(1) : 0;
    document.getElementById('duplicateRate').textContent = dupRate + '%';
    
    // Детальная статистика
    document.getElementById('totalGames').textContent = stats.totalGames;
    document.getElementById('totalWins').textContent = stats.wins;
    document.getElementById('totalDraws').textContent = stats.draws;
    document.getElementById('totalLosses').textContent = stats.losses;
    
    // Распределение по редкостям (уникальные карты)
    const numBasic = Math.floor(CONFIG.totalUniqueCards * 0.5);
    const numStrong = Math.floor(CONFIG.totalUniqueCards * 0.25);
    const numEpic = Math.floor(CONFIG.totalUniqueCards * 0.15);
    const numRare = CONFIG.totalUniqueCards - numBasic - numStrong - numEpic;
    
    document.getElementById('basicInCollection').textContent = `${Math.min(numBasic, stats.rarityDistribution.basic)} / ${numBasic}`;
    document.getElementById('strongInCollection').textContent = `${Math.min(numStrong, stats.rarityDistribution.strong)} / ${numStrong}`;
    document.getElementById('epicInCollection').textContent = `${Math.min(numEpic, stats.rarityDistribution.epic)} / ${numEpic}`;
    document.getElementById('rareInCollection').textContent = `${Math.min(numRare, stats.rarityDistribution.rare)} / ${numRare}`;
    
    document.getElementById('avgCoinsPerDay').textContent = Math.floor(stats.coinsEarned / stats.dailyProgress.length);
    document.getElementById('avgCardsPerDay').textContent = (totalCards / stats.dailyProgress.length).toFixed(2);
    
    // Графики
    updateCharts(stats, daysToCollect);
}

function updateCharts(stats, daysToCollect) {
    // Уничтожаем старые графики
    if (collectionChart) collectionChart.destroy();
    if (coinsChart) coinsChart.destroy();
    if (rarityChart) rarityChart.destroy();
    if (sourcesChart) sourcesChart.destroy();
    
    // Прогресс коллекции
    const ctxCollection = document.getElementById('collectionChart').getContext('2d');
    collectionChart = new Chart(ctxCollection, {
        type: 'line',
        data: {
            labels: stats.dailyProgress,
            datasets: [{
                label: 'Уникальных карт',
                data: stats.collectionProgress,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: CONFIG.totalUniqueCards
                }
            }
        }
    });
    
    // Баланс монет
    const ctxCoins = document.getElementById('coinsChart').getContext('2d');
    coinsChart = new Chart(ctxCoins, {
        type: 'line',
        data: {
            labels: stats.dailyProgress,
            datasets: [{
                label: 'Монеты',
                data: stats.coinsProgress,
                borderColor: '#f5576c',
                backgroundColor: 'rgba(245, 87, 108, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
    
    // Распределение по редкостям
    const ctxRarity = document.getElementById('rarityChart').getContext('2d');
    rarityChart = new Chart(ctxRarity, {
        type: 'doughnut',
        data: {
            labels: ['Базовые', 'Сильные', 'Эпические', 'Редкие'],
            datasets: [{
                data: [
                    stats.rarityDistribution.basic,
                    stats.rarityDistribution.strong,
                    stats.rarityDistribution.epic,
                    stats.rarityDistribution.rare
                ],
                backgroundColor: ['#4CAF50', '#FF9800', '#9C27B0', '#E91E63']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
    
    // Источники карт
    const ctxSources = document.getElementById('sourcesChart').getContext('2d');
    sourcesChart = new Chart(ctxSources, {
        type: 'bar',
        data: {
            labels: ['За победы', 'За ничьи', 'За поражения', 'Ежедневный бонус', 'Куплено'],
            datasets: [{
                label: 'Карт',
                data: [
                    stats.cardsFromWins,
                    stats.cardsFromDraws,
                    stats.cardsFromLosses,
                    stats.cardsFromDaily,
                    stats.cardsBought
                ],
                backgroundColor: ['#667eea', '#9c88ff', '#fbc531', '#4cd137', '#e84118']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function resetConfig() {
    document.getElementById('gamesPerDay').value = 3.5;
    document.getElementById('winRate').value = 50;
    document.getElementById('drawRate').value = 5;
    document.getElementById('simulationDays').value = 30;
    document.getElementById('simulationsCount').value = 1;
    
    document.getElementById('winCards').value = 2;
    document.getElementById('winCoins').value = 100;
    document.getElementById('drawCards').value = 1;
    document.getElementById('drawCoins').value = 50;
    document.getElementById('lossCards').value = 1;
    document.getElementById('lossCoins').value = 25;
    
    document.getElementById('basicProb').value = 70;
    document.getElementById('strongProb').value = 20;
    document.getElementById('epicProb').value = 7;
    document.getElementById('rareProb').value = 3;
    document.getElementById('totalUniqueCards').value = 30;
    document.getElementById('maxCopies').value = 4;
    
    document.getElementById('priceBasic').value = 175;
    document.getElementById('priceStrong').value = 500;
    document.getElementById('priceEpic').value = 850;
    document.getElementById('priceRare').value = 1200;
    
    document.getElementById('enableDailyBonus').checked = true;
    document.getElementById('dailyCoinsAmount').value = 500;
    document.getElementById('uniqueCardInterval').value = 10;
    document.getElementById('guaranteedUniqueWins').value = 5;
    
    // Начальные условия
    document.getElementById('startingCards').value = 6;
    document.getElementById('startingCoins').value = 200;
    document.getElementById('firstWinBonusCards').value = 2;
    
    // Обновляем отображение монет в ежедневном бонусе
    document.getElementById('dailyCoinsDisplay').textContent = '500';
    
    document.getElementById('resultsPanel').style.display = 'none';
}

// ============================================
// ЭКСПОРТ В EXCEL (CSV)
// ============================================

function exportToExcel() {
    if (!lastSimulationResult) {
        alert('Сначала запустите симуляцию!');
        return;
    }
    
    const result = lastSimulationResult;
    const { stats, daysToCollect, config, collection } = result;
    
    // Создаём CSV контент
    let csvContent = '\uFEFF'; // BOM для корректного отображения кириллицы в Excel
    
    // Лист 1: Общая статистика
    csvContent += '=== ОБЩАЯ СТАТИСТИКА ===\n';
    csvContent += 'Параметр;Значение\n';
    csvContent += `Дней до сбора коллекции;${daysToCollect || 'Не собрано'}\n`;
    csvContent += `Всего игр;${stats.totalGames}\n`;
    csvContent += `Побед;${stats.wins}\n`;
    csvContent += `Ничьих;${stats.draws}\n`;
    csvContent += `Поражений;${stats.losses}\n`;
    csvContent += `Всего карт получено;${stats.cardsFromWins + stats.cardsFromDraws + stats.cardsFromLosses + stats.cardsFromDaily + stats.cardsBought}\n`;
    csvContent += `Карт за победы;${stats.cardsFromWins}\n`;
    csvContent += `Карт за ничьи;${stats.cardsFromDraws}\n`;
    csvContent += `Карт за поражения;${stats.cardsFromLosses}\n`;
    csvContent += `Карт из ежедневного бонуса;${stats.cardsFromDaily}\n`;
    csvContent += `Карт куплено;${stats.cardsBought}\n`;
    csvContent += `Заработано монет;${stats.coinsEarned}\n`;
    csvContent += `Потрачено монет;${stats.coinsSpent}\n`;
    csvContent += `Баланс монет;${stats.coinsEarned - stats.coinsSpent}\n`;
    csvContent += `Монет из ежедневного бонуса;${stats.dailyCoinsEarned}\n`;
    csvContent += `Дубликатов карт;${stats.duplicates}\n`;
    csvContent += `Уникальных карт по интервалу;${stats.uniqueCardsFromInterval}\n`;
    csvContent += `Уникальных карт по гарантированным победам;${stats.uniqueCardsFromGuaranteed}\n`;
    csvContent += `\n`;
    
    // Лист 2: Распределение по редкостям
    csvContent += '=== РАСПРЕДЕЛЕНИЕ ПО РЕДКОСТЯМ ===\n';
    csvContent += 'Редкость;Получено карт\n';
    csvContent += `Базовые;${stats.rarityDistribution.basic}\n`;
    csvContent += `Сильные;${stats.rarityDistribution.strong}\n`;
    csvContent += `Эпические;${stats.rarityDistribution.epic}\n`;
    csvContent += `Редкие;${stats.rarityDistribution.rare}\n`;
    csvContent += `\n`;
    
    // Лист 3: Настройки симуляции
    csvContent += '=== НАСТРОЙКИ СИМУЛЯЦИИ ===\n';
    csvContent += 'Параметр;Значение\n';
    csvContent += `Игр в день;${config.gamesPerDay}\n`;
    csvContent += `Процент побед;${config.winRate}%\n`;
    csvContent += `Процент ничьих;${config.drawRate}%\n`;
    csvContent += `Дней симуляции;${config.simulationDays}\n`;
    csvContent += `Всего уникальных карт;${config.totalUniqueCards}\n`;
    csvContent += `Максимум копий карты;${config.maxCopies}\n`;
    csvContent += `Ежедневный бонус включён;${config.enableDailyBonus ? 'Да' : 'Нет'}\n`;
    csvContent += `Монет в день выплаты;${config.dailyCoinsAmount}\n`;
    csvContent += `Каждую N-ю карту уникальной;${config.uniqueCardInterval > 0 ? config.uniqueCardInterval : 'Отключено'}\n`;
    csvContent += `Первые X побед - уникальные карты;${config.guaranteedUniqueWins > 0 ? config.guaranteedUniqueWins : 'Отключено'}\n`;
    csvContent += `Начальные карты;${config.startingCards}\n`;
    csvContent += `Начальный бюджет (монеты);${config.startingCoins}\n`;
    csvContent += `Карт за первую победу;${config.firstWinBonusCards}\n`;
    csvContent += `\n`;
    
    // Лист 4: Прогресс по дням
    csvContent += '=== ПРОГРЕСС ПО ДНЯМ ===\n';
    csvContent += 'День;Уникальных карт;Монеты\n';
    for (let i = 0; i < stats.dailyProgress.length; i++) {
        csvContent += `${stats.dailyProgress[i]};${stats.collectionProgress[i]};${stats.coinsProgress[i]}\n`;
    }
    csvContent += `\n`;
    
    // Лист 5: Коллекция (детально по каждой карте)
    csvContent += '=== КОЛЛЕКЦИЯ ===\n';
    csvContent += 'ID карты;Редкость;Количество\n';
    const numBasic = Math.floor(config.totalUniqueCards * 0.5);
    const numStrong = Math.floor(config.totalUniqueCards * 0.25);
    const numEpic = Math.floor(config.totalUniqueCards * 0.15);
    const numRare = config.totalUniqueCards - numBasic - numStrong - numEpic;
    
    let cardId = 0;
    // Базовые
    for (let i = 0; i < numBasic; i++) {
        csvContent += `${cardId};Базовая;${collection[cardId]}\n`;
        cardId++;
    }
    // Сильные
    for (let i = 0; i < numStrong; i++) {
        csvContent += `${cardId};Сильная;${collection[cardId]}\n`;
        cardId++;
    }
    // Эпические
    for (let i = 0; i < numEpic; i++) {
        csvContent += `${cardId};Эпическая;${collection[cardId]}\n`;
        cardId++;
    }
    // Редкие
    for (let i = 0; i < numRare; i++) {
        csvContent += `${cardId};Редкая;${collection[cardId]}\n`;
        cardId++;
    }
    
    // Создаём и скачиваем файл
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    link.setAttribute('href', url);
    link.setAttribute('download', `simulation_export_${timestamp}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ============================================
// ОБРАБОТЧИКИ СОБЫТИЙ
// ============================================

document.getElementById('runSimBtn').addEventListener('click', () => {
    const config = readConfigFromUI();
    const simulator = new CardGameSimulator(config);
    const result = simulator.run();
    lastSimulationResult = result; // Сохраняем для экспорта
    displayResults(result, false);
});

document.getElementById('runMultipleBtn').addEventListener('click', () => {
    const config = readConfigFromUI();
    const simulator = new CardGameSimulator(config);
    const result = simulator.runMultiple(100);
    displayResults(result, true);
});

document.getElementById('resetBtn').addEventListener('click', resetConfig);

// Обновление отображения монет в ежедневном бонусе
document.getElementById('dailyCoinsAmount').addEventListener('input', (e) => {
    document.getElementById('dailyCoinsDisplay').textContent = e.target.value;
});

// ============================================
// ИНИЦИАЛИЗАЦИЯ
// ============================================
console.log('Симулятор экономики ККИ готов!');
console.log('Настрой параметры и запусти симуляцию.');
