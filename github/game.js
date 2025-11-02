// Idle-Time Knight — Tabs + pagination level selector
// Replace previous game.js with this file. Preserves game systems; adds pagination UI for levels,
// removes Store tab and hides Log. Tabs: Run, Upgrades, Items.

const stateKey = 'idleKnightState_v6';
let state = {
  gold: 0,
  passivePerSec: 0,
  clickPower: 1,
  owned: { auto: 0, sword: 0, strike: 0, healthUp: 0, dodge: 0 },
  costs: { auto: 10, sword: 15, strike: 50, health: 80, dodge: 1000 },
  prestige: 0,
  lastSaved: Date.now(),
  unlockedLevel: 1,
  completedLevels: {},
  playerMaxHP: 20,
  playerHP: 20,
  autoAttackInterval: 10000,
  inventory: {}
};

let run = {
  active: false,
  timeLeft: 10,
  maxTime: 10,
  enemyHP: 10,
  enemyHPMax: 10,
  baseReward: 10,
  currentLevel: 1,
  currentMonsterType: null,
  enemyAttackInterval: 2500,
  nextEnemyAttackAt: 0
};

const offlineCapSeconds = 3600;
const popupsMap = new Map();
const popupLifetime = 3000;

const ITEMS = {
  'potion_common': { id:'potion_common', name:'Minor Potion', rarity:'Common', heal:6 },
  'potion_uncommon': { id:'potion_uncommon', name:'Lesser Potion', rarity:'Uncommon', heal:12 },
  'potion_rare': { id:'potion_rare', name:'Greater Potion', rarity:'Rare', heal:28 },
  'potion_epic': { id:'potion_epic', name:'Elixir', rarity:'Epic', heal:60 }
};

const monsterTypes = [
  { name: 'Grub', hpMul: 1.0, dropBase: [80,15,4,1] },
  { name: 'Crawler', hpMul: 1.25, dropBase: [65,22,10,3] },
  { name: 'Skull', hpMul: 1.45, dropBase: [55,28,13,4] },
  { name: 'Golem', hpMul: 1.9, dropBase: [40,35,18,7] },
  { name: 'Wraith', hpMul: 2.6, dropBase: [25,35,25,15] }
];

// UI refs
const el = id => document.getElementById(id);
const goldEl = el('gold');
const passiveEl = el('passive');
const prestigeEl = el('prestige');
const timeLeftEl = el('time-left');
const enemyHpEl = el('enemy-hp');
const runBonusEl = el('run-bonus');
const costAutoEl = el('cost-auto');
const costSwordEl = el('cost-sword');
const costStrikeEl = el('cost-strike');
const costHealthEl = el('cost-health');
const costDodgeEl = el('cost-dodge');
const ownAutoEl = el('own-auto');
const ownSwordEl = el('own-sword');
const ownStrikeEl = el('own-strike');
const ownHealthEl = el('own-health');
const ownDodgeEl = el('own-dodge');
const messagesEl = el('messages');
const popupContainer = el('popup-container');
const monsterEl = el('monster');
const levelNumEl = el('level-num');
const levelPagination = el('level-pagination');
const prevLevelBtn = el('prev-level-btn');
const nextLevelBtn = el('next-level-btn');
const playerHpBar = el('player-hp-bar');
const playerHpText = el('player-hp-text');
const playerRunner = el('player-runner');
const itemsListEl = el('items-list');
const openInventoryBtn = el('open-inventory-btn');
const dodgeChanceEl = el('dodge-chance');

const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
const screens = Array.from(document.querySelectorAll('.screen'));

// audio
let audioCtx = null;
function initAudio(){ try{ audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ audioCtx=null; } }
function playBeep(f=440,d=0.08,t='sine',v=0.08){ if(!audioCtx) return; const o=audioCtx.createOscillator(),g=audioCtx.createGain(); o.type=t; o.frequency.value=f; g.gain.value=v; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+d); setTimeout(()=>{try{o.disconnect();g.disconnect();}catch(e){}},(d+0.05)*1000); }
function sfxHit(){ playBeep(700,0.06,'square',0.06); } function sfxHurt(){ playBeep(200,0.09,'sine',0.08); } function sfxVictory(){ playBeep(880,0.16,'sawtooth',0.12); playBeep(1320,0.08,'sine',0.08); } function sfxPurchase(){ playBeep(1200,0.05,'triangle',0.06); }

