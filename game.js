(() => {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('gameOverlay');
  const launchButton = document.getElementById('launchButton');
  const launchText = document.getElementById('launchText');
  const authDialog = document.getElementById('authDialog');
  const authForm = document.getElementById('authForm');
  const keys = new Set();
  const lime = '#a4ff4f';
  const avatars = [
    { id: 'rook', name: 'ROOK', role: 'ADAPTIVE', color: '#a4ff4f', health: 100, speed: 205, fireRate: 1, pulseRadius: 82, pulseDuration: .55 },
    { id: 'bastion', name: 'BASTION', role: 'HEAVY', color: '#65d8ff', health: 135, speed: 170, fireRate: 1.16, pulseRadius: 108, pulseDuration: .8 },
    { id: 'wisp', name: 'WISP', role: 'AGILE', color: '#ffc45c', health: 84, speed: 258, fireRate: .78, pulseRadius: 72, pulseDuration: .48 },
  ];
  const rings = [
    { name: 'VERDANT', construct: 'LANCE', color: '#a4ff4f', rate: 180, damage: 1, speed: 620, style: 'lance' },
    { name: 'AZURE', construct: 'WARD', color: '#66d9ff', rate: 250, damage: 1, speed: 570, style: 'ward', pierce: 1 },
    { name: 'AMBER', construct: 'HAMMER', color: '#ffc45c', rate: 540, damage: 3, speed: 450, style: 'hammer' },
    { name: 'CRIMSON', construct: 'NOVA', color: '#ff6b73', rate: 115, damage: 1, speed: 520, style: 'nova' },
    { name: 'VIOLET', construct: 'CAGE', color: '#c29aff', rate: 240, damage: 1, speed: 520, style: 'cage', slow: 1.4 },
    { name: 'CYAN', construct: 'MIRROR', color: '#68ffe0', rate: 330, damage: 1, speed: 560, style: 'mirror', spread: .15 },
  ];
  let ringIndex = 0;
  let width = 960;
  let height = 540;
  let pixelRatio = 1;
  let state = 'ready';
  let lastFrame = 0;
  let lastShot = 0;
  let messageTimer = 0;
  let spawnTimer = 0;
  let lastPersistedScore = 0;
  let player = null;
  let enemies = [];
  let shots = [];
  let particles = [];
  let constructEffects = [];
  let pickups = [];
  let score = 0;
  let wave = 1;
  let waveKills = 0;
  let waveTarget = 7;
  let deployments = Math.max(0, Number(localStorage.getItem('pd_deployments') || 0));
  let user = null;
  let aim = { x: 700, y: 240 };
  let pointerDown = false;
  let obstacles = [];
  let stars = [];
  let authMode = 'register';
  let avatarIndex = Math.max(0, avatars.findIndex((avatar) => avatar.id === localStorage.getItem('pd_avatar')));

  const $ = (id) => document.getElementById(id);

  function activeAvatar() {
    return avatars[avatarIndex];
  }

  function updateAvatarSelection() {
    const avatar = activeAvatar();
    document.querySelectorAll('.avatar-choice').forEach((button) => {
      const selected = button.dataset.avatar === avatar.id;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.style.setProperty('--avatar-accent', avatar.color);
    });
    const emblem = document.querySelector('.pilot-emblem');
    emblem.style.color = avatar.color;
    emblem.style.borderColor = `${avatar.color}88`;
    if (player) {
      const healthRatio = player.health / player.maxHealth;
      player.maxHealth = avatar.health;
      player.health = Math.min(avatar.health, healthRatio * avatar.health);
      player.speed = avatar.speed;
      player.fireRate = avatar.fireRate;
      player.pulseRadius = avatar.pulseRadius;
      player.pulseDuration = avatar.pulseDuration;
      updateHud();
    }
    localStorage.setItem('pd_avatar', avatar.id);
    if (state === 'playing') setMessage(`${avatar.name} FRAME // ${avatar.role} LOADOUT`, 1000);
    draw();
  }

  document.querySelectorAll('.avatar-choice').forEach((button) => {
    button.addEventListener('click', () => {
      const nextIndex = avatars.findIndex((avatar) => avatar.id === button.dataset.avatar);
      if (nextIndex >= 0 && nextIndex !== avatarIndex) {
        avatarIndex = nextIndex;
        updateAvatarSelection();
      }
    });
  });

  function resize() {
    const rect = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    stars = Array.from({ length: Math.floor(width * height / 1450) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.15 + .25,
      alpha: Math.random() * .36 + .08,
      phase: Math.random() * 5,
    }));
    obstacles = [
      { x: width * .25, y: height * .30, r: 21, type: 'rock' },
      { x: width * .76, y: height * .30, r: 25, type: 'rock' },
      { x: width * .24, y: height * .73, r: 24, type: 'rock' },
      { x: width * .76, y: height * .72, r: 19, type: 'rock' },
      { x: width * .5, y: height * .18, r: 11, type: 'crystal' },
      { x: width * .51, y: height * .83, r: 14, type: 'crystal' },
    ];
    if (player) {
      player.x = Math.min(width - 28, Math.max(28, player.x));
      player.y = Math.min(height - 28, Math.max(50, player.y));
    }
    draw();
  }

  function drawBackground(time) {
    ctx.fillStyle = '#09140e';
    ctx.fillRect(0, 0, width, height);
    const glow = ctx.createRadialGradient(width * .5, height * .5, 0, width * .5, height * .5, width * .65);
    glow.addColorStop(0, 'rgba(27,67,32,.23)');
    glow.addColorStop(1, 'rgba(5,12,8,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = 'rgba(160,220,143,.045)';
    ctx.lineWidth = 1;
    const grid = 42;
    const shift = (time * .004) % grid;
    for (let x = -grid + shift; x < width; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = -grid + shift; y < height; y += grid) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    for (const star of stars) {
      ctx.globalAlpha = star.alpha * (.75 + Math.sin(time * .001 + star.phase) * .25);
      ctx.fillStyle = '#eaffd3';
      ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    const centerX = width * .5;
    const centerY = height * .5;
    const beaconRadius = Math.min(width, height) * .105;
    ctx.save();
    ctx.setLineDash([2, 8]);
    ctx.strokeStyle = 'rgba(164,255,79,.12)';
    ctx.beginPath(); ctx.arc(centerX, centerY, beaconRadius + 18, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(164,255,79,.10)';
    ctx.beginPath(); ctx.arc(centerX, centerY, beaconRadius + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(106,202,65,.09)';
    ctx.beginPath(); ctx.arc(centerX, centerY, beaconRadius * (1 + Math.sin(time * .003) * .04), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(164,255,79,.48)';
    ctx.beginPath(); ctx.arc(centerX, centerY, beaconRadius, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = rings[ringIndex].color;
    ctx.beginPath(); ctx.arc(centerX, centerY, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(164,255,79,.5)';
    ctx.font = '8px "DM Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('COLONY BEACON', centerX, centerY + beaconRadius + 33);
    ctx.restore();

    for (const rock of obstacles) {
      ctx.save();
      ctx.translate(rock.x, rock.y);
      if (rock.type === 'crystal') {
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = 'rgba(153,244,105,.34)';
        ctx.fillStyle = 'rgba(42,95,43,.35)';
        ctx.fillRect(-rock.r * .6, -rock.r * .6, rock.r * 1.2, rock.r * 1.2);
        ctx.strokeRect(-rock.r * .6, -rock.r * .6, rock.r * 1.2, rock.r * 1.2);
      } else {
        ctx.fillStyle = 'rgba(20,41,26,.8)';
        ctx.strokeStyle = 'rgba(140,193,119,.24)';
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const angle = i / 7 * Math.PI * 2;
          const radius = rock.r * (.84 + (i % 2) * .18);
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius * .7;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawPlayer(time) {
    if (!player) return;
    const avatar = activeAvatar();
    const angle = Math.atan2(aim.y - player.y, aim.x - player.x);
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(angle);
    if (player.shield > 0) {
      ctx.strokeStyle = avatar.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = .45 + player.shield * .45;
      ctx.shadowColor = avatar.color; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(0, 0, 21 + (1 - player.shield) * 9, -Math.PI * .72, Math.PI * .72); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = `${avatar.color}24`;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#eaffd3';
    ctx.strokeStyle = avatar.color;
    ctx.shadowColor = avatar.color; ctx.shadowBlur = 14; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (avatar.id === 'bastion') {
      ctx.moveTo(13, 0); ctx.lineTo(7, -10); ctx.lineTo(-6, -10); ctx.lineTo(-12, -6);
      ctx.lineTo(-12, 6); ctx.lineTo(-6, 10); ctx.lineTo(7, 10); ctx.closePath();
    } else if (avatar.id === 'wisp') {
      ctx.moveTo(16, 0); ctx.lineTo(-3, -5); ctx.lineTo(-12, -11); ctx.lineTo(-8, 0);
      ctx.lineTo(-12, 11); ctx.lineTo(-3, 5); ctx.closePath();
    } else {
      ctx.moveTo(15, 0); ctx.lineTo(-7, -9); ctx.lineTo(-4, 0); ctx.lineTo(-7, 9); ctx.closePath();
    }
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = rings[ringIndex].color;
    ctx.beginPath(); ctx.arc(1, 0, avatar.id === 'bastion' ? 3 : 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = avatar.color;
    ctx.globalAlpha = .55 + Math.sin(time * .02) * .2;
    ctx.beginPath(); ctx.arc(player.x, player.y, avatar.id === 'bastion' ? 2.5 : 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawEnemy(enemy) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate(enemy.angle);
    const radius = enemy.radius;
    ctx.shadowColor = '#ff805b'; ctx.shadowBlur = enemy.flash > 0 ? 20 : 6;
    ctx.fillStyle = enemy.flash > 0 ? '#fff1de' : 'rgba(255,111,82,.83)';
    ctx.strokeStyle = 'rgba(255,166,127,.8)';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      const distance = radius * (i % 2 ? .64 : 1);
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.fillStyle = '#371915';
    ctx.beginPath(); ctx.arc(1, 0, radius * .26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe4ad'; ctx.beginPath(); ctx.arc(2, -1, radius * .1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (enemy.hp < enemy.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(enemy.x - radius, enemy.y - radius - 6, radius * 2, 2);
      ctx.fillStyle = '#ff805b'; ctx.fillRect(enemy.x - radius, enemy.y - radius - 6, radius * 2 * enemy.hp / enemy.maxHp, 2);
    }
  }

  function drawConstructShot(shot, time) {
    ctx.save();
    ctx.translate(shot.x, shot.y);
    ctx.rotate(Math.atan2(shot.vy, shot.vx));
    ctx.strokeStyle = shot.color;
    ctx.fillStyle = `${shot.color}bb`;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = shot.color;
    ctx.shadowBlur = 12;

    if (shot.style === 'lance') {
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-8, -3); ctx.lineTo(-3, 0); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = .65; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-14, 0); ctx.stroke();
    } else if (shot.style === 'ward') {
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(3, -5); ctx.lineTo(-4, -5); ctx.lineTo(-7, 0); ctx.lineTo(-4, 5); ctx.lineTo(3, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-2, -3); ctx.lineTo(2, 0); ctx.lineTo(-2, 3); ctx.stroke();
    } else if (shot.style === 'hammer') {
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(2, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(2, -6); ctx.lineTo(8, -4); ctx.lineTo(8, 4); ctx.lineTo(2, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (shot.style === 'nova') {
      const rotation = time * .006;
      ctx.rotate(rotation);
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const angle = i * Math.PI / 6;
        const radius = i % 2 ? 3 : 7;
        const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff2d6'; ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, Math.PI * 2); ctx.fill();
    } else if (shot.style === 'cage') {
      ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(1, -7); ctx.lineTo(7, -4); ctx.lineTo(7, 3); ctx.lineTo(1, 7); ctx.lineTo(-5, 4); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(1, 0); ctx.lineTo(7, -4); ctx.moveTo(1, 0); ctx.lineTo(1, 7); ctx.moveTo(-5, 4); ctx.lineTo(1, 0); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -5); ctx.lineTo(-6, -2); ctx.lineTo(-1, 0); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-2, -2); ctx.moveTo(-8, 5); ctx.lineTo(-2, 2); ctx.stroke();
    }
    ctx.restore();
  }

  function drawConstructPulse(effect) {
    const progress = 1 - effect.life / effect.duration;
    const radius = effect.radius * (.45 + progress * .65);
    ctx.save();
    ctx.translate(effect.x, effect.y);
    ctx.globalAlpha = Math.max(0, effect.life / effect.duration);
    ctx.strokeStyle = effect.color;
    ctx.fillStyle = `${effect.color}18`;
    ctx.lineWidth = 2;
    ctx.shadowColor = effect.color;
    ctx.shadowBlur = 18;

    if (effect.style === 'cage') {
      ctx.rotate(progress * Math.PI / 4);
      ctx.strokeRect(-radius * .72, -radius * .72, radius * 1.44, radius * 1.44);
      ctx.strokeRect(-radius * .5, -radius * .5, radius, radius);
      ctx.beginPath(); ctx.moveTo(-radius * .72, -radius * .72); ctx.lineTo(-radius * .5, -radius * .5); ctx.moveTo(radius * .72, radius * .72); ctx.lineTo(radius * .5, radius * .5); ctx.stroke();
    } else if (effect.style === 'hammer') {
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const angle = progress * .35 + i * Math.PI / 2;
        ctx.save(); ctx.rotate(angle); ctx.fillRect(radius * .7, -3, radius * .25, 6); ctx.restore();
      }
    } else if (effect.style === 'nova') {
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8;
        const distance = radius * (i % 2 ? .78 : 1);
        if (i === 0) ctx.moveTo(Math.cos(angle) * distance, Math.sin(angle) * distance);
        else ctx.lineTo(Math.cos(angle) * distance, Math.sin(angle) * distance);
      }
      ctx.closePath(); ctx.stroke();
    } else if (effect.style === 'mirror') {
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate(i * Math.PI / 3 + progress * .2);
        ctx.beginPath(); ctx.moveTo(0, -radius); ctx.lineTo(radius * .18, 0); ctx.lineTo(0, radius); ctx.lineTo(-radius * .18, 0); ctx.closePath(); ctx.stroke(); ctx.restore();
      }
    } else {
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
      if (effect.style === 'ward') {
        ctx.beginPath(); ctx.arc(0, 0, radius * .78, -Math.PI * .72, Math.PI * .72); ctx.stroke();
      } else {
        for (let i = 0; i < 4; i++) {
          ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.beginPath(); ctx.moveTo(radius * .72, 0); ctx.lineTo(radius, -3); ctx.lineTo(radius, 3); ctx.closePath(); ctx.fill(); ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  function draw() {
    const time = performance.now();
    drawBackground(time);
    for (const effect of constructEffects) drawConstructPulse(effect);
    for (const pickup of pickups) {
      ctx.save(); ctx.translate(pickup.x, pickup.y); ctx.rotate(time * .0015);
      ctx.strokeStyle = lime; ctx.fillStyle = 'rgba(164,255,79,.15)'; ctx.shadowColor = lime; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    for (const shot of shots) {
      drawConstructShot(shot, time);
    }
    ctx.shadowBlur = 0;
    for (const enemy of enemies) drawEnemy(enemy);
    drawPlayer(time);
    for (const particle of particles) {
      ctx.globalAlpha = Math.max(0, particle.life); ctx.fillStyle = particle.color;
      ctx.beginPath(); ctx.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function setMessage(text, duration = 1400) {
    $('gameMessage').textContent = text;
    messageTimer = duration;
  }

  function spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    const margin = 30;
    const x = side === 0 ? -margin : side === 1 ? width + margin : Math.random() * width;
    const y = side === 2 ? -margin : side === 3 ? height + margin : Math.random() * height;
    const heavy = Math.random() < Math.min(.09 + wave * .015, .35);
    const radius = heavy ? 14 : 10;
    enemies.push({ x, y, radius, hp: heavy ? 3 : 1, maxHp: heavy ? 3 : 1, speed: (heavy ? 26 : 40) + Math.min(wave * 2.2, 35), damage: heavy ? 24 : 14, angle: 0, flash: 0 });
  }

  function spawnBurst(x, y, color, count = 8, speed = 120) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (.25 + Math.random() * .75);
      particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: .45 + Math.random() * .45, size: 1 + Math.random() * 2, color });
    }
  }

  function updateHud() {
    const healthPercent = Math.max(0, player.health / player.maxHealth * 100);
    $('healthBar').style.width = `${healthPercent}%`;
    $('healthBar').style.backgroundColor = activeAvatar().color;
    $('healthText').textContent = `${Math.ceil(healthPercent)}%`;
    $('waveText').textContent = String(wave).padStart(2, '0');
    $('enemyText').textContent = `${String(enemies.length).padStart(2, '0')} HOSTILES`;
    $('scoreText').textContent = String(score).padStart(6, '0');
    $('contactCount').textContent = String(enemies.length || Math.max(1, Math.ceil(wave * 1.4))).padStart(2, '0');
    $('ringLabel').textContent = `${rings[ringIndex].name} / ${rings[ringIndex].construct}`;
    $('ringLabel').style.color = rings[ringIndex].color;
  }

  function selectRing(direction) {
    ringIndex = (ringIndex + direction + rings.length) % rings.length;
    $('ringLabel').textContent = `${rings[ringIndex].name} / ${rings[ringIndex].construct}`;
    $('ringLabel').style.color = rings[ringIndex].color;
    setMessage(`${rings[ringIndex].name} BAND // ${rings[ringIndex].construct} CONSTRUCT`, 900);
  }

  function startGame() {
    if (state === 'playing') return;
    const avatar = activeAvatar();
    state = 'playing'; score = 0; wave = 1; waveKills = 0; waveTarget = 7;
    lastPersistedScore = 0; enemies = []; shots = []; particles = []; pickups = []; constructEffects = [];
    player = { x: width * .5, y: height * .5 + 62, health: avatar.health, maxHealth: avatar.health, speed: avatar.speed, fireRate: avatar.fireRate, pulseRadius: avatar.pulseRadius, pulseDuration: avatar.pulseDuration, shield: 0, shieldCooldown: 0, invulnerable: 0 };
    deployments++;
    localStorage.setItem('pd_deployments', String(deployments));
    $('deployments').textContent = String(deployments).padStart(2, '0');
    $('gameHud').hidden = false;
    $('ringSwitch').hidden = false;
    overlay.classList.add('is-hidden');
    spawnEnemy(); spawnEnemy(); updateHud();
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }

  function showGameOver() {
    state = 'over';
    $('gameHud').hidden = true;
    $('ringSwitch').hidden = true;
    $('overlayKicker').textContent = 'SIGNAL LOST // BEACON SECURED';
    $('overlayTitle').innerHTML = 'YOU HELD THE<br><em>FRONTIER.</em>';
    $('overlayCopy').innerHTML = `FIELD SCORE <strong style="color:var(--green)">${score.toLocaleString()}</strong> &nbsp; / &nbsp; WAVE ${String(wave).padStart(2, '0')}<br>Your sacrifice bought the colony another day.`;
    launchText.textContent = 'DEPLOY AGAIN';
    overlay.classList.remove('is-hidden');
    persistRun();
  }

  async function persistRun() {
    if (!user || score <= lastPersistedScore) return;
    lastPersistedScore = score;
    try {
      const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ score, wave }) });
      if (response.ok) {
        const data = await response.json();
        user = data.user; updatePilot(); loadLeaderboard();
      }
    } catch {}
  }

  function shieldPulse() {
    if (!player || player.shieldCooldown > 0) return;
    const avatar = activeAvatar();
    const ring = rings[ringIndex];
    player.shield = avatar.pulseDuration; player.shieldCooldown = 4.5;
    constructEffects.push({ x: player.x, y: player.y, life: .72, duration: .72, radius: avatar.pulseRadius, style: ring.style, color: ring.color });
    spawnBurst(player.x, player.y, ring.color, 22, 190);
    for (const enemy of [...enemies]) {
      if (Math.hypot(enemy.x - player.x, enemy.y - player.y) < avatar.pulseRadius) {
        enemy.hp--; enemy.flash = .12;
        if (enemy.hp <= 0) killEnemy(enemy, ring.color);
      }
    }
    setMessage('WARD PULSE // HOSTILES DISRUPTED', 950);
  }

  function killEnemy(enemy, impactColor = rings[ringIndex].color) {
    const index = enemies.indexOf(enemy);
    if (index < 0) return;
    enemies.splice(index, 1);
    score += enemy.maxHp === 1 ? 100 : 250; waveKills++;
    spawnBurst(enemy.x, enemy.y, impactColor, 14, 175);
    if (Math.random() < .13) pickups.push({ x: enemy.x, y: enemy.y, life: 9 });
    if (score - lastPersistedScore >= 500) persistRun();
    if (waveKills >= waveTarget) {
      wave++; waveKills = 0; waveTarget = 6 + wave * 2;
      player.health = Math.min(100, player.health + 12);
      setMessage(`WAVE ${String(wave).padStart(2, '0')} // COLONY DEFENSE HOLDS`, 1800);
    }
  }

  function update(dt) {
    if (state !== 'playing') return;
    const speed = player.speed * dt;
    let dx = 0; let dy = 0;
    if (keys.has('w') || keys.has('arrowup')) dy--;
    if (keys.has('s') || keys.has('arrowdown')) dy++;
    if (keys.has('a') || keys.has('arrowleft')) dx--;
    if (keys.has('d') || keys.has('arrowright')) dx++;
    if (dx && dy) { dx *= .7071; dy *= .7071; }
    player.x = Math.max(18, Math.min(width - 18, player.x + dx * speed));
    player.y = Math.max(54, Math.min(height - 18, player.y + dy * speed));
    player.shield = Math.max(0, player.shield - dt);
    player.shieldCooldown = Math.max(0, player.shieldCooldown - dt);
    player.invulnerable = Math.max(0, player.invulnerable - dt);

    for (const rock of obstacles) {
      if (rock.type !== 'rock') continue;
      const distance = Math.hypot(player.x - rock.x, player.y - rock.y);
      const minDistance = rock.r + 10;
      if (distance < minDistance && distance > 0) {
        player.x = rock.x + ((player.x - rock.x) / distance) * minDistance;
        player.y = rock.y + ((player.y - rock.y) / distance) * minDistance;
      }
    }

    const activeRing = rings[ringIndex];
    if (pointerDown && performance.now() - lastShot > activeRing.rate * player.fireRate) {
      lastShot = performance.now();
      const angle = Math.atan2(aim.y - player.y, aim.x - player.x);
      const offsets = activeRing.spread ? [-activeRing.spread, 0, activeRing.spread] : [0];
      for (const offset of offsets) {
        const shotAngle = angle + offset;
        shots.push({ x: player.x + Math.cos(shotAngle) * 14, y: player.y + Math.sin(shotAngle) * 14, vx: Math.cos(shotAngle) * activeRing.speed, vy: Math.sin(shotAngle) * activeRing.speed, life: .9, friendly: true, damage: activeRing.damage, style: activeRing.style, color: activeRing.color, pierce: activeRing.pierce || 0, slow: activeRing.slow || 0, hits: 0 });
      }
    }
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnEnemy();
      spawnTimer = Math.max(.45, 1.8 - wave * .09) * (.72 + Math.random() * .6);
    }

    for (const enemy of [...enemies]) {
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.slow = Math.max(0, (enemy.slow || 0) - dt);
      const targetX = width * .5; const targetY = height * .5;
      enemy.angle = Math.atan2(targetY - enemy.y, targetX - enemy.x);
      const pace = enemy.speed * (enemy.slow > 0 ? .42 : 1) * dt;
      enemy.x += Math.cos(enemy.angle) * pace;
      enemy.y += Math.sin(enemy.angle) * pace;
      if (Math.hypot(targetX - enemy.x, targetY - enemy.y) < Math.min(width, height) * .105) {
        if (player.shield <= 0) player.health -= enemy.damage * .25;
        spawnBurst(enemy.x, enemy.y, 'rgba(255,128,91,.9)', 12, 150);
        enemies.splice(enemies.indexOf(enemy), 1);
        setMessage('BEACON HIT // KEEP THEM BACK', 800);
      }
    }

    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i];
      shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.life -= dt;
      if (shot.life <= 0 || shot.x < 0 || shot.y < 0 || shot.x > width || shot.y > height) { shots.splice(i, 1); continue; }
      for (const enemy of enemies) {
        if (Math.hypot(shot.x - enemy.x, shot.y - enemy.y) < enemy.radius + 3) {
          enemy.hp -= shot.damage; enemy.flash = .12;
          if (shot.slow) enemy.slow = shot.slow;
          spawnBurst(shot.x, shot.y, shot.color, 5, 95);
          if (shot.pierce > 0 && shot.hits < shot.pierce) shot.hits++;
          else shots.splice(i, 1);
          if (enemy.hp <= 0) killEnemy(enemy, shot.color);
          break;
        }
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= .97; particle.vy *= .97; particle.life -= dt * 1.4;
      if (particle.life <= 0) particles.splice(i, 1);
    }
    for (let i = constructEffects.length - 1; i >= 0; i--) {
      constructEffects[i].life -= dt;
      if (constructEffects[i].life <= 0) constructEffects.splice(i, 1);
    }
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pickup = pickups[i]; pickup.life -= dt;
      if (Math.hypot(player.x - pickup.x, player.y - pickup.y) < 18) {
        player.health = Math.min(100, player.health + 15); score += 50;
        pickups.splice(i, 1); setMessage('ENERGY CELL // +15 INTEGRITY', 900);
      } else if (pickup.life <= 0) pickups.splice(i, 1);
    }
    if (messageTimer > 0) {
      messageTimer -= dt * 1000;
      if (messageTimer <= 0) $('gameMessage').textContent = '';
    }
    updateHud();
    if (player.health <= 0) showGameOver();
  }

  function loop(time) {
    if (state !== 'playing') return;
    const dt = Math.min((time - lastFrame) / 1000, .04);
    lastFrame = time; update(dt); draw();
    if (state === 'playing') requestAnimationFrame(loop);
  }

  function eventPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  canvas.addEventListener('pointermove', (event) => { aim = eventPosition(event); });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointerDown = true; aim = eventPosition(event); canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', () => { pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { pointerDown = false; });
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright', ' '].includes(key)) event.preventDefault();
    keys.add(key);
    if (key === ' ' && !event.repeat) shieldPulse();
    if (key === 'q' && !event.repeat) selectRing(-1);
    if (key === 'e' && !event.repeat) selectRing(1);
    if (key === 'enter' && state !== 'playing' && !authDialog.open) startGame();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); pointerDown = false; });
  launchButton.addEventListener('click', startGame);
  $('previousRing').addEventListener('click', () => selectRing(-1));
  $('nextRing').addEventListener('click', () => selectRing(1));
  $('pulseButton').addEventListener('click', shieldPulse);
  window.addEventListener('resize', resize);

  function openAuth(mode = 'register') {
    authMode = mode;
    $('authTitle').innerHTML = mode === 'register' ? 'JOIN THE<br><em>DEFENDERS.</em>' : 'WELCOME<br><em>BACK.</em>';
    $('authCopy').textContent = mode === 'register'
      ? 'Create your callsign. Your field record will follow you from here on out.'
      : 'Your sector is waiting. Sign in to retrieve your field record.';
    $('authSubmitText').textContent = mode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN';
    $('authSwitch').innerHTML = mode === 'register' ? 'ALREADY ENLISTED? <span>SIGN IN</span>' : 'NEW TO THE FRONTIER? <span>CREATE ACCOUNT</span>';
    $('authError').textContent = ''; $('password').value = '';
    authDialog.showModal();
  }
  $('accountButton').addEventListener('click', () => user ? logout() : openAuth('register'));
  $('pilotAction').addEventListener('click', () => user ? logout() : openAuth('register'));
  $('closeDialog').addEventListener('click', () => authDialog.close());
  authDialog.addEventListener('click', (event) => { if (event.target === authDialog) authDialog.close(); });
  $('authSwitch').addEventListener('click', () => openAuth(authMode === 'register' ? 'login' : 'register'));

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('authSubmit');
    const originalText = $('authSubmitText').textContent;
    $('authError').textContent = ''; $('authSubmitText').textContent = 'CONNECTING...'; submit.disabled = true;
    try {
      const response = await fetch(`/api/${authMode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not connect. Try again.');
      user = data.user; authDialog.close(); updatePilot(); loadLeaderboard();
      setMessage(`WELCOME TO THE FRONTIER, ${user.username.toUpperCase()}`, 1800);
    } catch (error) {
      $('authError').textContent = error.message;
    } finally {
      $('authSubmitText').textContent = originalText; submit.disabled = false;
    }
  });

  async function logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    user = null; updatePilot(); loadLeaderboard(); setMessage('SIGNED OUT // FIELD RECORD SECURED', 1300);
  }

  function updatePilot() {
    $('pilotName').textContent = user ? user.username.toUpperCase() : 'UNASSIGNED';
    $('pilotRank').textContent = user ? 'FRONTIER DEFENDER / ACTIVE' : 'CREATE A CALLSIGN TO ENLIST';
    $('agentId').textContent = user ? String(user.id % 10) : '0';
    $('bestScore').textContent = user ? Number(user.best_score).toLocaleString().padStart(6, '0') : '------';
    $('bestWave').textContent = user ? String(user.best_wave).padStart(2, '0') : '--';
    $('accountButton').innerHTML = user ? 'SIGN OUT <span>↗</span>' : 'SIGN IN <span>↗</span>';
    $('pilotAction').textContent = user ? 'SIGN OUT ↗' : 'ENLIST ↗';
  }

  async function loadLeaderboard() {
    try {
      const response = await fetch('/api/leaderboard');
      if (!response.ok) return;
      const { players } = await response.json();
      const board = $('leaderboard');
      if (!players.length) {
        board.innerHTML = '<div class="roster-empty"><span>✳</span> ROSTER AWAITING FIRST DEPLOYMENT</div>';
        return;
      }
      board.innerHTML = players.map((entry, index) =>
        `<div class="roster-row"><span class="roster-rank">${String(index + 1).padStart(2, '0')}</span><span class="roster-name">${escapeHtml(entry.username.toUpperCase())}</span><span class="roster-score">${Number(entry.best_score).toLocaleString()}</span></div>`,
      ).join('');
    } catch {}
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  async function restoreSession() {
    try {
      const response = await fetch('/api/me');
      if (response.ok) { const data = await response.json(); user = data.user; updatePilot(); }
    } catch {}
  }

  $('refreshLeaderboard').addEventListener('click', loadLeaderboard);
  $('deployments').textContent = String(deployments).padStart(2, '0');
  updateAvatarSelection(); resize(); loadLeaderboard(); restoreSession();
})();
