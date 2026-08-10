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

  const GEAR = {
    arrow: [590, 745, 600, 130],
  };

  const SPRITES = {
    locomotion: { cols: 5, rows: 2, frames: 10 },
    aerial: { cols: 4, rows: 2, frames: 8 },
    dagger: { cols: 5, rows: 2, frames: 10 },
    axe: { cols: 5, rows: 2, frames: 10 },
    bow: { cols: 5, rows: 2, frames: 10 },
  };

  const images = {
    weapons: new Image(),
    locomotion: new Image(),
    aerial: new Image(),
    dagger: new Image(),
    axe: new Image(),
    bow: new Image(),
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

  const input = { left: false, right: false, attack: false, jumpQueued: false, dashQueued: false };
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
    dashTimer: 0, dashCooldown: 0, invulnerable: 0,
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
      spawnEnemy(850, 'crawler', 16), spawnEnemy(1170, 'flier', 47),
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
    input.attack = false;
    player.switchState = { t: 0, duration: .24, next: slot, changed: false };
    sfx.switch();
  }

  function currentWeapon() { return selectedLoadout[activeSlot]; }

  function startAttack() {
    if (!started || paused || player.hurtTimer > 0 || player.dashTimer > 0 || player.switchState) return;
    const weapon = currentWeapon();
    if (player.attack) return;
    if (weapon === 'bow') {
      player.attack = { kind: 'bowCharge', t: 0, duration: 99, charge: 0, hit: new Set() };
    } else if (weapon === 'dagger') {
      player.combo = player.comboWindow > 0 ? (player.combo + 1) % 4 : 0;
      player.comboWindow = .9;
      player.attack = { kind: 'dagger', t: 0, duration: .82, combo: player.combo, fired: false, launched: false, hit: new Set() };
      if (player.grounded) player.vx += player.facing * 90;
    } else {
      player.attack = { kind: 'axe', t: 0, duration: 1.05, fired: false, launched: false, hit: new Set() };
      if (player.grounded) player.vx += player.facing * 35;
    }
  }

  function releaseAttack() {
    input.attack = false;
    if (!player.attack || player.attack.kind !== 'bowCharge') return;
    const charge = clamp(player.attack.charge, .08, 1);
    player.attack = {
      kind: 'bowRelease', t: 0, duration: .95, charge,
      fired: false, followupFired: false, launched: false, hit: new Set(),
    };
  }

  function fireArrow(charge) {
    const speed = lerp(680, 1050, charge);
    projectiles.push({
      x: player.x + player.facing * 72, y: player.y - 132,
      vx: player.facing * speed, vy: lerp(5, -25, charge),
      life: 1.8, damage: Math.round(12 + 30 * charge),
      dir: player.facing, rotation: 0,
    });
    player.vx -= player.facing * 28 * charge;
    sfx.swing('bow');
    addBurst(player.x + player.facing * 68, player.y - 132, '#e7be6b', 5, 85);
  }

  function beginDash() {
    if (!started || player.dashCooldown > 0 || player.hurtTimer > 0) return;
    player.attack = null;
    player.switchState = null;
    player.dashTimer = .18;
    player.dashCooldown = .85;
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
    const range = kind === 'axe' ? 158 : 98 + attack.combo * 5;
    const damage = kind === 'axe' ? 42 : 9 + attack.combo * 2;
    const y = player.y - 104;
    enemies.forEach(enemy => {
      const hitId = `${phase}:${enemy.id}`;
      if (!enemy.alive || attack.hit.has(hitId)) return;
      const dx = (enemy.x - player.x) * player.facing;
      const dy = Math.abs(enemy.y - y);
      if (dx > -26 && dx < range && dy < enemy.size / 2 + (kind === 'axe' ? 78 : 58)) {
        attack.hit.add(hitId);
        strikeEnemy(enemy, damage, kind === 'axe' ? 470 : 225, kind === 'axe');
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
    player.dashTimer = 0; player.dashCooldown = 0; player.landing = 0;
    player.combo = 0; player.comboWindow = 0;
  }

  function updatePlayer(dt) {
    player.animTime += dt;
    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    player.comboWindow = Math.max(0, player.comboWindow - dt);
    player.landing = Math.max(0, player.landing - dt * 3.4);

    if (input.jumpQueued) {
      if (player.grounded && player.hurtTimer <= 0) {
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

    if (player.attack) {
      player.attack.t += dt;
      if (player.attack.kind === 'bowCharge') {
        player.attack.charge = clamp(player.attack.t / 1.05, 0, 1);
        if (player.attack.t > 1.05 && Math.floor(player.attack.t * 8) % 2 === 0) {
          particles.push({ x: player.x + rand(-15, 15), y: player.y - 145 + rand(-18, 18), vx: rand(-15, 15), vy: rand(-40, -15), life: .2, max: .2, color: '#e9c26f', size: rand(1, 3) });
        }
      } else if (player.attack.kind === 'dagger') {
        const a = player.attack;
        const p = clamp(a.t / a.duration, 0, 1);
        if (!a.fired && p >= .1) { a.fired = true; sfx.swing('dagger'); }
        if (!a.secondSound && p >= .58) { a.secondSound = true; sfx.swing('dagger'); }
        if (p >= .1 && p <= .4) meleeHit('dagger', a, 0);
        if (p >= .6 && p <= .9) meleeHit('dagger', a, 1);
        if (!a.launched && p >= .64 && player.grounded) {
          a.launched = true;
          player.vy = -315;
          player.grounded = false;
        }
        if (a.t >= a.duration) player.attack = null;
      } else if (player.attack.kind === 'axe') {
        const a = player.attack;
        const p = clamp(a.t / a.duration, 0, 1);
        if (!a.launched && p >= .22 && player.grounded) {
          a.launched = true;
          player.vy = -455;
          player.vx = player.facing * 350;
          player.grounded = false;
        }
        if (!a.fired && p >= .55) { a.fired = true; sfx.swing('axe'); }
        if (p >= .62 && p <= .84) meleeHit('axe', a, 0);
        if (a.t >= a.duration) player.attack = null;
      } else if (player.attack.kind === 'bowRelease') {
        const a = player.attack;
        const p = clamp(a.t / a.duration, 0, 1);
        if (!a.fired && p >= .1) { a.fired = true; fireArrow(a.charge); }
        if (!a.launched && p >= .38 && player.grounded) {
          a.launched = true;
          player.vy = -390;
          player.vx = player.facing * 300;
          player.grounded = false;
        }
        if (!a.followupFired && a.charge >= .72 && p >= .58) {
          a.followupFired = true;
          fireArrow(a.charge * .72);
        }
        if (a.t >= a.duration) player.attack = null;
      }
    }

    const axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (axis && player.hurtTimer <= 0 && player.dashTimer <= 0) player.facing = axis;
    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      player.vx = player.facing * 720;
    } else if (player.hurtTimer <= .08) {
      const action = player.attack;
      let actionSpeed = null;
      if (action?.kind === 'dagger') {
        const p = clamp(action.t / action.duration, 0, 1);
        actionSpeed = p < .14 ? 70 : p < .46 ? 280 : p < .7 ? 440 : p < .92 ? 245 : 0;
      } else if (action?.kind === 'axe') {
        const p = clamp(action.t / action.duration, 0, 1);
        actionSpeed = p < .2 ? -35 : p < .72 ? 310 : p < .9 ? 90 : 0;
      } else if (action?.kind === 'bowRelease') {
        const p = clamp(action.t / action.duration, 0, 1);
        actionSpeed = p < .2 ? 70 : p < .58 ? 335 : p < .86 ? 235 : 0;
      }
      const charging = action?.kind === 'bowCharge';
      const maxSpeed = charging ? 90 : 305;
      const target = actionSpeed === null ? axis * maxSpeed : player.facing * actionSpeed;
      const accel = actionSpeed === null ? (player.grounded ? 2100 : 1250) : 3200;
      player.vx = approach(player.vx, target, accel * dt);
      if (!axis && actionSpeed === null && player.grounded) player.vx = approach(player.vx, 0, 1700 * dt);
    }

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
        if (!enemy.alive || p.life <= 0) continue;
        if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.size * .6 + 12) {
          strikeEnemy(enemy, p.damage, 260, p.damage > 32);
          p.life = 0;
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

  function sequenceFrame(start, count, progress) {
    return start + clamp(progress, 0, .9999) * count;
  }

  function selectSpritePose() {
    if (player.hurtTimer > 0) return { sheet: 'aerial', frame: 7, loop: false };
    if (player.dashTimer > 0) return { sheet: 'aerial', frame: 6, loop: false, trail: 3 };

    const attack = player.attack;
    if (attack?.kind === 'dagger') {
      const progress = attack.t / attack.duration;
      return { sheet: 'dagger', frame: sequenceFrame(0, 10, progress), loop: false, trail: progress > .3 && progress < .82 ? 2 : 0 };
    }
    if (attack?.kind === 'axe') {
      const progress = attack.t / attack.duration;
      return { sheet: 'axe', frame: sequenceFrame(0, 10, progress), loop: false, trail: progress > .38 && progress < .75 ? 2 : 0 };
    }
    if (attack?.kind === 'bowCharge') {
      return { sheet: 'bow', frame: clamp(attack.charge * 2.8, 0, 2.98), loop: false };
    }
    if (attack?.kind === 'bowRelease') {
      const progress = attack.t / attack.duration;
      return { sheet: 'bow', frame: sequenceFrame(3, 7, progress), loop: false, trail: progress > .34 && progress < .76 ? 2 : 0 };
    }
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
    return clamp(value, 0, sprite.frames - 1);
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

    drawSpriteCell(pose, baseFrame, screenX, screenY, baseAlpha);

    // A short overlap into the next cel keeps ten-frame sheets fluid at 60 Hz
    // without blurring the silhouette for most of each held pose.
    const fraction = spriteFrameIndex(pose, pose.frame) - baseFrame;
    const blend = clamp((fraction - .76) / .24, 0, 1) * .28;
    if (blend > 0) drawSpriteCell(pose, baseFrame + 1, screenX, screenY, blend * baseAlpha);
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
      if (down && !repeat) { input.attack = true; startAttack(); }
      if (!down) releaseAttack();
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
  window.addEventListener('blur', () => { input.left = input.right = input.attack = false; releaseAttack(); });
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
      input.left = input.right = input.attack = false;
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
    input.attack = false;
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
  bindHold('#attackButton', () => { input.attack = true; startAttack(); }, releaseAttack);
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
    loadImage(images.locomotion, 'assets/kotaro-atlas-locomotion-v1.webp'),
    loadImage(images.aerial, 'assets/kotaro-atlas-aerial-v1.webp'),
    loadImage(images.dagger, 'assets/kotaro-atlas-dagger-v1.webp'),
    loadImage(images.axe, 'assets/kotaro-atlas-axe-v1.webp'),
    loadImage(images.bow, 'assets/kotaro-atlas-bow-v1.webp'),
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
      started, paused, x: player.x, y: player.y, hp: player.hp,
      grounded: player.grounded, activeSlot, weapon: currentWeapon(),
      loadout: [...selectedLoadout], attack: player.attack?.kind ?? null,
      projectiles: projectiles.length, livingEnemies: enemies.filter(e => e.alive).length,
      kills, canvasWidth: W, canvasHeight: H,
      sprite: (() => {
        const pose = selectSpritePose();
        return { sheet: pose.sheet, frame: Math.floor(spriteFrameIndex(pose, pose.frame)) };
      })(),
    }),
  };
  render();
  requestAnimationFrame(frame);
})();