// persistence
function loadState(){
  const raw = localStorage.getItem(stateKey);
  if(raw){
    try{
      const s = JSON.parse(raw);
      Object.assign(state, s);
      state.inventory = state.inventory || {};
      state.playerHP = Math.min(state.playerHP ?? state.playerMaxHP, state.playerMaxHP);
      const now = Date.now();
      const elapsed = Math.floor((now - (state.lastSaved || now))/1000);
      if(elapsed > 0){
        const offSec = Math.min(elapsed, offlineCapSeconds);
        const offlineGain = offSec * state.passivePerSec;
        state.gold += offlineGain;
        addPopup(`Away ${elapsed}s — applied ${offSec}s (${format(offlineGain)} gold)`);
      }
    }catch(e){ console.error('load error', e); }
  }
  saveState();
}
function saveState(){ state.lastSaved = Date.now(); localStorage.setItem(stateKey, JSON.stringify(state)); }
function format(n){ return Math.floor(n); }

// popups: damage shows last hit X and count Y
function createPopupElement(text){ const p=document.createElement('div'); p.className='popup'; p.textContent=text; return p; }
function addPopup(text, options={}){ return addPopupInternal(text, options); }
function addPopupInternal(text, options={}){
  const isDamage = !!options.isDamage;
  const mapKey = isDamage ? 'damage' : (options.key ?? text);

  if(popupsMap.has(mapKey)){
    const e = popupsMap.get(mapKey);
    if(isDamage){
      e.count += 1;
      e.lastHit = options.damageAmount || e.lastHit || 0;
      e.el.textContent = `You hit for ${e.lastHit} damage (${e.count})`;
    } else {
      e.count += 1;
      e.el.textContent = `${text} `;
      let c = e.el.querySelector('.count');
      if(!c){ c = document.createElement('span'); c.className='count'; e.el.appendChild(c); }
      c.textContent = `(${e.count})`;
    }
    clearTimeout(e.timeoutId);
    e.timeoutId = setTimeout(()=> removePopup(mapKey), popupLifetime);
    return e.el;
  }

  const elp = createPopupElement(text);
  popupContainer.prepend(elp);
  const entry = { el: elp, count: isDamage ? 1 : 1, lastHit: isDamage ? (options.damageAmount || 0) : undefined, timeoutId: setTimeout(()=> removePopup(mapKey), popupLifetime) };
  if(isDamage) elp.textContent = `You hit for ${entry.lastHit} damage (${entry.count})`;
  popupsMap.set(mapKey, entry);
  return elp;
}
function removePopup(key){ const e = popupsMap.get(key); if(!e) return; clearTimeout(e.timeoutId); e.el.style.opacity='0'; e.el.style.transform='translateY(-8px)'; setTimeout(()=>{ try{ e.el.remove(); }catch(_){} },220); popupsMap.delete(key); }
function log(msg){ const p=document.createElement('div'); p.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`; messagesEl.prepend(p); }

// helpers for levels & monsters
function levelBaseHP(level){ return 10 + Math.floor(level * 3) + Math.floor((level - 1) / 5) * 12; }
function levelReward(level){ return Math.max(1, Math.floor(8 + level * 2.5)); }
function enemyAttackIntervalForLevel(level){ const base=2500; const reduction = Math.min(1600, (level - 1)*60); return Math.max(600, base - reduction); }
function monsterStyleForLevel(level){ return `style-${((Math.floor((level - 1) / 5)) % 4) + 1}`; }
function pickMonsterForLevel(level){ const idx = Math.floor(Math.random() * Math.min(monsterTypes.length, 2 + Math.floor(level/5))); return monsterTypes[idx] || monsterTypes[0]; }

// drop roll
function rollDrop(monsterTypeObj, level){
  const base = monsterTypeObj.dropBase.slice();
  const bonus = Math.min(40, Math.floor(level * 0.8));
  base[0] = Math.max(1, base[0] - Math.floor(bonus * 0.6));
  base[1] = base[1] + Math.floor(bonus * 0.25);
  base[2] = base[2] + Math.floor(bonus * 0.1);
  base[3] = base[3] + Math.floor(bonus * 0.05);
  const weighted = [];
  for(let i=0;i<base[0];i++) weighted.push('potion_common');
  for(let i=0;i<base[1];i++) weighted.push('potion_uncommon');
  for(let i=0;i<base[2];i++) weighted.push('potion_rare');
  for(let i=0;i<base[3];i++) weighted.push('potion_epic');
  if(weighted.length === 0) return null;
  const pick = weighted[Math.floor(Math.random()*weighted.length)];
  return ITEMS[pick] || null;
}

// inventory helpers
function addItemToInventory(itemId, count=1){ state.inventory[itemId] = (state.inventory[itemId]||0) + count; saveState(); renderItemsList(); }
function useItem(itemId){ const it = ITEMS[itemId]; if(!it) return; if((state.inventory[itemId]||0) <= 0){ addPopup('No that item in inventory'); return; } state.inventory[itemId] -= 1; state.playerHP = Math.min(state.playerMaxHP, state.playerHP + it.heal); addPopup(`Used ${it.name} (+${it.heal} HP)`); sfxPurchase(); saveState(); renderItemsList(); updateUI(); }

// rendering functions
function patternForLevel(level, typeIndex=0){
  const group = Math.floor((level - 1) / 5) % 4;
  const templates = [
    [[0,0,1,1,1,0,0],[0,1,1,1,1,1,0],[1,1,3,1,3,1,1],[1,1,1,1,1,1,1],[1,1,4,1,4,1,1],[0,1,1,1,1,1,0],[0,0,1,1,1,0,0]],
    [[0,0,2,2,2,0,0],[0,2,2,2,2,2,0],[2,2,0,2,0,2,2],[2,2,2,2,2,2,2],[0,2,2,4,2,2,0],[0,0,2,2,2,0,0],[0,0,0,2,0,0,0]],
    [[0,5,5,5,5,5,0],[5,1,1,1,1,1,5],[5,1,3,1,3,1,5],[5,1,1,1,1,1,5],[5,1,4,1,4,1,5],[5,1,1,1,1,1,5],[0,5,5,5,5,5,0]],
    [[0,0,1,1,1,0,0],[0,1,1,1,1,1,0],[1,1,1,3,1,1,1],[1,1,1,1,1,1,1],[1,1,4,1,4,1,1],[0,1,1,1,1,1,0],[0,0,1,1,1,0,0]]
  ];
  const base = templates[group];
  const out = base.map(row => row.slice());
  if(typeIndex % 2 === 1){ out[0][1] = out[0][5] = 5; out[6][1] = out[6][5] = 5; }
  if(typeIndex === 3){ out[2][2] = 3; out[2][4] = 3; out[4][2] = 4; out[4][4] = 4; }
  return out;
}

function renderMonster(patternOverride){
  const style = monsterStyleForLevel(run.currentLevel);
  monsterEl.className = `monster ${style}`;
  const pattern = patternOverride ?? patternForLevel(run.currentLevel);
  monsterEl.innerHTML = '';
  for(let r=0;r<7;r++){
    const row = document.createElement('div'); row.className = 'pixel-row r'+(r+1);
    for(let c=0;c<7;c++){
      const px = document.createElement('div'); px.className = 'pixel'; const colIndex = pattern[r][c]; px.classList.add('c'+colIndex); row.appendChild(px);
    }
    monsterEl.appendChild(row);
  }
}

function renderItemsList(){
  itemsListEl.innerHTML = '';
  Object.values(ITEMS).forEach(it=>{
    const row = document.createElement('div'); row.className='item-row';
    const meta = document.createElement('div'); meta.className='item-meta';
    const title = document.createElement('div'); title.textContent = `${it.name} — ${it.rarity}`;
    const sub = document.createElement('div'); sub.style.fontSize='11px'; sub.style.color='#9fb6d9'; sub.textContent = `Heals ${it.heal} HP`;
    meta.appendChild(title); meta.appendChild(sub);
    const actions = document.createElement('div'); actions.className='item-actions';
    const cnt = document.createElement('div'); cnt.textContent = `x${state.inventory[it.id]||0}`; cnt.style.marginBottom='6px';
    const buyBtn = document.createElement('button'); buyBtn.textContent='Buy (20g)'; buyBtn.onclick = ()=>{
      if(state.gold >= 20){ state.gold -= 20; addItemToInventory(it.id,1); addPopup(`Bought ${it.name}`); saveState(); updateUI(); sfxPurchase(); } else addPopup('Not enough gold to buy item');
    };
    const useBtn = document.createElement('button'); useBtn.textContent='Use'; useBtn.onclick = ()=> useItem(it.id);
    actions.appendChild(cnt); actions.appendChild(buyBtn); actions.appendChild(useBtn);
    row.appendChild(meta); row.appendChild(actions);
    itemsListEl.appendChild(row);
  });
}

// purchase functions
function buyAuto(){ if(state.gold >= state.costs.auto){ state.gold -= state.costs.auto; state.owned.auto +=1; state.passivePerSec +=1; state.costs.auto = Math.ceil(state.costs.auto * 1.15); addPopup('Bought Auto Squire (+1 passive/sec)'); sfxPurchase(); saveState(); updateUI(); } else addPopup('Not enough gold for Auto Squire'); }
function buySword(){ if(state.gold >= state.costs.sword){ state.gold -= state.costs.sword; state.owned.sword +=1; state.clickPower +=1; state.costs.sword = Math.ceil(state.costs.sword * 1.18); addPopup('Bought Sharper Sword (+1 click power)'); sfxPurchase(); saveState(); updateUI(); } else addPopup('Not enough gold for Sharper Sword'); }
function buyStrike(){ if(state.gold >= state.costs.strike){ state.gold -= state.costs.strike; state.owned.strike +=1; state.autoAttackInterval = Math.max(500, Math.floor(state.autoAttackInterval / 2)); state.costs.strike = Math.ceil(state.costs.strike * 1.9); addPopup('Bought Squire Strike (auto-attack faster)'); sfxPurchase(); saveState(); updateUI(); } else addPopup('Not enough gold for Squire Strike'); }
function buyHealth(){ if(state.gold >= state.costs.health){ state.gold -= state.costs.health; state.owned.healthUp +=1; state.playerMaxHP += 8; state.playerHP = state.playerMaxHP; state.costs.health = Math.ceil(state.costs.health * 1.8); addPopup('Bought Health Upgrade (+8 Max HP)'); sfxPurchase(); saveState(); updateUI(); } else addPopup('Not enough gold for Health Upgrade'); }
function buyDodge(){ if(state.gold >= state.costs.dodge){ state.gold -= state.costs.dodge; state.owned.dodge += 1; state.costs.dodge = Math.ceil(state.costs.dodge * 2.4); addPopup('Bought Dodge Chance (+1%)'); sfxPurchase(); saveState(); updateUI(); } else addPopup('Not enough gold for Dodge Chance'); }

// prepare enemy
let currentMonsterType = null;
function prepareEnemyForCurrentLevel(){
  currentMonsterType = pickMonsterForLevel(run.currentLevel);
  const baseHP = levelBaseHP(run.currentLevel);
  run.enemyHPMax = Math.max(6, Math.floor(baseHP * (currentMonsterType.hpMul || 1)));
  run.enemyHP = run.enemyHPMax;
  run.enemyAttackInterval = enemyAttackIntervalForLevel(run.currentLevel);
  run.nextEnemyAttackAt = performance.now() + run.enemyAttackInterval;
  const typeIndex = monsterTypes.indexOf(currentMonsterType);
  renderMonster(patternForLevel(run.currentLevel, typeIndex));
}

// run lifecycle
let lastAutoAttackAt = 0;
function startRun(){ if(run.active) return; run.active = true; run.timeLeft = run.maxTime; prepareEnemyForCurrentLevel(); addPopup(`Run started at Level ${run.currentLevel}`); sfxHit(); runnerStart(); updateUI(); }
function endRun(success){
  run.active = false; runnerStop();
  const perfBonus = success ? 1 + (run.timeLeft / run.maxTime) : 0.5;
  const rewardBase = levelReward(run.currentLevel);
  const reward = Math.floor(rewardBase * perfBonus * (1 + state.prestige * 0.1));
  if(success){
    state.gold += reward; addPopup(`Victory! +${format(reward)} gold`); sfxVictory();
    state.completedLevels[run.currentLevel] = true;
    const drop = rollDrop(currentMonsterType, run.currentLevel);
    if(drop){ addItemToInventory(drop.id,1); addPopup(`Monster dropped: ${drop.name} (${drop.rarity})`); }
    state.unlockedLevel = Math.max(state.unlockedLevel, run.currentLevel + 1);
    run.currentLevel += 1; prepareEnemyForCurrentLevel(); addPopup(`Advanced to Level ${run.currentLevel}`);
  } else {
    const loss = Math.floor(state.gold * 0.08); state.gold = Math.max(0, state.gold - loss);
    addPopup(`Defeated — lost ${loss} gold`); sfxHurt(); state.playerHP = state.playerMaxHP;
  }
  saveState(); updateUI(); removePopup('damage');
}

// attack & enemy attack with dodge
function attack(dmgSource='player'){
  if(!run.active){ addPopup('Start a run first'); return; }
  const dmg = state.clickPower;
  run.enemyHP -= dmg;
  addPopup(`You hit for ${dmg} damage`, { isDamage:true, damageAmount: dmg });
  monsterEl.classList.add('flash-red'); monsterEl.classList.add('hit');
  setTimeout(()=> monsterEl.classList.remove('flash-red'), 260); setTimeout(()=> monsterEl.classList.remove('hit'), 280);
  sfxHit();
  if(run.enemyHP <= 0){ endRun(true); removePopup('damage'); }
  updateUI();
}
function enemyDoAttack(){
  const dodgeChance = Math.min(75, state.owned.dodge);
  const roll = Math.random() * 100;
  if(roll < dodgeChance){ addPopup('You dodged the attack!', { key: 'dodge' }); sfxHit(); return; }
  const base = Math.max(1, Math.floor(run.currentLevel * 1.2));
  const variability = Math.floor(Math.random() * Math.max(1, Math.round(base*0.6)));
  const dmg = Math.max(1, base + variability - Math.floor(state.prestige * 0.2));
  state.playerHP = Math.max(0, state.playerHP - dmg);
  addPopup(`You take ${dmg} damage`, { key:`hurt-${dmg}` });
  playerRunner.classList.add('flash'); setTimeout(()=> playerRunner.classList.remove('flash'), 160);
  sfxHurt();
  if(state.playerHP <= 0) endRun(false);
  saveState(); updateUI();
}

// auto attack
function maybeAutoAttack(now){ if(!run.active) return; if(state.owned.strike <= 0) return; if(!lastAutoAttackAt) lastAutoAttackAt = now; const interval = state.autoAttackInterval; if(now - lastAutoAttackAt >= interval){ lastAutoAttackAt = now; attack('auto'); } }

// runner
let runnerAnimId = null; let runnerPos = -20; let runnerDir = 1;
function runnerStart(){ runnerPos = -20; runnerDir = 1; playerRunner.style.left = `${runnerPos}px`; if(runnerAnimId) cancelAnimationFrame(runnerAnimId); function step(){ runnerPos += 2.4 * runnerDir; if(runnerPos > 190){ runnerDir = -1; runnerPos = 190; } if(runnerPos < -10){ runnerDir = 1; runnerPos = -10; } playerRunner.style.left = `${runnerPos}px`; runnerAnimId = requestAnimationFrame(step); } runnerAnimId = requestAnimationFrame(step); }
function runnerStop(){ if(runnerAnimId) cancelAnimationFrame(runnerAnimId); runnerAnimId = null; }

// ticks
setInterval(()=>{ state.gold += state.passivePerSec; saveState(); updateUI(); }, 1000);
setInterval(()=>{ const now = performance.now(); if(run.active){ run.timeLeft -= 0.1; if(now >= run.nextEnemyAttackAt){ run.nextEnemyAttackAt = now + run.enemyAttackInterval; if(run.enemyHP > 0) enemyDoAttack(); } maybeAutoAttack(now); if(run.timeLeft <= 0) endRun(run.enemyHP <= 0); } updateUI(); }, 100);

// pagination renderer
function renderPagination(totalLevels, current, unlocked){
  levelPagination.innerHTML = '';
  if(totalLevels <= 1) return;
  const pushPage = (n, text) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (n===current ? ' current' : '');
    b.textContent = text ?? n;
    if(n > unlocked) b.disabled = true;
    b.addEventListener('click', ()=> {
      if(n > unlocked) { addPopup(`Level ${n} locked`); return; }
      run.currentLevel = n;
      prepareEnemyForCurrentLevel();
      addPopup(`Selected Level ${n}`);
      updateUI();
    });
    levelPagination.appendChild(b);
  };

  const pushEllipsis = () => {
    const s = document.createElement('span'); s.className='page-ellipsis'; s.textContent = '...'; levelPagination.appendChild(s);
  };

  // always show first
  pushPage(1);
  // determine window
  const windowRadius = 2; // show current +/- 2
  const left = Math.max(2, current - windowRadius);
  const right = Math.min(totalLevels-1, current + windowRadius);

  if(left > 2) pushEllipsis();
  for(let i=left;i<=right;i++) pushPage(i);
  if(right < totalLevels-1) pushEllipsis();
  if(totalLevels > 1) pushPage(totalLevels);
}

// UI updates & rendering
function updateUI(){
  goldEl.textContent = `Gold: ${format(state.gold)}`; // always visible
  passiveEl.textContent = `Passive/sec: ${state.passivePerSec.toFixed(1)}`;
  prestigeEl.textContent = `Prestige: ${state.prestige}`;
  timeLeftEl.textContent = run.timeLeft.toFixed(1);
  enemyHpEl.textContent = `${format(run.enemyHP)}/${format(run.enemyHPMax)}`;
  runBonusEl.textContent = `${(1 + state.prestige * 0.1).toFixed(2)}x`;
  costAutoEl.textContent = format(state.costs.auto);
  costSwordEl.textContent = format(state.costs.sword);
  costStrikeEl.textContent = format(state.costs.strike);
  costHealthEl.textContent = format(state.costs.health);
  costDodgeEl.textContent = format(state.costs.dodge);
  ownAutoEl.textContent = state.owned.auto;
  ownSwordEl.textContent = state.owned.sword;
  ownStrikeEl.textContent = state.owned.strike;
  ownHealthEl.textContent = state.owned.healthUp;
  ownDodgeEl.textContent = state.owned.dodge;
  levelNumEl.textContent = run.currentLevel;
  playerHpBar.style.width = `${(state.playerHP / state.playerMaxHP) * 100}%`;
  playerHpText.textContent = `${state.playerHP}/${state.playerMaxHP}`;
  dodgeChanceEl.textContent = `${Math.min(75, state.owned.dodge)}%`;
  // render pagination: show up to N levels (we'll expose a virtual cap, e.g., 200)
  const totalLevelsToShow = Math.max(state.unlockedLevel, 20);
  renderPagination(totalLevelsToShow, run.currentLevel, state.unlockedLevel);
  renderMonster();
  renderItemsList();
}

// renderItemsList reused from previous code
function renderItemsList(){
  itemsListEl.innerHTML = '';
  Object.values(ITEMS).forEach(it=>{
    const row = document.createElement('div'); row.className='item-row';
    const meta = document.createElement('div'); meta.className='item-meta';
    const title = document.createElement('div'); title.textContent = `${it.name} — ${it.rarity}`;
    const sub = document.createElement('div'); sub.style.fontSize='11px'; sub.style.color='#9fb6d9'; sub.textContent = `Heals ${it.heal} HP`;
    meta.appendChild(title); meta.appendChild(sub);
    const actions = document.createElement('div'); actions.className='item-actions';
    const cnt = document.createElement('div'); cnt.textContent = `x${state.inventory[it.id]||0}`; cnt.style.marginBottom='6px';
    const buyBtn = document.createElement('button'); buyBtn.textContent='Buy (20g)'; buyBtn.onclick = ()=>{
      if(state.gold >= 20){ state.gold -= 20; addItemToInventory(it.id,1); addPopup(`Bought ${it.name}`); saveState(); updateUI(); sfxPurchase(); } else addPopup('Not enough gold to buy item');
    };
    const useBtn = document.createElement('button'); useBtn.textContent='Use'; useBtn.onclick = ()=> useItem(it.id);
    actions.appendChild(cnt); actions.appendChild(buyBtn); actions.appendChild(useBtn);
    row.appendChild(meta); row.appendChild(actions);
    itemsListEl.appendChild(row);
  });
}

// wiring & events
el('buy-auto').addEventListener('click', buyAuto);
el('buy-sword').addEventListener('click', buySword);
el('buy-strike').addEventListener('click', buyStrike);
el('buy-health').addEventListener('click', buyHealth);
el('buy-dodge').addEventListener('click', buyDodge);
el('start-run-btn').addEventListener('click', startRun);
el('attack-btn').addEventListener('click', ()=> attack('player'));
el('prestige-btn').addEventListener('click', ()=>{ if(state.gold < 200){ addPopup('Need 200 gold to Ascend'); return; } state.gold = 0; state.passivePerSec = 0; state.clickPower = 1; state.owned = { auto:0, sword:0, strike:0, healthUp:0, dodge:0 }; state.costs = { auto:10, sword:15, strike:50, health:80, dodge:1000 }; state.prestige += 1; state.playerHP = state.playerMaxHP; addPopup('You ascended! Prestige +1'); saveState(); updateUI(); });
openInventoryBtn.addEventListener('click', ()=>{ renderItemsList(); addPopup('Inventory refreshed'); });

// tab switching
tabButtons.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    tabButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.getAttribute('data-screen');
    screens.forEach(s => s.classList.remove('active'));
    const screenEl = document.getElementById(target);
    if(screenEl) screenEl.classList.add('active');
  });
});

// init
initAudio();
loadState();
prepareEnemyForCurrentLevel_initial();
updateUI();
addPopup('Game loaded — pagination enabled');
log('Game loaded');

// helper functions referenced above
function prepareEnemyForCurrentLevel_initial(){ run.currentLevel = run.currentLevel || 1; prepareEnemyForCurrentLevel(); renderItemsList(); updateUI(); }
function prepareEnemyForCurrentLevel(){ currentMonsterType = pickMonsterForLevel(run.currentLevel); const baseHP = levelBaseHP(run.currentLevel); run.enemyHPMax = Math.max(6, Math.floor(baseHP * (currentMonsterType.hpMul || 1))); run.enemyHP = run.enemyHPMax; run.enemyAttackInterval = enemyAttackIntervalForLevel(run.currentLevel); run.nextEnemyAttackAt = performance.now() + run.enemyAttackInterval; const typeIndex = monsterTypes.indexOf(currentMonsterType); renderMonster(patternForLevel(run.currentLevel, typeIndex)); }

// small utility placeholders for earlier references (patternForLevel already defined above)
function format(n){ return Math.floor(n); }
function sfxPurchase(){ playBeep(1200,0.05,'triangle',0.06); }