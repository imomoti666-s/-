(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const H = 720;
  let W = canvas.width;

  function fitCanvasToViewport() {
    const rect = canvas.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return false;
    const nextWidth = clampCanvasWidth(Math.round(H * rect.width / rect.height));
    if (canvas.width === nextWidth && canvas.height === H) {
      W = nextWidth;
      return false;
    }
    canvas.width = nextWidth;
    canvas.height = H;
    W = nextWidth;
    return true;
  }

  const clampCanvasWidth = width => Math.max(640, Math.min(2200, width));
  fitCanvasToViewport();
  const ctx = canvas.getContext('2d', { alpha: false });
  const FLOOR = 590;
  const WORLD_W = 2800;
  const PLAYER_DRAW_SIZE = 252;
  const PLAYER_BODY_HEIGHT = 216;
  const SPRITE_CELL = 384;
  const SPRITE_BASELINE = 362;
  const ATTACK_FRAMES = 20;
  const ATTACK_KEYS = 5;
  const ATTACK_CONTEXT_ROW = { idle: 0, move: 1, dodge: 2, air: 3 };
  const BOW_CHARGE_FACTOR = { idle: 1, move: .78, dodge: .46, air: .5 };

  const ui = {
    boot: document.querySelector('#bootScreen'),
    start: document.querySelector('#startButton'),
    assetStatus: document.querySelector('#assetStatus'),
    hpText: document.querySelector('#hpText'),
    hpBar: document.querySelector('#hpBar'),
    dashText: document.querySelector('#dashText'),
    dashBar: document.querySelector('#dashBar'),
    kills: document.querySelector('#killCount'),
    notice: document.querySelector('#notice'),
    help: document.querySelector('#helpDialog'),
    helpButton: document.querySelector('#helpButton'),
    loadout: document.querySelector('#loadoutDialog'),
    loadoutButton: document.querySelector('#loadoutButton'),
    applyLoadout: document.querySelector('#applyLoadout'),
    slots: [document.querySelector('#slot0'), document.querySelector('#slot1')],
    switchWeapon: document.querySelector('#switchWeapon'),
    landscapeButton: document.querySelector('#landscapeButton'),
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (a, b, d) => a < b ? Math.min(a + d, b) : Math.max(a - d, b);
  const rand = (min, max) => min + Math.random() * (max - min);

  const WEAPONS = {
    dagger: { name: '短剣', mark: '刃', note: '手数・短距離', color: '#e9d5a8' },
    axe: { name: '斧', mark: '断', note: '大振り・中距離', color: '#dc7558' },
    bow: { name: '弓', mark: '穿', note: 'チャージ・遠距離', color: '#d2a95f' },
  };

  const ATTACK_DATA = {
    dagger: {
      light: {
        duration: { idle: .58, move: .62, dodge: .6, air: .66 },
        name: { idle: '双牙', move: '走り裂き', dodge: '伏せ返し', air: '落ち牙' },
      },
      strong: {
        duration: { idle: .94, move: .82, dodge: .78, air: .98 },
        name: { idle: '十文字崩し', move: '影抜け', dodge: '返し牙', air: '螺旋落とし' },
      },
    },
    axe: {
      light: {
        duration: { idle: .8, move: .84, dodge: .78, air: .86 },
        name: { idle: '横薙ぎ', move: '踏み薙ぎ', dodge: '返し割り', air: '落とし斬り' },
      },
      strong: {
        duration: { idle: 1.22, move: 1.08, dodge: 1, air: 1.18 },
        name: { idle: '地割り', move: '猪突輪断', dodge: '逆鱗返し', air: '隕鉄落とし' },
      },
    },
    bow: {
      light: {
        duration: { idle: .52, move: .54, dodge: .5, air: .56 },
        charge: .82,
        name: { idle: '狙い射ち', move: '走り射ち', dodge: '伏せ射ち', air: '空射ち' },
      },
      strong: {
        duration: { idle: .72, move: .7, dodge: .66, air: .76 },
        charge: 1.38,
        name: { idle: '貫星', move: '滑走射', dodge: '翻身射', air: '天雨' },
      },
    },
  };

  const GEAR = {
    arrow: [590, 745, 600, 130],
  };

  const SPRITES = {
    locomotion: { cols: 5, rows: 2, frames: 10 },
    aerial: { cols: 4, rows: 2, frames: 8 },
    dagger: { cols: 5, rows: 2, frames: 10 },
    axe: { cols: 5, rows: 2, frames: 10 },
    bow: { cols: 5, rows: 2, frames: 10 },
    daggerLight: { cols: 5, rows: 4, frames: 20 },
    daggerStrong: { cols: 5, rows: 4, frames: 20 },
    axeLight: { cols: 5, rows: 4, frames: 20 },
    axeStrong: { cols: 5, rows: 4, frames: 20 },
    bowLight: { cols: 5, rows: 4, frames: 20 },
    bowStrong: { cols: 5, rows: 4, frames: 20 },
  };

  const images = {
    weapons: new Image(),
    locomotion: new Image(),
    aerial: new Image(),
    dagger: new Image(),
    axe: new Image(),
    bow: new Image(),
    daggerLight: new Image(),
    daggerStrong: new Image(),
    axeLight: new Image(),
    axeStrong: new Image(),
    bowLight: new Image(),
    bowStrong: new Image(),
  };

  function loadImage(image, src) {
    return new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  class SoundRack {
    constructor() { this.ac = null; this.master = null; }
    init() {
      if (this.ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = .13;
      this.master.connect(this.ac.destination);
    }
    tone(freq, duration, type = 'sine', gain = .3, slide = 0) {
      if (!this.ac) return;
      const t = this.ac.currentTime;
      const osc = this.ac.createOscillator();
      const amp = this.ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(35, freq + slide), t + duration);
      amp.gain.setValueAtTime(gain, t);
      amp.gain.exponentialRampToValueAtTime(.001, t + duration);
      osc.connect(amp).connect(this.master);
      osc.start(t); osc.stop(t + duration);
    }
    swing(kind) {
      if (kind === 'dagger') this.tone(290, .07, 'sawtooth', .22, -130);
      if (kind === 'axe') this.tone(125, .18, 'sawtooth', .3, -65);
      if (kind === 'bow') this.tone(440, .12, 'triangle', .2, 180);
    }
    hit(heavy = false) {
      this.tone(heavy ? 75 : 120, heavy ? .18 : .1, 'square', heavy ? .32 : .2, -35);
      this.tone(heavy ? 180 : 260, .05, 'triangle', .12, -80);
    }
    switch() { this.tone(310, .09, 'triangle', .14, 140); }
    jump() { this.tone(160, .11, 'triangle', .12, 100); }
  }
  const sfx = new SoundRack();

  const input = {
    left: false, right: false,
    lightAttack: false, strongAttack: false,
    jumpQueued: false, dashQueued: false,
  };
  let started = false;
  let paused = false;
  let orientationBlocked = false;
  let lastTime = performance.now();
  let cameraX = 0;
  let shake = 0;
  let hitStop = 0;
  let kills = 0;
  let noticeTimer = 0;
  let selectedLoadout = ['dagger', 'axe'];
  let draftLoadout = [...selectedLoadout];
  let activeSlot = 0;

  const player = {
    x: 430, y: FLOOR, vx: 0, vy: 0, facing: 1,
    grounded: true, hp: 100, maxHp: 100,
    attack: null, switchState: null,
    dashTimer: 0, dashCooldown: 0, dodgeGrace: 0, invulnerable: 0,
    hurtTimer: 0, landing: 0, walkPhase: 0,
    combo: 0, comboWindow: 0, tailRot: 0, tailVel: 0, animTime: 0,
  };

  let enemies = [];
  let particles = [];
  let projectiles = [];

  function spawnEnemy(x, type, hue) {
    const size = type === 'brute' ? 68 : type === 'flier' ? 42 : 52;
    const maxHp = type === 'brute' ? 90 : type === 'flier' ? 34 : 52;
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
      x, y: type === 'flier' ? FLOOR - 150 : FLOOR - size / 2,
      homeX: x, size, type, hue, hp: maxHp, maxHp,
      vx: 0, alive: true, respawn: 0, hitFlash: 0, contactCd: 0,
      phase: Math.random() * Math.PI * 2,
    };
  }

  function resetEnemies() {
    enemies = [
      spawnEnemy(980, 'crawler', 16), spawnEnemy(1240, 'flier', 47),
      spawnEnemy(1480, 'brute', 4), spawnEnemy(1820, 'crawler', 28),
      spawnEnemy(2200, 'flier', 54), spawnEnemy(2500, 'brute', 350),
    ];
  }
  resetEnemies();

  function showNotice(text, duration = 1.2) {
    ui.notice.textContent = text;
    ui.notice.classList.add('show');
    noticeTimer = duration;
  }

  function updateHud() {
    const ratio = clamp(player.hp / player.maxHp, 0, 1);
    ui.hpText.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    ui.hpBar.style.transform = `scaleX(${ratio})`;
    const dashRatio = player.dashCooldown <= 0 ? 1 : 1 - player.dashCooldown / .85;
    ui.dashBar.style.transform = `scaleX(${clamp(dashRatio, 0, 1)})`;
    ui.dashText.textContent = player.dashCooldown <= 0 ? 'READY' : player.dashCooldown.toFixed(1);
    ui.kills.textContent = String(kills);
    ui.slots.forEach((el, i) => {
      el.classList.toggle('active', i === activeSlot);
      el.querySelector('strong').textContent = WEAPONS[selectedLoadout[i]].name;
    });
  }

  function buildLoadoutControls() {
    document.querySelectorAll('[data-loadout-slot]').forEach(fieldset => {
      const slot = Number(fieldset.dataset.loadoutSlot);
      fieldset.querySelectorAll('.loadout-choice').forEach(n => n.remove());
      Object.entries(WEAPONS).forEach(([id, w]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `loadout-choice${draftLoadout[slot] === id ? ' selected' : ''}`;
        button.innerHTML = `<i>${w.mark}</i><span><strong>${w.name}</strong><small>${w.note}</small></span>`;
        button.addEventListener('click', () => {
          draftLoadout[slot] = id;
          buildLoadoutControls();
        });
        fieldset.append(button);
      });
    });
  }

  function switchWeapon(slot = 1 - activeSlot) {
    if (!started || player.hurtTimer > .08 || player.dashTimer > 0 || player.switchState) return;
    slot = clamp(slot, 0, 1);
    if (slot === activeSlot) return;
    player.attack = null;
    input.lightAttack = false;
    input.strongAttack = false;
    player.switchState = { t: 0, duration: .24, next: slot, changed: false };
    sfx.switch();
  }

  function currentWeapon() { return selectedLoadout[activeSlot]; }

  function horizontalAxis() {
    return (input.right ? 1 : 0) - (input.left ? 1 : 0);
  }

  function currentAttackContext() {
    if (player.dashTimer > 0 || player.dodgeGrace > 0) return 'dodge';
    if (!player.grounded) return 'air';
    return horizontalAxis() || Math.abs(player.vx) > 70 ? 'move' : 'idle';
  }

  function startAttack(tier = 'light') {
    if (!started || paused || player.hurtTimer > 0 || player.switchState || player.attack) return false;
    const weapon = currentWeapon();
    const context = currentAttackContext();
    const data = ATTACK_DATA[weapon][tier];

    // A dodge attack consumes the remaining dash but inherits a short counter
    // window. Neutral light attacks never invent a lunge or a jump.
    if (context === 'dodge') {
      player.dashTimer = 0;
      player.dodgeGrace = 0;
      player.vx = clamp(player.vx, -430, 430);
      player.invulnerable = Math.max(player.invulnerable, tier === 'strong' ? .24 : .12);
    }

    if (weapon === 'bow') {
      player.attack = {
        kind: 'bowCharge', weapon, tier, context,
        t: 0, duration: 99, charge: 0, fired: false, hit: new Set(),
      };
    } else {
      if (weapon === 'dagger' && tier === 'light') {
        player.combo = player.comboWindow > 0 ? (player.combo + 1) % 3 : 0;
        player.comboWindow = .72;
      } else {
        player.combo = 0;
      }
      player.attack = {
        kind: weapon, weapon, tier, context,
        t: 0, duration: data.duration[context], combo: player.combo,
        fired: false, hit: new Set(),
      };
    }
    if (tier === 'strong') showNotice(data.name[context], .62);
    return true;
  }

  function releaseAttack(tier = 'light') {
    if (tier === 'light') input.lightAttack = false;
    else input.strongAttack = false;
    if (!player.attack || player.attack.kind !== 'bowCharge' || player.attack.tier !== tier) return;
    const charge = clamp(player.attack.charge, .08, 1);
    const { context } = player.attack;
    player.attack = {
      kind: 'bowRelease', weapon: 'bow', tier, context,
      t: 0, duration: ATTACK_DATA.bow[tier].duration[context], charge,
      fired: false, hit: new Set(),
    };
  }

  function fireArrow(attack) {
    const strong = attack.tier === 'strong';
    const charge = attack.charge;
    const speed = strong ? lerp(920, 1280, charge) : lerp(700, 1050, charge);
    const angles = strong && attack.context === 'air' ? [.08, .22, .36] : [attack.context === 'air' ? .16 : 0];
    const pierce = strong && attack.context === 'idle' ? 2 : strong ? 1 : 0;
    angles.forEach((angle, index) => {
      const signedAngle = player.facing > 0 ? angle : Math.PI - angle;
      projectiles.push({
        x: player.x + player.facing * 68,
        y: player.y - (attack.context === 'air' ? 122 : 132) + index * 3,
        vx: Math.cos(signedAngle) * speed,
        vy: Math.sin(signedAngle) * speed,
        life: strong ? 2.1 : 1.8,
        damage: Math.round((strong ? 38 : 12) + (strong ? 35 : 26) * charge),
        pierce, hit: new Set(), dir: player.facing, rotation: signedAngle,
      });
    });
    player.vx -= player.facing * (strong ? 36 : 12) * charge;
    sfx.swing('bow');
    addBurst(player.x + player.facing * 68, player.y - 132, strong ? '#fff0a2' : '#e7be6b', strong ? 11 : 5, strong ? 145 : 85);
  }

  function beginDash() {
    if (!started || player.dashCooldown > 0 || player.hurtTimer > 0) return;
    player.attack = null;
    player.switchState = null;
    player.dashTimer = .18;
    player.dashCooldown = .85;
    player.dodgeGrace = .36;
    player.invulnerable = .26;
    player.vx = player.facing * 720;
    addBurst(player.x, player.y - 24, '#d5a75f', 9, 180);
    sfx.tone(105, .11, 'sawtooth', .16, -50);
  }

  function addBurst(x, y, color, count = 8, power = 160) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(power * .35, power);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(.18, .5), max: .5, color, size: rand(2, 7) });
    }
  }

  function strikeEnemy(enemy, damage, knockback, heavy = false) {
    if (!enemy.alive) return;
    enemy.hp -= damage;
    enemy.vx += player.facing * knockback;
    enemy.hitFlash = .12;
    hitStop = heavy ? .055 : .028;
    shake = Math.max(shake, heavy ? 11 : 5);
    sfx.hit(heavy);
    addBurst(enemy.x, enemy.y, heavy ? '#ff8b5e' : '#f4d38b', heavy ? 15 : 8, heavy ? 260 : 170);
    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.respawn = rand(1.8, 2.8);
      kills++;
      addBurst(enemy.x, enemy.y, `hsl(${enemy.hue} 82% 62%)`, 24, 300);
      showNotice(heavy ? '豪快に撃破！' : '撃破！', .7);
    }
  }

  function meleeHit(kind, attack, phase = 0) {
    const strong = attack.tier === 'strong';
    const range = kind === 'axe' ? (strong ? 194 : 154) : (strong ? 132 : 102 + attack.combo * 4);
    const damage = kind === 'axe'
      ? (strong ? 68 : 34)
      : (strong ? (phase === 1 ? 24 : 18) : 8 + attack.combo * 2);
    const y = player.y - (attack.context === 'air' ? 88 : 104);
    enemies.forEach(enemy => {
      const hitId = `${phase}:${enemy.id}`;
      if (!enemy.alive || attack.hit.has(hitId)) return;
      const dx = (enemy.x - player.x) * player.facing;
      const dy = Math.abs(enemy.y - y);
      if (dx > (strong ? -44 : -26) && dx < range && dy < enemy.size / 2 + (kind === 'axe' ? 82 : 62)) {
        attack.hit.add(hitId);
        strikeEnemy(enemy, damage, kind === 'axe' ? (strong ? 590 : 430) : (strong ? 330 : 210), strong || kind === 'axe');
      }
    });
  }

  function hurtPlayer(sourceX, amount) {
    if (player.invulnerable > 0 || player.hurtTimer > 0) return;
    player.hp -= amount;
    player.hurtTimer = .34;
    player.invulnerable = .75;
    player.vx = sourceX < player.x ? 300 : -300;
    player.vy = -250;
    shake = 10;
    sfx.hit(true);
    addBurst(player.x, player.y - 102, '#d95a49', 12, 220);
    showNotice(`被弾 −${amount}`, .42);
    if (player.hp <= 0) {
      player.hp = 0;
      showNotice('コタロー、撤退！', 1.1);
      window.setTimeout(resetPlayer, 900);
    }
  }

  function resetPlayer() {
    player.x = 430; player.y = FLOOR; player.vx = 0; player.vy = 0;
    player.hp = player.maxHp; player.hurtTimer = 0; player.invulnerable = 1;
    player.attack = null; player.switchState = null; player.grounded = true;
    player.dashTimer = 0; player.dashCooldown = 0; player.dodgeGrace = 0; player.landing = 0;
    player.combo = 0; player.comboWindow = 0;
    input.left = input.right = input.lightAttack = input.strongAttack = false;
    input.jumpQueued = input.dashQueued = false;
    hitStop = 0; shake = 0; projectiles = []; particles = [];
    resetEnemies();
  }

  function attackProgress(attack) {
    return clamp(attack.t / attack.duration, 0, 1);
  }

  function updateAttackAction(dt) {
    const attack = player.attack;
    if (!attack) return;
    attack.t += dt;

    if (attack.kind === 'bowCharge') {
      const chargeTime = ATTACK_DATA.bow[attack.tier].charge * BOW_CHARGE_FACTOR[attack.context];
      attack.charge = clamp(attack.t / chargeTime, 0, 1);
      if (attack.t > chargeTime && Math.floor(attack.t * 8) % 2 === 0) {
        particles.push({
          x: player.x + rand(-15, 15), y: player.y - 145 + rand(-18, 18),
          vx: rand(-15, 15), vy: rand(-40, -15), life: .2, max: .2,
          color: attack.tier === 'strong' ? '#fff1a6' : '#e9c26f', size: rand(1, 3),
        });
      }
      return;
    }

    const p = attackProgress(attack);
    if (attack.kind === 'dagger') {
      if (!attack.fired && p >= (attack.tier === 'strong' ? .28 : .16)) {
        attack.fired = true; sfx.swing('dagger');
      }
      if (!attack.secondSound && p >= (attack.tier === 'strong' ? .57 : .58)) {
        attack.secondSound = true; sfx.swing('dagger');
      }
      if (attack.tier === 'strong') {
        if (p >= .3 && p <= .5) meleeHit('dagger', attack, 0);
        if (p >= .56 && p <= .78) meleeHit('dagger', attack, 1);
      } else {
        if (p >= .18 && p <= .4) meleeHit('dagger', attack, 0);
        if (p >= .58 && p <= .82) meleeHit('dagger', attack, 1);
      }
    } else if (attack.kind === 'axe') {
      const hitStart = attack.tier === 'strong' ? .52 : .38;
      const hitEnd = attack.tier === 'strong' ? .76 : .63;
      if (!attack.fired && p >= hitStart - .04) { attack.fired = true; sfx.swing('axe'); }
      if (p >= hitStart && p <= hitEnd) meleeHit('axe', attack, 0);
    } else if (attack.kind === 'bowRelease') {
      const releasePoint = attack.tier === 'strong' ? .42 : .34;
      if (!attack.fired && p >= releasePoint) { attack.fired = true; fireArrow(attack); }
    }

    // Air strong attacks may dive, but none can manufacture upward velocity.
    if (attack.tier === 'strong' && attack.context === 'air' && !player.grounded && p >= .42) {
      if (attack.weapon === 'dagger') player.vy = Math.max(player.vy, 460);
      if (attack.weapon === 'axe') player.vy = Math.max(player.vy, 620);
    }

    if (attack.t >= attack.duration) player.attack = null;
  }

  function strongActionSpeed(attack) {
    const p = attack.kind === 'bowCharge' ? clamp(attack.charge, 0, 1) : attackProgress(attack);
    if (attack.context === 'idle') return 0;
    if (attack.context === 'air') {
      if (attack.weapon === 'dagger') return p < .45 ? 170 : 80;
      if (attack.weapon === 'axe') return p < .48 ? 145 : 55;
      return null;
    }
    if (attack.context === 'dodge') {
      if (attack.weapon === 'dagger') return p < .22 ? -90 : p < .62 ? 390 : 70;
      if (attack.weapon === 'axe') return p < .28 ? -115 : p < .68 ? 335 : 45;
      return p < .25 ? -150 : p < .58 ? 125 : 0;
    }
    if (attack.kind === 'bowCharge') return null;
    if (attack.weapon === 'dagger') return p < .18 ? 210 : p < .6 ? 525 : p < .84 ? 270 : 35;
    if (attack.weapon === 'axe') return p < .2 ? 260 : p < .68 ? 455 : p < .88 ? 190 : 30;
    return p < .25 ? 240 : p < .6 ? 390 : p < .84 ? 145 : 20;
  }

  function updateHorizontalMotion(dt, axis) {
    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      player.vx = player.facing * 720;
      return;
    }
    if (player.hurtTimer > .08) return;

    const action = player.attack;
    if (!action) {
      player.vx = approach(player.vx, axis * 305, (player.grounded ? 2100 : 1250) * dt);
      if (!axis && player.grounded) player.vx = approach(player.vx, 0, 1700 * dt);
      return;
    }

    if (action.tier === 'strong') {
      const scripted = strongActionSpeed(action);
      if (scripted !== null) {
        player.vx = approach(player.vx, player.facing * scripted, 3000 * dt);
        return;
      }
    }

    if (action.context === 'idle') {
      player.vx = approach(player.vx, 0, 2600 * dt);
    } else if (action.context === 'move') {
      const maxSpeed = action.kind === 'bowCharge' ? (action.tier === 'strong' ? 110 : 160) : 305;
      if (axis) player.vx = approach(player.vx, axis * maxSpeed, 1900 * dt);
      else player.vx = approach(player.vx, 0, 520 * dt);
    } else if (action.context === 'dodge') {
      player.vx = approach(player.vx, 0, 880 * dt);
    } else if (axis) {
      player.vx = approach(player.vx, axis * 270, 1050 * dt);
    }
  }

  function updatePlayer(dt) {
    player.animTime += dt;
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.dodgeGrace = Math.max(0, player.dodgeGrace - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.comboWindow = Math.max(0, player.comboWindow - dt);
    player.landing = Math.max(0, player.landing - dt * 3.4);

    if (input.jumpQueued) {
      if (player.grounded && player.hurtTimer <= 0 && !player.attack) {
        player.vy = -660;
        player.grounded = false;
        sfx.jump();
        addBurst(player.x, player.y - 3, '#a69a88', 7, 120);
      }
      input.jumpQueued = false;
    }
    if (input.dashQueued) { beginDash(); input.dashQueued = false; }

    if (player.switchState) {
      player.switchState.t += dt;
      if (!player.switchState.changed && player.switchState.t >= player.switchState.duration * .5) {
        activeSlot = player.switchState.next;
        player.switchState.changed = true;
        updateHud();
        showNotice(`${WEAPONS[currentWeapon()].name}に持ち替え`, .65);
      }
      if (player.switchState.t >= player.switchState.duration) player.switchState = null;
    }

    updateAttackAction(dt);

    const axis = horizontalAxis();
    if (axis && player.hurtTimer <= 0 && player.dashTimer <= 0 && !player.attack) player.facing = axis;
    updateHorizontalMotion(dt, axis);

    player.vy += 1760 * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, 80, WORLD_W - 80);
    if (player.y >= FLOOR) {
      if (!player.grounded && player.vy > 190) {
        player.landing = clamp(player.vy / 800, .25, 1);
        addBurst(player.x, FLOOR - 2, '#8d8378', 8, 115);
      }
      player.y = FLOOR; player.vy = 0; player.grounded = true;
    } else player.grounded = false;

    player.walkPhase += Math.abs(player.vx) * dt * .027;
    const tailTarget = clamp(-player.vx / 900, -.26, .26) + Math.sin(player.walkPhase * .55) * .045;
    player.tailVel += (tailTarget - player.tailRot) * 38 * dt;
    player.tailVel *= Math.pow(.05, dt);
    player.tailRot += player.tailVel * dt;
  }

  function updateEnemies(dt) {
    for (const enemy of enemies) {
      if (!enemy.alive) {
        enemy.respawn -= dt;
        if (enemy.respawn <= 0) {
          enemy.alive = true; enemy.hp = enemy.maxHp; enemy.x = enemy.homeX;
          enemy.vx = 0; enemy.hitFlash = 0;
        }
        continue;
      }
      enemy.phase += dt * (enemy.type === 'flier' ? 3.5 : 1.8);
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.contactCd = Math.max(0, enemy.contactCd - dt);
      const dx = player.x - enemy.x;
      const aggro = Math.abs(dx) < 440;
      if (aggro) enemy.vx = approach(enemy.vx, Math.sign(dx) * (enemy.type === 'brute' ? 43 : 68), 150 * dt);
      else enemy.vx = approach(enemy.vx, Math.sin(enemy.phase * .4) * 28, 80 * dt);
      enemy.vx *= Math.pow(.55, dt);
      enemy.x += enemy.vx * dt;
      enemy.x = clamp(enemy.x, enemy.homeX - 220, enemy.homeX + 220);
      if (enemy.type === 'flier') enemy.y = FLOOR - 150 + Math.sin(enemy.phase) * 34;
      else enemy.y = FLOOR - enemy.size / 2 + Math.abs(Math.sin(enemy.phase)) * -2;
      if (Math.abs(enemy.x - player.x) < enemy.size * .55 + 34 && Math.abs(enemy.y - (player.y - PLAYER_BODY_HEIGHT * .48)) < enemy.size * .65 + 58 && enemy.contactCd <= 0) {
        enemy.contactCd = .8;
        hurtPlayer(enemy.x, enemy.type === 'brute' ? 18 : 10);
      }
    }
  }

  function updateProjectiles(dt) {
    for (const p of projectiles) {
      p.life -= dt; p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.rotation = Math.atan2(p.vy, p.vx);
      for (const enemy of enemies) {
        if (!enemy.alive || p.life <= 0 || p.hit?.has(enemy.id)) continue;
        if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.size * .6 + 12) {
          strikeEnemy(enemy, p.damage, 260, p.damage > 32);
          p.hit?.add(enemy.id);
          if (p.pierce > 0) p.pierce--;
          else p.life = 0;
        }
      }
      if (p.y > FLOOR) p.life = 0;
    }
    projectiles = projectiles.filter(p => p.life > 0);
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life -= dt; p.vy += 280 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(.12, dt);
    }
    particles = particles.filter(p => p.life > 0);
  }

  function update(dt) {
    if (!started || paused) return;
    if (hitStop > 0) { hitStop -= dt; return; }
    updatePlayer(dt);
    updateEnemies(dt);
    updateProjectiles(dt);
    updateParticles(dt);
    shake = Math.max(0, shake - dt * 32);
    const lookAhead = clamp(player.facing * 80 + player.vx * .22, -150, 150);
    const cameraTarget = clamp(player.x + lookAhead - W * .42, 0, Math.max(0, WORLD_W - W));
    cameraX = lerp(cameraX, cameraTarget, 1 - Math.pow(.00025, dt));
    if (noticeTimer > 0) {
      noticeTimer -= dt;
      if (noticeTimer <= 0) ui.notice.classList.remove('show');
    }
    updateHud();
  }

  function drawBackdrop() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#17131d'); sky.addColorStop(.62, '#29202a'); sky.addColorStop(1, '#3b2a2a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);

    ctx.save();
    const parallax = cameraX * .12;
    ctx.translate(-(parallax % 340), 0);
    for (let i = -1; i < 6; i++) {
      const x = i * 340;
      ctx.fillStyle = i % 2 ? '#211b25' : '#251d27';
      ctx.beginPath(); ctx.moveTo(x, FLOOR); ctx.lineTo(x + 100, 290); ctx.lineTo(x + 220, 400); ctx.lineTo(x + 340, 245); ctx.lineTo(x + 430, FLOOR); ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(-cameraX * .36, 0);
    ctx.globalAlpha = .32;
    for (let x = 120; x < WORLD_W; x += 280) {
      const h = 100 + (x % 470) * .18;
      ctx.fillStyle = '#59403c'; ctx.fillRect(x, FLOOR - h, 18, h);
      ctx.fillStyle = '#7b5545'; ctx.fillRect(x - 14, FLOOR - h, 46, 12);
    }
    ctx.restore();

    ctx.fillStyle = '#171419'; ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.strokeStyle = 'rgba(228,180,98,.10)'; ctx.lineWidth = 1;
    const gridOffset = -(cameraX % 80);
    for (let x = gridOffset; x < W + 80; x += 80) { ctx.beginPath(); ctx.moveTo(x, FLOOR); ctx.lineTo(x - 38, H); ctx.stroke(); }
    for (let y = FLOOR + 30; y < H; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = '#b87952'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();
  }

  function drawPart(image, rect, x, y, w, h, rotation = 0, ax = .5, ay = .5, alpha = 1, flipX = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rotation); if (flipX) ctx.scale(-1, 1); ctx.globalAlpha *= alpha;
    ctx.drawImage(image, rect[0], rect[1], rect[2], rect[3], -w * ax, -h * ay, w, h);
    ctx.restore();
  }

  function attackVisualProgress(attack) {
    if (attack.kind === 'bowCharge') return attack.charge * .5;
    if (attack.kind === 'bowRelease') return .5 + attackProgress(attack) * .5;
    return attackProgress(attack);
  }

  function attackSpritePose(attack) {
    const row = ATTACK_CONTEXT_ROW[attack.context];
    const frameStart = row * ATTACK_KEYS;
    const frameEnd = frameStart + ATTACK_KEYS - 1;
    const visualProgress = clamp(attackVisualProgress(attack), 0, 1);
    const logicalFrame = Math.min(ATTACK_FRAMES - 1, Math.floor(visualProgress * ATTACK_FRAMES));
    const steppedProgress = logicalFrame / (ATTACK_FRAMES - 1);
    const suffix = attack.tier === 'strong' ? 'Strong' : 'Light';
    const activeProgress = attack.kind === 'bowCharge' ? attack.charge : attackProgress(attack);
    const trail = attack.tier === 'strong'
      && (attack.context === 'move' || attack.context === 'dodge' || attack.context === 'air')
      && activeProgress > .22 && activeProgress < .78 ? 2 : 0;
    return {
      sheet: `${attack.weapon}${suffix}`,
      frame: frameStart + steppedProgress * (ATTACK_KEYS - 1),
      frameStart, frameEnd, logicalFrame, loop: false, trail,
    };
  }

  function selectSpritePose() {
    if (player.hurtTimer > 0) return { sheet: 'aerial', frame: 7, loop: false };
    if (player.dashTimer > 0) return { sheet: 'aerial', frame: 6, loop: false, trail: 3 };

    const attack = player.attack;
    if (attack) return attackSpritePose(attack);
    if (player.landing > .05) return { sheet: 'aerial', frame: 5, loop: false };
    if (!player.grounded) {
      const flightFrame = clamp(1 + (player.vy + 650) / 330, 1, 4);
      return { sheet: 'aerial', frame: flightFrame, loop: false };
    }

    const speed = Math.abs(player.vx);
    if (speed > 22) {
      return { sheet: 'locomotion', frame: 2 + ((player.walkPhase * 1.22) % 8), loop: true, loopStart: 2, loopCount: 8 };
    }
    if (player.switchState) {
      const weapon = currentWeapon();
      return weapon === 'dagger'
        ? { sheet: 'locomotion', frame: 1, loop: false }
        : { sheet: weapon, frame: 9, loop: false };
    }
    if (currentWeapon() === 'axe') return { sheet: 'axe', frame: 9, loop: false };
    if (currentWeapon() === 'bow') return { sheet: 'bow', frame: 9, loop: false };
    return { sheet: 'locomotion', frame: (player.animTime * 1.35) % 2, loop: true, loopStart: 0, loopCount: 2 };
  }

  function spriteFrameIndex(pose, value) {
    const sprite = SPRITES[pose.sheet];
    if (pose.loop) {
      const start = pose.loopStart ?? 0;
      const count = pose.loopCount ?? sprite.frames;
      return start + ((value - start) % count + count) % count;
    }
    return clamp(value, pose.frameStart ?? 0, pose.frameEnd ?? sprite.frames - 1);
  }

  function drawSpriteCell(pose, frameValue, screenX, screenY, alpha = 1) {
    const sprite = SPRITES[pose.sheet];
    const image = images[pose.sheet];
    const frame = Math.floor(spriteFrameIndex(pose, frameValue));
    const sourceX = (frame % sprite.cols) * SPRITE_CELL;
    const sourceY = Math.floor(frame / sprite.cols) * SPRITE_CELL;
    const scale = PLAYER_DRAW_SIZE / SPRITE_CELL;
    const idleFloat = pose.sheet === 'locomotion' && frame < 2 ? Math.sin(player.animTime * 2.4) * 1.2 : 0;

    ctx.save();
    ctx.translate(screenX, screenY + idleFloat);
    ctx.scale(player.facing, 1);
    ctx.globalAlpha *= alpha;
    ctx.drawImage(
      image,
      sourceX, sourceY, SPRITE_CELL, SPRITE_CELL,
      -PLAYER_DRAW_SIZE / 2, -SPRITE_BASELINE * scale,
      PLAYER_DRAW_SIZE, PLAYER_DRAW_SIZE,
    );
    ctx.restore();
  }

  function drawFullBodySprite(screenX, screenY) {
    const pose = selectSpritePose();
    const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 18) % 2 === 0;
    const baseAlpha = blink ? .48 : 1;
    const baseFrame = Math.floor(spriteFrameIndex(pose, pose.frame));

    if (pose.trail) {
      for (let i = pose.trail; i >= 1; i--) {
        drawSpriteCell(pose, baseFrame, screenX - player.facing * i * 24, screenY, .045 * i * baseAlpha);
      }
    }

    const frameValue = spriteFrameIndex(pose, pose.frame);
    const nextFrame = Math.min(baseFrame + 1, pose.frameEnd ?? SPRITES[pose.sheet].frames - 1);
    const fraction = frameValue - baseFrame;
    const blend = fraction * fraction * (3 - 2 * fraction);
    if (nextFrame > baseFrame && blend > 0) {
      drawSpriteCell(pose, baseFrame, screenX, screenY, (1 - blend) * baseAlpha);
      drawSpriteCell(pose, nextFrame, screenX, screenY, blend * baseAlpha);
    } else {
      drawSpriteCell(pose, baseFrame, screenX, screenY, baseAlpha);
    }
  }

  function drawEnemy(enemy) {
    if (!enemy.alive) return;
    const x = enemy.x - cameraX;
    const y = enemy.y;
    const pulse = 1 + Math.sin(enemy.phase * 2) * .035;
    ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
    ctx.fillStyle = enemy.hitFlash > 0 ? '#fff5d8' : `hsl(${enemy.hue} 58% 44%)`;
    ctx.strokeStyle = `hsl(${enemy.hue} 78% 72%)`; ctx.lineWidth = 3;
    if (enemy.type === 'flier') {
      ctx.rotate(enemy.phase * .22); ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; const r = i % 2 ? enemy.size * .45 : enemy.size * .7; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (enemy.type === 'brute') {
      ctx.rotate(Math.sin(enemy.phase) * .05); ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; ctx.lineTo(Math.cos(a) * enemy.size * .62, Math.sin(a) * enemy.size * .62); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-enemy.size * .33, -5, enemy.size * .66, 10);
    } else {
      ctx.rotate(Math.sin(enemy.phase) * .08); ctx.fillRect(-enemy.size / 2, -enemy.size / 2, enemy.size, enemy.size); ctx.strokeRect(-enemy.size / 2, -enemy.size / 2, enemy.size, enemy.size);
    }
    ctx.restore();
    const hp = clamp(enemy.hp / enemy.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x - enemy.size / 2, y - enemy.size * .78, enemy.size, 5);
    ctx.fillStyle = '#e17958'; ctx.fillRect(x - enemy.size / 2, y - enemy.size * .78, enemy.size * hp, 5);
  }

  function drawProjectiles() {
    projectiles.forEach(p => drawPart(images.weapons, GEAR.arrow, p.x - cameraX, p.y, 72, 15, p.rotation, .5, .5));
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - cameraX - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.save();
    const sx = shake > 0 ? rand(-shake, shake) : 0;
    const sy = shake > 0 ? rand(-shake * .55, shake * .55) : 0;
    ctx.translate(sx, sy);
    drawBackdrop();

    // Geometric stage markers.
    ctx.save(); ctx.translate(-cameraX, 0);
    for (let x = 680; x < WORLD_W; x += 520) {
      ctx.fillStyle = 'rgba(172,120,80,.13)'; ctx.fillRect(x, FLOOR - 110, 42, 110);
      ctx.strokeStyle = 'rgba(228,180,98,.18)'; ctx.strokeRect(x, FLOOR - 110, 42, 110);
    }
    ctx.restore();

    // Grounding shadow remains subtle; the generated character has no baked shadow.
    ctx.fillStyle = `rgba(0,0,0,${player.grounded ? .34 : .18})`;
    ctx.beginPath(); ctx.ellipse(player.x - cameraX, FLOOR + 4, 43 - Math.min(15, Math.abs(player.y - FLOOR) * .04), 8, 0, 0, Math.PI * 2); ctx.fill();
    enemies.forEach(drawEnemy);
    drawProjectiles();
    drawFullBodySprite(player.x - cameraX, player.y);
    drawParticles();

    // Bow charge meter is deliberately world-space, directly above Kotaro.
    if (player.attack?.kind === 'bowCharge') {
      const c = player.attack.charge;
      const x = player.x - cameraX - 50, y = player.y - PLAYER_BODY_HEIGHT - 28;
      ctx.fillStyle = 'rgba(12,10,15,.72)'; ctx.fillRect(x, y, 100, 9);
      ctx.fillStyle = c >= 1 ? '#fff0ac' : '#e1ad62'; ctx.fillRect(x + 2, y + 2, 96 * c, 5);
    }
    ctx.restore();

    if (player.hurtTimer > 0) {
      const hurtAlpha = clamp(player.hurtTimer / .34, 0, 1);
      const vignette = ctx.createRadialGradient(W / 2, H / 2, H * .18, W / 2, H / 2, Math.max(W, H) * .7);
      vignette.addColorStop(0, 'rgba(143,24,24,0)');
      vignette.addColorStop(1, `rgba(143,24,24,${.34 * hurtAlpha})`);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(255,92,72,${.52 * hurtAlpha})`;
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, W - 12, H - 12);
    }
  }

  function frame(now) {
    const dt = Math.min(.033, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function setKey(code, down, repeat) {
    if (code === 'KeyA' || code === 'ArrowLeft') input.left = down;
    if (code === 'KeyD' || code === 'ArrowRight') input.right = down;
    if (down && !repeat && (code === 'Space' || code === 'KeyW' || code === 'ArrowUp')) input.jumpQueued = true;
    if (down && !repeat && (code === 'ShiftLeft' || code === 'ShiftRight')) input.dashQueued = true;
    if ((code === 'KeyJ' || code === 'KeyZ' || code === 'Enter')) {
      if (down && !repeat) { input.lightAttack = true; startAttack('light'); }
      if (!down) releaseAttack('light');
    }
    if (code === 'KeyK' || code === 'KeyC') {
      if (down && !repeat) { input.strongAttack = true; startAttack('strong'); }
      if (!down) releaseAttack('strong');
    }
    if (down && !repeat && (code === 'KeyQ' || code === 'KeyX')) switchWeapon();
    if (down && !repeat && code === 'Digit1') switchWeapon(0);
    if (down && !repeat && code === 'Digit2') switchWeapon(1);
    if (down && !repeat && code === 'KeyR') resetPlayer();
  }

  window.addEventListener('keydown', e => {
    if (e.target.matches('button,input')) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','Space'].includes(e.code)) e.preventDefault();
    setKey(e.code, true, e.repeat);
  });
  window.addEventListener('keyup', e => setKey(e.code, false, false));
  window.addEventListener('blur', () => {
    input.left = input.right = input.lightAttack = input.strongAttack = false;
    if (player.attack?.kind === 'bowCharge') player.attack = null;
  });
  window.addEventListener('resize', () => {
    if (fitCanvasToViewport()) {
      cameraX = clamp(cameraX, 0, Math.max(0, WORLD_W - W));
      render();
    }
    syncOrientationState();
    lastTime = performance.now();
  });

  function isPortrait() {
    if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches;
    return Number.isFinite(window.innerWidth) && Number.isFinite(window.innerHeight) && window.innerHeight > window.innerWidth;
  }

  function syncOrientationState() {
    orientationBlocked = isPortrait();
    if (orientationBlocked) {
      input.left = input.right = input.lightAttack = input.strongAttack = false;
      input.jumpQueued = input.dashQueued = false;
      if (player.attack?.kind === 'bowCharge') player.attack = null;
    }
    if (started) syncPauseState();
  }

  async function requestLandscapeMode() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (coarsePointer && !document.fullscreenElement && document.documentElement?.requestFullscreen) {
      try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (_) {}
    }
    try { await window.screen?.orientation?.lock?.('landscape'); } catch (_) {}
    syncOrientationState();
  }

  window.addEventListener('orientationchange', syncOrientationState);

  function syncPauseState() {
    paused = document.hidden || ui.help.open || ui.loadout.open || orientationBlocked;
    lastTime = performance.now();
    if (!paused) return;
    input.left = false;
    input.right = false;
    input.lightAttack = false;
    input.strongAttack = false;
    input.jumpQueued = false;
    input.dashQueued = false;
    if (player.attack?.kind === 'bowCharge') player.attack = null;
  }

  document.addEventListener('visibilitychange', syncPauseState);

  function bindHold(id, onDown, onUp = () => {}) {
    const el = document.querySelector(id);
    const down = e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); el.classList.add('pressed'); onDown(); };
    const up = e => { e.preventDefault(); el.classList.remove('pressed'); onUp(); };
    el.addEventListener('pointerdown', down); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  bindHold('#leftButton', () => input.left = true, () => input.left = false);
  bindHold('#rightButton', () => input.right = true, () => input.right = false);
  bindHold('#jumpButton', () => input.jumpQueued = true);
  bindHold('#dashButton', () => input.dashQueued = true);
  bindHold('#attackButton', () => { input.lightAttack = true; startAttack('light'); }, () => releaseAttack('light'));
  bindHold('#strongAttackButton', () => { input.strongAttack = true; startAttack('strong'); }, () => releaseAttack('strong'));
  bindHold('#switchButtonTouch', () => switchWeapon());
  ui.landscapeButton.addEventListener('click', () => { void requestLandscapeMode(); });

  ui.helpButton.addEventListener('click', () => { ui.help.showModal(); syncPauseState(); });
  ui.loadoutButton.addEventListener('click', () => {
    draftLoadout = [...selectedLoadout]; buildLoadoutControls(); ui.loadout.showModal(); syncPauseState();
  });
  [ui.help, ui.loadout].forEach(dialog => dialog.addEventListener('close', syncPauseState));
  ui.applyLoadout.addEventListener('click', () => {
    selectedLoadout = [...draftLoadout]; activeSlot = 0; player.attack = null; player.switchState = null; updateHud();
    showNotice(`${WEAPONS[selectedLoadout[0]].name}＋${WEAPONS[selectedLoadout[1]].name}`, 1);
  });
  ui.switchWeapon.addEventListener('click', () => switchWeapon());
  ui.slots.forEach((el, i) => el.addEventListener('click', () => switchWeapon(i)));
  ui.start.addEventListener('click', () => {
    void requestLandscapeMode();
    sfx.init(); started = true; paused = false; ui.boot.classList.add('hidden'); showNotice('訓練開始', 1.1);
    syncOrientationState();
  });

  ui.start.disabled = true;
  Promise.all([
    loadImage(images.weapons, 'assets/kotaro-weapons-atlas.webp'),
    loadImage(images.locomotion, 'assets/kotaro-atlas-locomotion-v2.webp'),
    loadImage(images.aerial, 'assets/kotaro-atlas-aerial-v2.webp'),
    loadImage(images.dagger, 'assets/kotaro-atlas-dagger-v2.webp'),
    loadImage(images.axe, 'assets/kotaro-atlas-axe-v2.webp'),
    loadImage(images.bow, 'assets/kotaro-atlas-bow-v2.webp'),
    loadImage(images.daggerLight, 'assets/kotaro-atlas-dagger-light-v1.webp'),
    loadImage(images.daggerStrong, 'assets/kotaro-atlas-dagger-strong-v1.webp'),
    loadImage(images.axeLight, 'assets/kotaro-atlas-axe-light-v1.webp'),
    loadImage(images.axeStrong, 'assets/kotaro-atlas-axe-strong-v1.webp'),
    loadImage(images.bowLight, 'assets/kotaro-atlas-bow-light-v1.webp'),
    loadImage(images.bowStrong, 'assets/kotaro-atlas-bow-strong-v1.webp'),
  ]).then(() => {
    ui.start.disabled = false;
    ui.assetStatus.textContent = 'コタロー準備完了';
  }).catch(error => {
    console.error(error);
    ui.assetStatus.textContent = '素材の読み込みに失敗した。再読み込みしてくれ。';
  });

  buildLoadoutControls();
  syncOrientationState();
  updateHud();
  window.__KEMOSURA__ = {
    snapshot: () => ({
      started, paused, x: player.x, y: player.y, vx: player.vx, vy: player.vy, hp: player.hp,
      grounded: player.grounded, activeSlot, weapon: currentWeapon(),
      loadout: [...selectedLoadout], attack: player.attack?.kind ?? null,
      attackWeapon: player.attack?.weapon ?? null,
      attackTier: player.attack?.tier ?? null,
      attackContext: player.attack?.context ?? null,
      attackName: player.attack ? ATTACK_DATA[player.attack.weapon][player.attack.tier].name[player.attack.context] : null,
      attackTime: player.attack?.t ?? null,
      attackDuration: player.attack?.duration ?? null,
      attackCharge: player.attack?.charge ?? null,
      invulnerable: player.invulnerable,
      projectiles: projectiles.length, livingEnemies: enemies.filter(e => e.alive).length,
      kills, canvasWidth: W, canvasHeight: H,
      sprite: (() => {
        const pose = selectSpritePose();
        return {
          sheet: pose.sheet,
          frame: Math.floor(spriteFrameIndex(pose, pose.frame)),
          logicalFrame: pose.logicalFrame ?? null,
        };
      })(),
    }),
  };
  render();
  requestAnimationFrame(frame);
})();
