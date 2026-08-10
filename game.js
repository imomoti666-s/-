(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const FLOOR = 590;
  const WORLD_W = 2800;

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
  };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const approach = (a, b, d) => a < b ? Math.min(a + d, b) : Math.max(a - d, b);
  const easeOutCubic = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const rand = (min, max) => min + Math.random() * (max - min);

  const WEAPONS = {
    dagger: { name: '短剣', mark: '刃', note: '手数・短距離', color: '#e9d5a8' },
    axe: { name: '斧', mark: '断', note: '大振り・中距離', color: '#dc7558' },
    bow: { name: '弓', mark: '穿', note: 'チャージ・遠距離', color: '#d2a95f' },
  };

  const BODY = {
    head: [325, 35, 340, 275],
    vest: [285, 315, 275, 290],
    wrap: [535, 325, 275, 280],
    belly: [795, 340, 245, 245],
    pelvis: [1015, 340, 330, 250],
    upperNear: [140, 590, 204, 114],
    foreNear: [325, 590, 184, 134],
    handNear: [505, 590, 122, 142],
    upperFar: [680, 590, 179, 113],
    foreFar: [925, 590, 164, 96],
    handFar: [1115, 590, 107, 93],
    thighNear: [150, 735, 137, 174],
    lowerNear: [505, 790, 136, 118],
    thighFar: [710, 735, 140, 176],
    lowerFar: [1080, 790, 140, 127],
    tailBase: [325, 970, 320, 155],
    tailMid: [620, 970, 270, 155],
    tailTip: [875, 970, 235, 150],
  };

  const GEAR = {
    dagger: [55, 115, 475, 210],
    axe: [575, 75, 660, 350],
    bow: [235, 390, 280, 790],
    arrow: [590, 745, 600, 130],
  };

  const images = {
    body: new Image(),
    weapons: new Image(),
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
      player.comboWindow = .48;
      player.attack = { kind: 'dagger', t: 0, duration: .25 + player.combo * .018, combo: player.combo, fired: false, hit: new Set() };
      if (player.grounded) player.vx += player.facing * 48;
    } else {
      player.attack = { kind: 'axe', t: 0, duration: .78, fired: false, hit: new Set() };
      if (player.grounded) player.vx += player.facing * 20;
    }
  }

  function releaseAttack() {
    input.attack = false;
    if (!player.attack || player.attack.kind !== 'bowCharge') return;
    const charge = clamp(player.attack.charge, .08, 1);
    fireArrow(charge);
    player.attack = { kind: 'bowRelease', t: 0, duration: .28, charge, hit: new Set() };
  }

  function fireArrow(charge) {
    const speed = lerp(680, 1050, charge);
    projectiles.push({
      x: player.x + player.facing * 76, y: player.y - 153,
      vx: player.facing * speed, vy: lerp(5, -25, charge),
      life: 1.8, damage: Math.round(12 + 30 * charge),
      dir: player.facing, rotation: 0,
    });
    player.vx -= player.facing * 28 * charge;
    sfx.swing('bow');
    addBurst(player.x + player.facing * 70, player.y - 153, '#e7be6b', 5, 85);
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

  function meleeHit(kind, attack) {
    const range = kind === 'axe' ? 178 : 92 + attack.combo * 5;
    const damage = kind === 'axe' ? 36 : 11 + attack.combo * 2;
    const y = player.y - 115;
    enemies.forEach(enemy => {
      if (!enemy.alive || attack.hit.has(enemy.id)) return;
      const dx = (enemy.x - player.x) * player.facing;
      const dy = Math.abs(enemy.y - y);
      if (dx > -20 && dx < range && dy < enemy.size / 2 + (kind === 'axe' ? 100 : 70)) {
        attack.hit.add(enemy.id);
        strikeEnemy(enemy, damage, kind === 'axe' ? 410 : 210, kind === 'axe');
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
    addBurst(player.x, player.y - 110, '#d95a49', 12, 220);
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
        if (!a.fired && a.t >= .07) { a.fired = true; sfx.swing('dagger'); }
        if (a.t >= .075 && a.t <= .17) meleeHit('dagger', a);
        if (a.t >= a.duration) player.attack = null;
      } else if (player.attack.kind === 'axe') {
        const a = player.attack;
        if (!a.fired && a.t >= .34) { a.fired = true; sfx.swing('axe'); }
        if (a.t >= .35 && a.t <= .53) meleeHit('axe', a);
        if (a.t >= a.duration) player.attack = null;
      } else if (player.attack.kind === 'bowRelease' && player.attack.t >= player.attack.duration) {
        player.attack = null;
      }
    }

    const axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (axis && player.hurtTimer <= 0 && player.dashTimer <= 0) player.facing = axis;
    if (player.dashTimer > 0) {
      player.dashTimer = Math.max(0, player.dashTimer - dt);
      player.vx = player.facing * 720;
    } else if (player.hurtTimer <= .08) {
      const charging = player.attack?.kind === 'bowCharge';
      const maxSpeed = charging ? 115 : 305;
      const target = axis * maxSpeed;
      const accel = player.grounded ? 2100 : 1250;
      player.vx = approach(player.vx, target, accel * dt);
      if (!axis && player.grounded) player.vx = approach(player.vx, 0, 1700 * dt);
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
      if (Math.abs(enemy.x - player.x) < enemy.size * .55 + 31 && Math.abs(enemy.y - (player.y - 100)) < enemy.size * .65 + 82 && enemy.contactCd <= 0) {
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
        if (Math.hypot(enemy.x - p.x, enemy.y - p.y) < enemy.size * .6 + 18) {
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
    cameraX = lerp(cameraX, clamp(player.x - W * .42, 0, WORLD_W - W), 1 - Math.pow(.0008, dt));
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

  function drawLimb(rect, x, y, length, thickness, angle, far = false) {
    drawPart(images.body, rect, x, y, length, thickness, angle, .06, .5, far ? .76 : 1);
    return { x: x + Math.cos(angle) * length * .78, y: y + Math.sin(angle) * length * .78 };
  }

  function drawLeg(rect, x, y, width, length, angle, far = false) {
    drawPart(images.body, rect, x, y, width, length, angle, .5, .06, far ? .76 : 1);
    return {
      x: x - Math.sin(angle) * length * .76,
      y: y + Math.cos(angle) * length * .76,
    };
  }

  function limbEnd(x, y, length, angle) {
    return { x: x + Math.cos(angle) * length * .78, y: y + Math.sin(angle) * length * .78 };
  }

  function solveArm(shoulder, target, upperLength, foreLength, bend = 1) {
    const dx = target.x - shoulder.x;
    const dy = target.y - shoulder.y;
    const distance = clamp(Math.hypot(dx, dy), 8, upperLength + foreLength - .01);
    const base = Math.atan2(dy, dx);
    const shoulderOffset = Math.acos(clamp(
      (upperLength * upperLength + distance * distance - foreLength * foreLength) / (2 * upperLength * distance),
      -1, 1,
    ));
    const upper = base - shoulderOffset * bend;
    const elbow = { x: shoulder.x + Math.cos(upper) * upperLength, y: shoulder.y + Math.sin(upper) * upperLength };
    return { upper, fore: Math.atan2(target.y - elbow.y, target.x - elbow.x) };
  }

  function attackPose() {
    const a = player.attack;
    const locomotion = a ? 0 : clamp(Math.abs(player.vx) / 305, 0, 1);
    const step = Math.sin(player.walkPhase);
    const pose = {
      upperNear: 1.08 - step * .15 * locomotion,
      foreNear: .94 - step * .1 * locomotion,
      upperFar: 1.56 + step * .18 * locomotion,
      foreFar: 1.4 + step * .12 * locomotion,
      torso: 0, hip: 0, head: 0,
      rootX: 0, rootY: 0, shoulderX: 0, shoulderY: 0,
      legNear: 0, legFar: 0, shinNear: 0, shinFar: 0,
      pull: 0,
    };
    if (player.switchState) {
      const p = Math.sin(clamp(player.switchState.t / player.switchState.duration, 0, 1) * Math.PI);
      pose.upperNear = lerp(1.08, 2.2, p);
      pose.foreNear = lerp(.94, 1.82, p);
      pose.upperFar = lerp(1.56, .72, p);
      pose.foreFar = lerp(1.4, .48, p);
      pose.torso = -.08 * p;
      pose.hip = .04 * p;
      pose.rootY = 3 * p;
    } else if (a?.kind === 'dagger') {
      const p = clamp(a.t / a.duration, 0, 1);
      const wind = easeInOut(clamp(p / .22, 0, 1));
      const strike = easeOutCubic(clamp((p - .22) / .78, 0, 1));
      const action = Math.sin(p * Math.PI);
      const combo = a.combo % 4;
      const from = combo === 1 ? .55 : combo === 2 ? -.35 : -1.55;
      const to = combo === 1 ? -1.22 : combo === 2 ? .02 : .48;
      pose.upperNear = p < .22 ? lerp(1.08, from, wind) : lerp(from, to, strike);
      pose.foreNear = p < .22 ? lerp(.94, from + .22, wind) : lerp(from + .22, to - .08, strike);
      pose.upperFar = lerp(1.42, .28, action);
      pose.foreFar = lerp(1.26, .14, action);
      pose.torso = p < .22 ? lerp(0, -.15, wind) : lerp(-.15, .2, strike);
      pose.hip = -pose.torso * .48;
      pose.head = -pose.torso * .22;
      pose.rootX = action * (combo === 2 ? 34 : 25);
      pose.rootY = action * 5;
      pose.shoulderX = action * 12;
      pose.legNear = -action * .24;
      pose.legFar = action * .2;
      pose.shinNear = action * .1;
      pose.shinFar = -action * .08;
    } else if (a?.kind === 'axe') {
      const p = clamp(a.t / a.duration, 0, 1);
      const wind = easeInOut(clamp(p / .43, 0, 1));
      const strike = easeOutCubic(clamp((p - .43) / .57, 0, 1));
      const swing = p < .43 ? lerp(1.08, -1.78, wind) : lerp(-1.78, .72, strike);
      const action = Math.sin(p * Math.PI);
      pose.upperNear = swing;
      pose.foreNear = swing + (p < .43 ? .22 : -.12);
      pose.upperFar = swing + .18;
      pose.foreFar = swing + .3;
      pose.torso = p < .43 ? lerp(0, -.22, wind) : lerp(-.22, .27, strike);
      pose.hip = -pose.torso * .55;
      pose.head = -pose.torso * .3;
      pose.rootX = p < .43 ? -8 * wind : lerp(-8, 38, strike);
      pose.rootY = action * 9;
      pose.shoulderX = action * 9;
      pose.shoulderY = -action * 4;
      pose.legNear = -action * .28;
      pose.legFar = action * .25;
      pose.shinNear = action * .12;
      pose.shinFar = -action * .1;
    } else if (a?.kind === 'bowCharge') {
      pose.pull = a.charge;
      pose.upperNear = -.12;
      pose.foreNear = .02;
      pose.upperFar = lerp(1.46, 2.78, pose.pull);
      pose.foreFar = lerp(1.3, .12, pose.pull);
      pose.torso = -.06 - pose.pull * .06;
      pose.hip = .05 + pose.pull * .03;
      pose.head = .04 * pose.pull;
      pose.rootX = -5 * pose.pull;
      pose.legNear = -.14;
      pose.legFar = .12;
    } else if (a?.kind === 'bowRelease') {
      const p = easeOutCubic(a.t / a.duration);
      pose.pull = 1 - p;
      pose.upperNear = lerp(-.12, .18, p);
      pose.foreNear = lerp(.02, .2, p);
      pose.upperFar = lerp(2.78, .48, p);
      pose.foreFar = lerp(.12, .72, p);
      pose.torso = lerp(-.12, .08, p);
      pose.hip = -pose.torso * .5;
      pose.rootX = -8 * (1 - p);
      pose.legNear = -.14 * (1 - p);
      pose.legFar = .12 * (1 - p);
    }
    return pose;
  }

  function drawInactiveWeapon(weapon) {
    if (weapon === 'dagger') drawPart(images.weapons, GEAR.dagger, -35, -120, 74, 32, 1.85, .18, .5, .62);
    if (weapon === 'axe') drawPart(images.weapons, GEAR.axe, -22, -165, 125, 66, -1.12, .72, .5, .52, true);
    if (weapon === 'bow') drawPart(images.weapons, GEAR.bow, -32, -155, 38, 118, -.25, .5, .5, .55);
  }

  function drawPuppet(screenX, screenY) {
    const speed = clamp(Math.abs(player.vx) / 305, 0, 1);
    const phase = player.walkPhase;
    const air = player.grounded ? 0 : 1;
    const stride = Math.sin(phase) * .52 * speed;
    const breath = player.grounded ? Math.sin(player.animTime * 2.35) : 0;
    const bob = player.grounded ? Math.abs(Math.sin(phase)) * 4 * speed + breath * .7 : 0;
    const squash = player.landing;
    const pose = attackPose();
    const hurtLean = player.hurtTimer > 0 ? -player.facing * .13 : 0;
    const bodyLean = pose.torso + clamp(player.vx / 1800, -.09, .09) + hurtLean;
    const blink = player.invulnerable > 0 && Math.floor(player.invulnerable * 18) % 2 === 0;

    ctx.save();
    ctx.translate(screenX, screenY + bob);
    ctx.scale(player.facing, 1);
    ctx.translate(pose.rootX, pose.rootY);
    ctx.globalAlpha = blink ? .48 : 1;
    ctx.scale(1 + squash * .09, 1 - squash * .12);

    // Tail: three delayed segments make the heavy body feel balanced rather than pasted down.
    const tailA = player.tailRot + Math.sin(player.animTime * 1.7) * .025 + Math.sin(phase * .45) * .035 * speed - pose.torso * .42;
    // These atlas entries are alternate complete tails, not three chain links.
    // Drawing all of them created the three-pronged tail visible during attacks.
    drawPart(images.body, BODY.tailBase, -21, -119, 188, 68, tailA, .91, .5, .9);

    // Far leg.
    const hipFar = { x: -18, y: -99 };
    const farThighAngle = air ? .34 : stride * .45 + pose.legFar;
    const kneeFar = drawLeg(BODY.thighFar, hipFar.x, hipFar.y, 72, 64, farThighAngle, true);
    drawLeg(BODY.lowerFar, kneeFar.x, kneeFar.y, 60, 57, air ? -.22 : stride * .12 + pose.shinFar, true);

    // Inactive weapon sits behind the body and remains visible during switching.
    drawInactiveWeapon(selectedLoadout[1 - activeSlot]);

    const weapon = currentWeapon();
    const shoulderNear = { x: 17 + pose.shoulderX, y: -190 + pose.shoulderY };
    const plannedElbowNear = limbEnd(shoulderNear.x, shoulderNear.y, 71, pose.upperNear);
    const plannedHandNear = limbEnd(plannedElbowNear.x, plannedElbowNear.y, 60, pose.foreNear);

    // Far arm.
    const shoulderFar = { x: -2 + pose.shoulderX * .35, y: -187 + pose.shoulderY };
    let upperFar = pose.upperFar;
    let foreFar = pose.foreFar;
    if (player.attack?.kind === 'axe') {
      const grip = {
        x: plannedHandNear.x - Math.cos(pose.foreNear) * 34,
        y: plannedHandNear.y - Math.sin(pose.foreNear) * 34,
      };
      ({ upper: upperFar, fore: foreFar } = solveArm(shoulderFar, grip, 68 * .78, 59 * .78, 1));
    } else if (player.attack?.kind === 'bowCharge' || player.attack?.kind === 'bowRelease') {
      const grip = {
        x: plannedHandNear.x - lerp(28, 64, pose.pull),
        y: plannedHandNear.y - lerp(-5, 3, pose.pull),
      };
      ({ upper: upperFar, fore: foreFar } = solveArm(shoulderFar, grip, 68 * .78, 59 * .78, 1));
    }
    const elbowFar = drawLimb(BODY.upperFar, shoulderFar.x, shoulderFar.y, 68, 39, upperFar, true);
    const handFar = drawLimb(BODY.foreFar, elbowFar.x, elbowFar.y, 59, 35, foreFar, true);
    drawPart(images.body, BODY.handFar, handFar.x, handFar.y, 36, 32, foreFar, .2, .5, .76);

    // Pelvis and layered torso.
    drawPart(images.body, BODY.pelvis, 0, -104, 124, 88, pose.hip, .5, .52);
    ctx.save(); ctx.translate(pose.shoulderX * .18, -110); ctx.rotate(bodyLean);
    drawPart(images.body, BODY.vest, -7, -68, 116, 136, -.03, .48, .55);
    drawPart(images.body, BODY.belly, 24, -43 + breath * .55, 104 + breath * .25, 111 + breath * .35, .02, .48, .52);
    drawPart(images.body, BODY.wrap, 9, -78, 118, 122, .015, .48, .52, .96);
    drawPart(images.body, BODY.head, 20, -145, 130, 106, -.025 - bodyLean * .42 + pose.head, .42, .68);
    ctx.restore();

    // Each lower-leg image already contains the ankle and paw. Drawing a third
    // "foot" segment was the source of the visibly detached, duplicated legs.
    const hipNear = { x: 18, y: -99 };
    const nearThighAngle = air ? -.42 : -stride * .45 + pose.legNear;
    const kneeNear = drawLeg(BODY.thighNear, hipNear.x, hipNear.y, 74, 64, nearThighAngle);
    drawLeg(BODY.lowerNear, kneeNear.x, kneeNear.y, 62, 56, air ? .18 : -stride * .12 + pose.shinNear);

    // Near arm and held weapon.
    const elbowNear = drawLimb(BODY.upperNear, shoulderNear.x, shoulderNear.y, 71, 40, pose.upperNear);
    const handNear = drawLimb(BODY.foreNear, elbowNear.x, elbowNear.y, 60, 38, pose.foreNear);
    drawPart(images.body, BODY.handNear, handNear.x, handNear.y, 37, 34, pose.foreNear, .2, .5);

    if (weapon === 'dagger') {
      drawPart(images.weapons, GEAR.dagger, handNear.x + 7, handNear.y, 108, 45, pose.foreNear, .13, .5);
    } else if (weapon === 'axe') {
      drawPart(images.weapons, GEAR.axe, handNear.x + 8, handNear.y, 178, 91, pose.foreNear, .79, .5, 1, true);
    } else {
      const bowX = handNear.x + 10;
      const bowY = handNear.y;
      const bowRot = player.attack ? 0 : .28;
      drawPart(images.weapons, GEAR.bow, bowX, bowY, 49, 154, bowRot, .5, .5);
      if (player.attack?.kind === 'bowCharge') {
        drawPart(images.weapons, GEAR.arrow, lerp(handFar.x, bowX, .42), bowY, 126, 25, 0, .15, .5);
      }
    }

    // Procedural action trails belong to the motion, not to a baked frame.
    if (player.attack?.kind === 'dagger' && player.attack.t > .06 && player.attack.t < .18) {
      ctx.strokeStyle = 'rgba(244,218,157,.72)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(25, -155, 92, -1.3, .5); ctx.stroke();
    }
    if (player.attack?.kind === 'axe' && player.attack.t > .34 && player.attack.t < .55) {
      ctx.strokeStyle = 'rgba(213,98,72,.62)'; ctx.lineWidth = 13; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(7, -153, 148, -1.55, .6); ctx.stroke();
    }
    if (player.dashTimer > 0) {
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = .11 / i;
        ctx.fillStyle = '#e1ad62'; ctx.beginPath(); ctx.ellipse(-i * 36, -105, 40, 92, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
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
    projectiles.forEach(p => drawPart(images.weapons, GEAR.arrow, p.x - cameraX, p.y, 104, 22, p.rotation, .5, .5));
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

    // Grounding shadow follows acceleration and landing compression.
    ctx.fillStyle = `rgba(0,0,0,${player.grounded ? .34 : .18})`;
    ctx.beginPath(); ctx.ellipse(player.x - cameraX, FLOOR + 5, 54 - Math.min(20, Math.abs(player.y - FLOOR) * .06), 12, 0, 0, Math.PI * 2); ctx.fill();
    enemies.forEach(drawEnemy);
    drawProjectiles();
    drawPuppet(player.x - cameraX, player.y);
    drawParticles();

    // Bow charge meter is deliberately world-space, directly above Kotaro.
    if (player.attack?.kind === 'bowCharge') {
      const c = player.attack.charge;
      const x = player.x - cameraX - 55, y = player.y - 300;
      ctx.fillStyle = 'rgba(12,10,15,.72)'; ctx.fillRect(x, y, 110, 9);
      ctx.fillStyle = c >= 1 ? '#fff0ac' : '#e1ad62'; ctx.fillRect(x + 2, y + 2, 106 * c, 5);
    }
    ctx.restore();
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

  function syncPauseState() {
    paused = document.hidden || ui.help.open || ui.loadout.open;
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
    sfx.init(); started = true; paused = false; ui.boot.classList.add('hidden'); showNotice('訓練開始', 1.1);
  });

  ui.start.disabled = true;
  Promise.all([
    loadImage(images.body, 'assets/kotaro-rig-atlas.webp'),
    loadImage(images.weapons, 'assets/kotaro-weapons-atlas.webp'),
  ]).then(() => {
    ui.start.disabled = false;
    ui.assetStatus.textContent = 'コタロー準備完了';
  }).catch(error => {
    console.error(error);
    ui.assetStatus.textContent = '素材の読み込みに失敗した。再読み込みしてくれ。';
  });

  buildLoadoutControls();
  updateHud();
  window.__KEMOSURA__ = {
    snapshot: () => ({
      started, paused, x: player.x, y: player.y, hp: player.hp,
      grounded: player.grounded, activeSlot, weapon: currentWeapon(),
      loadout: [...selectedLoadout], attack: player.attack?.kind ?? null,
      projectiles: projectiles.length, livingEnemies: enemies.filter(e => e.alive).length,
      kills,
    }),
  };
  render();
  requestAnimationFrame(frame);
})();
