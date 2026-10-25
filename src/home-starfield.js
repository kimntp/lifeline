export function createHomeStarfield(canvas, { onActivityChange = () => {} } = {}) {
  const context = canvas.getContext("2d");
  if (!context) return { setActive() { onActivityChange(false); }, setWarp() {} };

  const page = canvas.ownerDocument;
  const view = page.defaultView;
  const reducedMotion = view.matchMedia("(prefers-reduced-motion: reduce)");
  const random = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const layers = [
    { density: 7000, minimum: 24, maximum: 240, radius: [0.5, 1], parallax: 4, speed: 0.5, stars: [] },
    { density: 38000, minimum: 8, maximum: 65, radius: [1, 1.5], parallax: 10, speed: 1, stars: [] },
    { density: 180000, minimum: 3, maximum: 12, radius: [1.5, 2.5], parallax: 18, speed: 1.6, stars: [] },
  ];

  function createGlow(size, stops) {
    const sprite = page.createElement("canvas");
    sprite.width = sprite.height = size;
    const spriteContext = sprite.getContext("2d");
    const center = size / 2;
    const gradient = spriteContext.createRadialGradient(center, center, 0, center, center, center);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    spriteContext.fillStyle = gradient;
    spriteContext.fillRect(0, 0, size, size);
    return sprite;
  }

  const glow = createGlow(48, [
    [0, "rgba(249, 242, 255, 1)"], [0.15, "rgba(198, 166, 255, 0.6)"], [1, "rgba(151, 91, 230, 0)"],
  ]);

  let active = false;
  let frame = null;
  let previousTime = null;
  let elapsed = 0;
  let nextShootingStar = 0;
  let width = 0;
  let height = 0;
  let pointer = null;
  let trackingPointer = false;
  let shootingStars = [];
  let warping = false;
  let warpElapsed = 0;

  function resize() {
    width = Math.max(1, view.innerWidth);
    height = Math.max(1, view.innerHeight);
    const pixelRatio = Math.min(view.devicePixelRatio || 1, 1.5, Math.sqrt(4000000 / (width * height)));
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    for (const [depth, layer] of layers.entries()) {
      layer.offsetX = layer.offsetY = 0;
      const count = Math.min(layer.maximum, Math.max(layer.minimum, Math.round(width * height / layer.density)));
      layer.stars = Array.from({ length: count }, () => {
        const tint = Math.random();
        return {
          x: Math.random(), y: Math.random(), radius: random(...layer.radius),
          color: tint < 0.08 ? "#bd8bfa" : tint < 0.5 ? "#e0d5ff" : "#fffaff",
          brightness: random(0.5 + depth * 0.12, 0.8 + depth * 0.1),
          phase: random(0, Math.PI * 2), period: random(2, 6),
          flarePeriod: random(7, 13), flareSize: random(5, 9),
          speedX: random(-0.6, 0.6) * layer.speed, speedY: random(0.5, 1.4) * layer.speed,
          highlight: 0,
        };
      });
    }
    shootingStars = [];
    draw(0);
  }

  function drawSparkle(positionX, positionY, span, color, opacity) {
    context.globalAlpha = opacity;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(positionX, positionY - span);
    context.lineTo(positionX + 0.7, positionY - 0.7);
    context.lineTo(positionX + span, positionY);
    context.lineTo(positionX + 0.7, positionY + 0.7);
    context.lineTo(positionX, positionY + span);
    context.lineTo(positionX - 0.7, positionY + 0.7);
    context.lineTo(positionX - span, positionY);
    context.lineTo(positionX - 0.7, positionY - 0.7);
    context.closePath();
    context.fill();
  }

  function drawTrail(tailX, tailY, headX, headY, opacity, thickness = 1.3) {
    const trail = context.createLinearGradient(tailX, tailY, headX, headY);
    trail.addColorStop(0, "rgba(174, 128, 245, 0)");
    trail.addColorStop(0.8, "rgba(214, 187, 255, 0.4)");
    trail.addColorStop(1, "rgba(255, 249, 255, 1)");
    context.globalAlpha = opacity;
    context.strokeStyle = trail;
    context.lineWidth = thickness;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(tailX, tailY);
    context.lineTo(headX, headY);
    context.stroke();
  }

  function draw(delta) {
    const moving = !reducedMotion.matches;
    const warp = warping ? Math.min(1, warpElapsed / 0.8) : 0;
    context.clearRect(0, 0, width, height);

    for (const [depth, layer] of layers.entries()) {
      const targetX = moving && pointer && !warping ? (pointer.x / width - 0.5) * 2 * layer.parallax : 0;
      const targetY = moving && pointer && !warping ? (pointer.y / height - 0.5) * 2 * layer.parallax : 0;
      const easing = 1 - Math.exp(-delta * 4);
      layer.offsetX += (targetX - layer.offsetX) * easing;
      layer.offsetY += (targetY - layer.offsetY) * easing;
      for (const star of layer.stars) {
        if (moving) {
          star.x = (star.x + star.speedX * delta / (width + 48) + 1) % 1;
          star.y = (star.y + star.speedY * delta / (height + 48)) % 1;
        }
        let positionX = star.x * (width + 48) - 24 + layer.offsetX;
        let positionY = star.y * (height + 48) - 24 + layer.offsetY;
        const distance = pointer ? Math.hypot(positionX - pointer.x, positionY - pointer.y) : Infinity;
        const highlight = moving && !warping ? Math.max(0, 1 - distance / 130) : 0;
        star.highlight += (highlight - star.highlight) * (1 - Math.exp(-delta * 7));
        const twinkle = moving ? 0.82 + 0.18 * Math.sin(elapsed * Math.PI * 2 / star.period + star.phase) : 1;
        const brightness = Math.min(1, star.brightness * twinkle + star.highlight * 0.5);
        if (warp > 0) {
          const vectorX = positionX - width / 2;
          const vectorY = positionY - height / 2;
          const distanceFromCenter = Math.max(1, Math.hypot(vectorX, vectorY));
          const acceleration = warp * warp * (1.4 + depth * 0.5);
          positionX += vectorX * acceleration;
          positionY += vectorY * acceleration;
          const streak = Math.min((8 + warp * warp * 145) * (0.5 + depth * 0.25),
            distanceFromCenter * (1 + acceleration) * 0.8);
          drawTrail(positionX - vectorX / distanceFromCenter * streak,
            positionY - vectorY / distanceFromCenter * streak, positionX, positionY, brightness * warp);
        }
        const glowSize = star.radius * (8 + depth * 3 + star.highlight * 14);
        context.globalAlpha = brightness * (0.45 + star.highlight * 0.55);
        context.drawImage(glow, positionX - glowSize / 2, positionY - glowSize / 2, glowSize, glowSize);
        context.globalAlpha = brightness;
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(positionX, positionY, star.radius * (1 + star.highlight * 0.75), 0, Math.PI * 2);
        context.fill();
        if (depth === 2 && moving && !warping) {
          const flare = Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2 / star.flarePeriod + star.phase)), 18);
          if (flare > 0.03) drawSparkle(positionX, positionY, star.flareSize, star.color, flare * 0.85);
        }
      }
    }

    for (const shootingStar of shootingStars) {
      shootingStar.age += delta;
      const headX = shootingStar.x + shootingStar.velocityX * shootingStar.age;
      const headY = shootingStar.y + shootingStar.velocityY * shootingStar.age;
      const opacity = Math.max(0, Math.sin(Math.PI * shootingStar.age / shootingStar.lifetime)) * 0.65;
      context.shadowColor = "#bd8bfa";
      context.shadowBlur = 7;
      drawTrail(headX - Math.cos(shootingStar.angle) * shootingStar.length,
        headY - Math.sin(shootingStar.angle) * shootingStar.length, headX, headY, opacity);
      context.shadowBlur = 0;
      context.globalAlpha = opacity;
      context.drawImage(glow, headX - 5, headY - 5, 10, 10);
    }
    shootingStars = shootingStars.filter(shootingStar => shootingStar.age < shootingStar.lifetime);
    context.globalAlpha = 1;
  }

  function tick(timestamp) {
    frame = null;
    if (!active || page.hidden || reducedMotion.matches) return;
    if (previousTime === null || timestamp - previousTime >= 1000 / 30) {
      const delta = previousTime === null ? 0 : Math.min((timestamp - previousTime) / 1000, 0.1);
      previousTime = timestamp;
      elapsed += delta;
      if (warping) warpElapsed += delta;
      if (!warping && elapsed >= nextShootingStar) {
        const angle = random(0.35, 0.7);
        const speed = random(400, 650);
        shootingStars.push({
          x: random(0, width * 0.75), y: random(0, height * 0.45),
          angle, velocityX: Math.cos(angle) * speed, velocityY: Math.sin(angle) * speed,
          length: random(65, 115), age: 0, lifetime: random(0.7, 1.3),
        });
        nextShootingStar = elapsed + random(6, 14);
      }
      draw(delta);
    }
    frame = view.requestAnimationFrame(tick);
  }

  function movePointer(event) {
    if (event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
  }

  function clearPointer(event) {
    if (event?.type === "pointerout" && event.relatedTarget) return;
    pointer = null;
  }

  function trackPointer(enabled) {
    if (trackingPointer === enabled) return;
    trackingPointer = enabled;
    if (enabled) {
      view.addEventListener("pointermove", movePointer, { passive: true });
      view.addEventListener("pointerout", clearPointer);
      view.addEventListener("blur", clearPointer);
    } else {
      view.removeEventListener("pointermove", movePointer);
      view.removeEventListener("pointerout", clearPointer);
      view.removeEventListener("blur", clearPointer);
      clearPointer();
    }
  }

  function synchronize() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    shootingStars = [];
    nextShootingStar = elapsed + random(6, 14);
    const animate = active && !page.hidden && !reducedMotion.matches;
    trackPointer(animate && !warping);
    onActivityChange(animate);
    if (!active || page.hidden) return;
    if (animate) frame = view.requestAnimationFrame(tick);
    else {
      warping = false;
      for (const layer of layers) {
        layer.offsetX = layer.offsetY = 0;
        for (const star of layer.stars) star.highlight = 0;
      }
      draw(0);
    }
  }

  return {
    setWarp(value) {
      warping = value && active && !reducedMotion.matches;
      warpElapsed = 0;
      shootingStars = [];
      trackPointer(active && !page.hidden && !reducedMotion.matches && !warping);
    },
    setActive(value) {
      if (active === value) return;
      active = value;
      if (active) {
        resize();
        view.addEventListener("resize", resize);
        page.addEventListener("visibilitychange", synchronize);
        reducedMotion.addEventListener("change", synchronize);
      } else {
        view.removeEventListener("resize", resize);
        page.removeEventListener("visibilitychange", synchronize);
        reducedMotion.removeEventListener("change", synchronize);
        warping = false;
      }
      synchronize();
      if (!active) {
        for (const layer of layers) layer.stars = [];
        canvas.width = canvas.height = 0;
      }
    },
  };
}
