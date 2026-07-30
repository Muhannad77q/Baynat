export const AD_DURATION = 18_000;

export const TIMELINE = [
  { id: "intro", label: "الافتتاح", start: 0, end: 2_800 },
  { id: "ingredients", label: "المكونات", start: 2_800, end: 5_900 },
  { id: "assembly", label: "التركيب", start: 5_900, end: 14_500 },
  { id: "serving", label: "التقديم", start: 14_500, end: AD_DURATION },
];

export const INGREDIENTS = [
  { name: "كريمة فانيلا", detail: "خفيفة ومخملية", icon: "cream", accent: "#fff0d8" },
  { name: "قلب فراولة", detail: "لامع ومليان نكهة", icon: "glaze", accent: "#ff4052" },
  { name: "فراولة كاملة", detail: "لمسة حلوة ومنعشة", icon: "strawberry", accent: "#ed4050" },
  { name: "توت أزرق", detail: "حبات صغيرة.. فرق كبير", icon: "berries", accent: "#5c526f" },
  { name: "شوكولاتة", detail: "مقرمشة وغنية", icon: "chocolate", accent: "#8f4c2d" },
];

const WIDTH = 1080;
const HEIGHT = 1920;
const FONT_ARABIC = '"Noto Sans Arabic", "Noto Kufi Arabic", Tahoma, Arial, sans-serif';
const FONT_DISPLAY = '"Noto Kufi Arabic", "Noto Sans Arabic", Tahoma, Arial, sans-serif';

const COLORS = {
  ink: "#fff9f1",
  cream: "#fff0d9",
  muted: "#c9b6a6",
  cocoa: "#190b08",
  cocoaLight: "#472019",
  red: "#e92d40",
  redBright: "#ff4558",
  gold: "#f1c16b",
  berry: "#4c405d",
};

const BLUEBERRIES = [
  [-185, -46, 17], [-145, -78, 14], [-93, -82, 17], [-35, -88, 14], [27, -76, 16],
  [87, -67, 13], [142, -42, 17], [184, -11, 13], [173, 31, 17], [132, 58, 14],
  [78, 71, 17], [18, 82, 14], [-47, 76, 16], [-104, 66, 13], [-158, 39, 17],
  [-186, 4, 13], [-124, -21, 12], [-71, 16, 15], [-23, -45, 12], [40, 7, 14],
  [96, -15, 12], [112, 30, 11], [54, 51, 12], [-20, 48, 11], [-89, 40, 12],
];

const STRAWBERRIES = [
  [-112, -18, 0.95], [-24, -45, 1.04], [75, -25, 0.92], [-54, 39, 1.08], [64, 39, 0.95],
];

const WAFERS = [
  [-250, -48, -0.2], [-190, -98, 0.46], [205, -82, -0.48], [263, -25, 0.16],
  [240, 57, 0.12], [170, 100, 0.62], [-174, 103, -0.62], [-250, 52, -0.08],
];

const TRUFFLES = [
  [-292, -12, "gold"], [-205, -105, "dark"], [2, -126, "dark"], [210, -101, "gold"],
  [298, -3, "gold"], [210, 91, "dark"], [3, 126, "gold"], [-215, 87, "dark"],
];

export function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function progressBetween(time, start, end) {
  if (end <= start) return time >= end ? 1 : 0;
  return clamp((time - start) / (end - start));
}

export function sceneAt(time) {
  const normalized = ((time % AD_DURATION) + AD_DURATION) % AD_DURATION;
  return TIMELINE.find((scene) => normalized >= scene.start && normalized < scene.end) ?? TIMELINE[0];
}

export function easeOutCubic(value) {
  return 1 - (1 - clamp(value)) ** 3;
}

export function easeInOutCubic(value) {
  const p = clamp(value);
  return p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2;
}

export function easeOutBack(value) {
  const p = clamp(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function seed(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function pathRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, width, height, radius, fill) {
  pathRoundRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, width, height, radius, stroke, lineWidth = 1) {
  pathRoundRect(ctx, x, y, width, height, radius);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawText(
  ctx,
  value,
  x,
  y,
  size,
  color = COLORS.ink,
  weight = 700,
  align = "right",
  alpha = 1,
  family = FONT_ARABIC,
) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.direction = "rtl";
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
  ctx.restore();
}

function drawLabel(ctx, value, x, y, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  fillRoundRect(ctx, x - 220, y - 47, 220, 60, 30, "rgba(255,240,220,0.07)");
  strokeRoundRect(ctx, x - 220, y - 47, 220, 60, 30, "rgba(255,240,220,0.14)", 2);
  ctx.beginPath();
  ctx.arc(x - 191, y - 17, 6, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.redBright;
  ctx.fill();
  drawText(ctx, value, x - 28, y - 2, 24, COLORS.cream, 800, "right", 1, FONT_DISPLAY);
  ctx.restore();
}

function drawBackground(ctx, time) {
  const t = time / AD_DURATION;
  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  base.addColorStop(0, "#110604");
  base.addColorStop(0.43, "#24100c");
  base.addColorStop(1, "#0d0504");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const redGlow = ctx.createRadialGradient(
    790 + Math.sin(t * Math.PI * 2) * 110,
    540,
    20,
    790,
    540,
    720,
  );
  redGlow.addColorStop(0, "rgba(201,35,52,0.25)");
  redGlow.addColorStop(0.45, "rgba(139,23,33,0.1)");
  redGlow.addColorStop(1, "rgba(80,10,15,0)");
  ctx.fillStyle = redGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const goldGlow = ctx.createRadialGradient(80, 1560, 20, 80, 1560, 760);
  goldGlow.addColorStop(0, "rgba(242,194,107,0.12)");
  goldGlow.addColorStop(1, "rgba(242,194,107,0)");
  ctx.fillStyle = goldGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 42; index += 1) {
    const x = seed(index) * WIDTH;
    const drift = (time * (0.008 + seed(index + 10) * 0.018)) % (HEIGHT + 160);
    const y = (seed(index + 20) * HEIGHT + drift) % (HEIGHT + 160) - 80;
    const radius = 1.1 + seed(index + 30) * 2.4;
    ctx.globalAlpha = 0.05 + seed(index + 40) * 0.13;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = index % 4 === 0 ? COLORS.gold : COLORS.cream;
    ctx.fill();
  }
  ctx.restore();

  const vignette = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 480, WIDTH / 2, HEIGHT / 2, 1_180);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawPersistentBrand(ctx, time) {
  const breathe = 0.92 + Math.sin(time / 900) * 0.08;
  ctx.save();
  fillRoundRect(ctx, 756, 68, 254, 92, 46, "rgba(255,247,235,0.055)");
  strokeRoundRect(ctx, 756, 68, 254, 92, 46, "rgba(255,240,220,0.14)", 2);

  ctx.beginPath();
  ctx.arc(806, 114, 30, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(242,194,107,0.12)";
  ctx.fill();
  ctx.strokeStyle = `rgba(242,194,107,${0.28 * breathe})`;
  ctx.lineWidth = 2;
  ctx.stroke();
  drawText(ctx, "ل", 806, 130, 42, COLORS.gold, 700, "center", 1, '"Noto Naskh Arabic", serif');
  drawText(ctx, "لَذَّة", 970, 130, 35, COLORS.ink, 900, "right", 1, FONT_DISPLAY);

  drawText(ctx, "FILM  /  18 SEC", 70, 126, 20, "#a78c79", 700, "left", 1, "Arial, sans-serif");
  ctx.restore();
}

function sceneFade(time, start, end, fadeIn = 450, fadeOut = 500) {
  return Math.min(progressBetween(time, start, start + fadeIn), 1 - progressBetween(time, end - fadeOut, end));
}

function drawIntro(ctx, time) {
  const alpha = sceneFade(time, 0, 3_250, 350, 600);
  if (alpha <= 0) return;

  const first = easeOutCubic(progressBetween(time, 160, 1_050));
  const second = easeOutCubic(progressBetween(time, 620, 1_500));
  const third = easeOutBack(progressBetween(time, 1_250, 2_180));

  ctx.save();
  ctx.globalAlpha *= alpha;
  drawLabel(ctx, "كيكة الفراولة", 938, 318, first);
  drawText(ctx, "مو كل كيكة", 938, lerp(600, 548, first), 108, COLORS.ink, 900, "right", first);
  drawText(ctx, "تِنْسى.", 938, lerp(740, 687, second), 146, COLORS.ink, 900, "right", second);
  drawText(ctx, "هذي تنحفظ.", 938, lerp(910, 840, third), 83, COLORS.redBright, 900, "right", third);

  const lineProgress = easeInOutCubic(progressBetween(time, 1_600, 2_350));
  ctx.fillStyle = COLORS.gold;
  ctx.globalAlpha *= 0.8;
  ctx.fillRect(938 - 360 * lineProgress, 910, 360 * lineProgress, 3);
  drawText(ctx, "طبقات تنبني بلقطة.. وذكرى تبقى.", 938, 978, 30, COLORS.muted, 500, "right", lineProgress);

  ctx.save();
  ctx.globalAlpha = 0.14 * progressBetween(time, 900, 2_100);
  ctx.filter = "blur(3px)";
  drawCake(ctx, 540, 1_465, 1.28, 1, time, 1);
  ctx.restore();
  ctx.restore();
}

function drawCreamIcon(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const gradient = ctx.createRadialGradient(-13, -18, 4, 0, 0, 56);
  gradient.addColorStop(0, "#fffdf7");
  gradient.addColorStop(0.6, "#fff0d8");
  gradient.addColorStop(1, "#dbbda0");
  ctx.fillStyle = gradient;
  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(angle) * 21, Math.sin(angle) * 15, 24, 18, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, -6, 25, 0, Math.PI * 2);
  ctx.fillStyle = "#fff9ec";
  ctx.fill();
  ctx.restore();
}

function drawGlazeIcon(ctx, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const gradient = ctx.createLinearGradient(-30, -45, 30, 45);
  gradient.addColorStop(0, "#ff6a78");
  gradient.addColorStop(0.5, "#ed2e42");
  gradient.addColorStop(1, "#a90f27");
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.bezierCurveTo(14, -25, 41, 2, 41, 22);
  ctx.bezierCurveTo(41, 50, 22, 65, 0, 65);
  ctx.bezierCurveTo(-23, 65, -42, 50, -42, 22);
  ctx.bezierCurveTo(-42, 2, -14, -25, 0, -52);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-12, 8, 8, 17, -0.55, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.33)";
  ctx.fill();
  ctx.restore();
}

function drawBerry(ctx, x, y, radius, color = "blue", alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  const highlight = color === "blue" ? "#81738d" : "#ff6e78";
  const mid = color === "blue" ? "#4e425f" : "#dc2d40";
  const dark = color === "blue" ? "#261f35" : "#8f1024";
  const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.42, 1, x, y, radius);
  gradient.addColorStop(0, highlight);
  gradient.addColorStop(0.4, mid);
  gradient.addColorStop(1, dark);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  if (color === "blue") {
    ctx.strokeStyle = "rgba(225,211,230,0.35)";
    ctx.lineWidth = Math.max(1, radius * 0.12);
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(x, y - radius * 0.34);
      ctx.lineTo(x + Math.cos(angle) * radius * 0.31, y - radius * 0.5 + Math.sin(angle) * radius * 0.18);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawStrawberry(ctx, x, y, scale = 1, rotation = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  const gradient = ctx.createRadialGradient(-18, -25, 5, 0, 0, 63);
  gradient.addColorStop(0, "#ff7880");
  gradient.addColorStop(0.46, "#e63748");
  gradient.addColorStop(1, "#9d1228");
  ctx.beginPath();
  ctx.moveTo(0, 66);
  ctx.bezierCurveTo(-29, 49, -54, 19, -50, -17);
  ctx.bezierCurveTo(-45, -52, -17, -62, 0, -42);
  ctx.bezierCurveTo(17, -62, 45, -52, 50, -17);
  ctx.bezierCurveTo(54, 19, 29, 49, 0, 66);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.fillStyle = "rgba(255,225,190,0.75)";
  for (let index = 0; index < 13; index += 1) {
    const sx = (seed(index + 120) - 0.5) * 72;
    const sy = -25 + seed(index + 160) * 67;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2.1, 4.3, sx / 80, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#294b2c";
  for (let index = 0; index < 5; index += 1) {
    const angle = (index / 5) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, -40);
    ctx.lineTo(Math.cos(angle) * 28, -43 + Math.sin(angle) * 13);
    ctx.lineTo(Math.cos(angle + 0.45) * 13, -34 + Math.sin(angle + 0.45) * 8);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawChocolateBar(ctx, x, y, scale = 1, rotation = 0, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  fillRoundRect(ctx, -55, -24, 110, 48, 12, "#6e321f");
  strokeRoundRect(ctx, -55, -24, 110, 48, 12, "rgba(255,225,190,0.18)", 2);
  ctx.fillStyle = "#d2ae85";
  for (let offset = -41; offset <= 41; offset += 20.5) {
    fillRoundRect(ctx, offset, -24, 7, 48, 3, "#d9b793");
    fillRoundRect(ctx, offset + 7, -24, 5, 48, 2, "#9b6446");
  }
  ctx.restore();
}

function drawIngredientIcon(ctx, icon, x, y) {
  if (icon === "cream") drawCreamIcon(ctx, x, y, 0.82);
  if (icon === "glaze") drawGlazeIcon(ctx, x, y, 0.75);
  if (icon === "strawberry") drawStrawberry(ctx, x, y + 2, 0.64, -0.08);
  if (icon === "berries") {
    drawBerry(ctx, x - 24, y + 13, 24);
    drawBerry(ctx, x + 15, y + 17, 27);
    drawBerry(ctx, x + 2, y - 22, 25);
  }
  if (icon === "chocolate") drawChocolateBar(ctx, x, y, 0.82, -0.18);
}

function drawIngredientCard(ctx, ingredient, index, time) {
  const starts = [2_680, 2_980, 3_280, 3_580, 3_940];
  const progress = easeOutBack(progressBetween(time, starts[index], starts[index] + 750));
  const fadeOut = 1 - progressBetween(time, 5_450, 6_050);
  const alpha = clamp(progress * fadeOut);
  if (alpha <= 0) return;

  const positions = [
    [560, 450], [90, 450], [560, 710], [90, 710], [325, 970],
  ];
  const [targetX, targetY] = positions[index];
  const side = index % 2 === 0 ? 1 : -1;
  const x = targetX + side * (1 - progress) * 240;
  const y = targetY + (1 - progress) * 40;
  const width = 430;
  const height = 214;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = "rgba(0,0,0,0.2)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  fillRoundRect(ctx, x, y, width, height, 34, "rgba(255,244,230,0.065)");
  ctx.shadowColor = "transparent";
  strokeRoundRect(ctx, x, y, width, height, 34, "rgba(255,239,218,0.14)", 2);

  const iconGradient = ctx.createRadialGradient(x + 78, y + 104, 4, x + 78, y + 104, 72);
  iconGradient.addColorStop(0, `${ingredient.accent}33`);
  iconGradient.addColorStop(1, "rgba(255,255,255,0.025)");
  ctx.beginPath();
  ctx.arc(x + 83, y + 107, 67, 0, Math.PI * 2);
  ctx.fillStyle = iconGradient;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,240,220,0.1)";
  ctx.lineWidth = 2;
  ctx.stroke();
  drawIngredientIcon(ctx, ingredient.icon, x + 83, y + 107);

  drawText(ctx, ingredient.name, x + width - 34, y + 91, 35, COLORS.ink, 900, "right", 1, FONT_DISPLAY);
  drawText(ctx, ingredient.detail, x + width - 34, y + 139, 23, COLORS.muted, 500, "right");
  drawText(ctx, String(index + 1).padStart(2, "0"), x + width - 35, y + 178, 17, ingredient.accent, 800, "right", 1, "Arial, sans-serif");
  ctx.restore();
}

function drawIngredientsScene(ctx, time) {
  const alpha = sceneFade(time, 2_450, 6_250, 400, 700);
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha *= alpha;
  const heading = easeOutCubic(progressBetween(time, 2_420, 3_050));
  drawLabel(ctx, "المكونات", 938, 265, heading);
  drawText(ctx, "خمسة أبطال.", 938, lerp(410, 375, heading), 72, COLORS.ink, 900, "right", heading);
  drawText(ctx, "ونهاية وحدة ما تنقاوم.", 938, 1_310, 40, COLORS.gold, 800, "right", progressBetween(time, 4_150, 4_850));
  drawText(ctx, "كل مكوّن يدخل في توقيته.", 938, 1_370, 26, COLORS.muted, 500, "right", progressBetween(time, 4_350, 5_050));
  ctx.restore();

  INGREDIENTS.forEach((ingredient, index) => drawIngredientCard(ctx, ingredient, index, time));
}

function drawEllipse(ctx, x, y, radiusX, radiusY, fill, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function drawCakeSide(ctx, frostingProgress) {
  const spongeGradient = ctx.createLinearGradient(-360, 0, 360, 220);
  spongeGradient.addColorStop(0, "#8c4e2f");
  spongeGradient.addColorStop(0.3, "#d8995f");
  spongeGradient.addColorStop(0.72, "#b86c42");
  spongeGradient.addColorStop(1, "#66311f");

  ctx.beginPath();
  ctx.moveTo(-355, 0);
  ctx.bezierCurveTo(-355, 72, -330, 198, 0, 222);
  ctx.bezierCurveTo(330, 198, 355, 72, 355, 0);
  ctx.bezierCurveTo(280, 116, -280, 116, -355, 0);
  ctx.closePath();
  ctx.fillStyle = spongeGradient;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha *= frostingProgress;
  const frostingGradient = ctx.createLinearGradient(-360, 0, 360, 230);
  frostingGradient.addColorStop(0, "#e7cbb4");
  frostingGradient.addColorStop(0.25, "#fff8ea");
  frostingGradient.addColorStop(0.68, "#f4e0ca");
  frostingGradient.addColorStop(1, "#cba98f");
  ctx.fillStyle = frostingGradient;
  ctx.fill();

  for (let index = 0; index < 17; index += 1) {
    const angle = Math.PI * 0.06 + (index / 16) * Math.PI * 0.88;
    const x = Math.cos(angle) * 337;
    const y = 177 + Math.sin(angle) * 50;
    drawEllipse(ctx, x, y, 22, 12, index % 2 ? "#3f1b13" : "#572318", 0.92);
  }
  ctx.restore();
}

function drawPowder(ctx, centerX, centerY, radiusX, radiusY, count, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (let index = 0; index < count; index += 1) {
    const angle = seed(index + 740) * Math.PI * 2;
    const distance = Math.sqrt(seed(index + 840));
    const x = centerX + Math.cos(angle) * radiusX * distance;
    const y = centerY + Math.sin(angle) * radiusY * distance;
    const radius = 0.8 + seed(index + 940) * 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,241,220,0.72)";
    ctx.fill();
  }
  ctx.restore();
}

function drawFrostedStrawberry(ctx, x, y, scale, alpha = 1, rotation = 0) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale * 0.72);
  const gradient = ctx.createRadialGradient(-18, -21, 2, 0, 0, 60);
  gradient.addColorStop(0, "#ff7580");
  gradient.addColorStop(0.5, "#dc3343");
  gradient.addColorStop(1, "#8e1528");
  ctx.beginPath();
  ctx.arc(0, 0, 53, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  drawPowder(ctx, 0, 0, 48, 48, 35, 0.65);
  ctx.restore();
}

function drawCreamRosette(ctx, x, y, scale = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale * 0.7);
  const gradient = ctx.createRadialGradient(-7, -8, 2, 0, 0, 50);
  gradient.addColorStop(0, "#fffdf7");
  gradient.addColorStop(0.6, "#f8ead8");
  gradient.addColorStop(1, "#c9a98e");
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(Math.cos(angle) * 20, Math.sin(angle) * 15, 23, 17, angle, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
  ctx.restore();
}

function drawTruffle(ctx, x, y, scale, type, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  drawCreamRosette(ctx, x, y + 18 * scale, 0.92 * scale, 1);
  const palette = type === "gold"
    ? ["#fff0b1", "#e5b95d", "#8f5c26"]
    : ["#9a6747", "#5a2d20", "#25100d"];
  const radius = 38 * scale;
  const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.46, 2, x, y, radius);
  gradient.addColorStop(0, palette[0]);
  gradient.addColorStop(0.52, palette[1]);
  gradient.addColorStop(1, palette[2]);
  drawEllipse(ctx, x, y, radius, radius * 0.76, gradient, 1);
  drawEllipse(ctx, x - radius * 0.25, y - radius * 0.28, radius * 0.14, radius * 0.09, "rgba(255,255,255,0.42)", 1);
  ctx.restore();
}

function drawCake(ctx, centerX, centerY, scale, build, time, alpha = 1) {
  const p = clamp(build);
  if (p <= 0) return;

  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.translate(centerX, centerY);
  ctx.scale(scale, scale);

  const boardP = easeOutBack(progressBetween(p, 0, 0.14));
  const baseP = easeOutBack(progressBetween(p, 0.08, 0.29));
  const frostingP = easeOutCubic(progressBetween(p, 0.23, 0.43));
  const glazeP = easeOutBack(progressBetween(p, 0.38, 0.53));

  ctx.save();
  ctx.globalAlpha *= boardP;
  drawEllipse(ctx, 0, 238, 460, 148, "rgba(0,0,0,0.32)", 1);
  const boardGradient = ctx.createLinearGradient(-430, 90, 430, 240);
  boardGradient.addColorStop(0, "#8b5b34");
  boardGradient.addColorStop(0.42, "#d6aa65");
  boardGradient.addColorStop(0.72, "#b77e42");
  boardGradient.addColorStop(1, "#6c4028");
  drawEllipse(ctx, 0, 178, 428, 146, boardGradient, 1);
  drawEllipse(ctx, 0, 160, 414, 132, "#c69250", 0.55);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= clamp(baseP);
  ctx.translate(0, (1 - baseP) * 210);
  drawCakeSide(ctx, frostingP);

  const spongeTop = ctx.createRadialGradient(-90, -50, 25, 0, 0, 360);
  spongeTop.addColorStop(0, "#e4ae72");
  spongeTop.addColorStop(0.7, "#c77b49");
  spongeTop.addColorStop(1, "#7d3d27");
  drawEllipse(ctx, 0, 0, 355, 138, spongeTop, 1);

  ctx.save();
  ctx.globalAlpha *= frostingP;
  const topGradient = ctx.createRadialGradient(-90, -55, 20, 0, 0, 375);
  topGradient.addColorStop(0, "#fffefa");
  topGradient.addColorStop(0.62, "#fff1df");
  topGradient.addColorStop(1, "#d6b49a");
  drawEllipse(ctx, 0, -5, 358, 140, topGradient, 1);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha *= glazeP;
  ctx.translate(0, -10);
  ctx.scale(glazeP, glazeP);
  const glazeGradient = ctx.createRadialGradient(-55, -35, 8, 0, 0, 245);
  glazeGradient.addColorStop(0, "#ff6671");
  glazeGradient.addColorStop(0.48, "#ee263b");
  glazeGradient.addColorStop(1, "#a80e25");
  drawEllipse(ctx, 0, 0, 232, 92, glazeGradient, 1);
  drawEllipse(ctx, -55, -30, 85, 17, "rgba(255,255,255,0.18)", 0.8);
  ctx.restore();

  STRAWBERRIES.forEach(([x, y, itemScale], index) => {
    const itemP = easeOutBack(progressBetween(p, 0.5 + index * 0.018, 0.67 + index * 0.018));
    if (itemP <= 0) return;
    const startX = x + (index % 2 ? -310 : 320);
    const startY = y - 380 - index * 18;
    drawFrostedStrawberry(
      ctx,
      lerp(startX, x, itemP),
      lerp(startY, y, itemP),
      itemScale * itemP,
      itemP,
      (1 - itemP) * (index % 2 ? -1.8 : 1.6),
    );
  });

  BLUEBERRIES.forEach(([x, y, radius], index) => {
    const itemP = easeOutBack(progressBetween(p, 0.61 + index * 0.004, 0.74 + index * 0.004));
    if (itemP <= 0) return;
    const angle = seed(index + 500) * Math.PI * 2;
    const fromX = x + Math.cos(angle) * 380;
    const fromY = y - 290 - seed(index + 510) * 130;
    drawBerry(ctx, lerp(fromX, x, itemP), lerp(fromY, y, itemP), radius * itemP, "blue", itemP);
  });

  WAFERS.forEach(([x, y, rotation], index) => {
    const itemP = easeOutBack(progressBetween(p, 0.72 + index * 0.01, 0.84 + index * 0.01));
    if (itemP <= 0) return;
    const fromX = x * 1.75;
    const fromY = y - 330;
    drawChocolateBar(
      ctx,
      lerp(fromX, x, itemP),
      lerp(fromY, y, itemP),
      0.72 * itemP,
      rotation + (1 - itemP) * 2.4,
      itemP,
    );
  });

  const centerBarP = easeOutBack(progressBetween(p, 0.78, 0.91));
  drawChocolateBar(
    ctx,
    lerp(450, 65, centerBarP),
    lerp(-360, -55, centerBarP),
    1.1 * centerBarP,
    lerp(2.4, 0.12, centerBarP),
    centerBarP,
  );

  TRUFFLES.forEach(([x, y, type], index) => {
    const itemP = easeOutBack(progressBetween(p, 0.8 + index * 0.008, 0.91 + index * 0.008));
    if (itemP <= 0) return;
    drawTruffle(
      ctx,
      lerp(x * 1.55, x, itemP),
      lerp(y - 290, y, itemP),
      itemP,
      type,
      itemP,
    );
  });

  const powderP = progressBetween(p, 0.88, 0.98);
  drawPowder(ctx, 0, -8, 326, 117, 86, powderP * 0.62);
  ctx.restore();

  const shimmer = progressBetween(p, 0.92, 1);
  if (shimmer > 0) {
    ctx.save();
    ctx.globalAlpha *= shimmer;
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < 7; index += 1) {
      const angle = time / 900 + index * 1.7;
      const x = Math.cos(angle) * (355 + (index % 3) * 25);
      const y = Math.sin(angle) * (135 + (index % 2) * 22) - 15;
      const pulse = 0.55 + Math.sin(time / 180 + index) * 0.45;
      ctx.strokeStyle = `rgba(255,225,160,${0.72 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 11 * pulse, y);
      ctx.lineTo(x + 11 * pulse, y);
      ctx.moveTo(x, y - 11 * pulse);
      ctx.lineTo(x, y + 11 * pulse);
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawStepPills(ctx, build, alpha) {
  const steps = [
    ["١", "القاعدة", 0.08],
    ["٢", "الكريمة", 0.25],
    ["٣", "الفراولة", 0.42],
    ["٤", "اللمسة", 0.74],
  ];
  const width = 205;
  const gap = 18;
  const startX = 70;
  steps.forEach(([number, label, threshold], index) => {
    const active = build >= threshold;
    const x = startX + index * (width + gap);
    ctx.save();
    ctx.globalAlpha *= alpha * (active ? 1 : 0.42);
    fillRoundRect(ctx, x, 355, width, 72, 36, active ? "rgba(235,45,63,0.13)" : "rgba(255,255,255,0.035)");
    strokeRoundRect(
      ctx,
      x,
      355,
      width,
      72,
      36,
      active ? "rgba(255,81,96,0.3)" : "rgba(255,240,220,0.1)",
      2,
    );
    drawText(ctx, label, x + width - 28, 401, 23, active ? COLORS.ink : "#8c7768", 700, "right");
    drawText(ctx, number, x + 30, 401, 21, active ? COLORS.gold : "#745f52", 800, "left");
    ctx.restore();
  });
}

function drawAssemblyScene(ctx, time) {
  const alpha = sceneFade(time, 5_450, 14_850, 500, 700);
  if (alpha <= 0) return;

  const build = easeInOutCubic(progressBetween(time, 5_750, 11_350));
  const titleOut = 1 - progressBetween(time, 11_050, 11_850);
  const heroIn = easeOutCubic(progressBetween(time, 11_250, 12_150));

  ctx.save();
  ctx.globalAlpha *= alpha;
  drawLabel(ctx, "طريقة التركيب", 938, 260, titleOut);
  drawText(ctx, "كل طبقة.. في وقتها.", 938, 335, 57, COLORS.ink, 900, "right", titleOut);
  drawStepPills(ctx, build, titleOut);

  const cakeY = lerp(1_055, 940, heroIn);
  const cakeScale = lerp(1.06, 1.16, heroIn);
  drawCake(ctx, 540, cakeY, cakeScale, build, time, 1);

  drawText(ctx, "والنتيجة؟", 938, 285, 31, COLORS.gold, 800, "right", heroIn);
  drawText(ctx, "جاهزة تخطف", 938, 375, 70, COLORS.ink, 900, "right", heroIn);
  drawText(ctx, "كل النظرات.", 938, 465, 80, COLORS.redBright, 900, "right", heroIn);

  const captionIn = easeOutCubic(progressBetween(time, 11_650, 12_500));
  fillRoundRect(ctx, 100, 1_520, 880, 126, 63, `rgba(255,246,232,${0.055 * captionIn})`);
  strokeRoundRect(ctx, 100, 1_520, 880, 126, 63, `rgba(255,238,218,${0.13 * captionIn})`, 2);
  drawText(ctx, "فراولة حقيقية", 873, 1_595, 25, COLORS.cream, 700, "right", captionIn);
  drawText(ctx, "•", 725, 1_595, 23, COLORS.redBright, 900, "center", captionIn);
  drawText(ctx, "كريمة مخملية", 650, 1_595, 25, COLORS.cream, 700, "right", captionIn);
  drawText(ctx, "•", 465, 1_595, 23, COLORS.redBright, 900, "center", captionIn);
  drawText(ctx, "قرمشة شوكولاتة", 390, 1_595, 25, COLORS.cream, 700, "right", captionIn);
  ctx.restore();
}

function drawServingSlice(ctx, centerX, centerY, scale, progress, alpha = 1) {
  const p = easeOutBack(progress);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(centerX, centerY + (1 - p) * 160);
  ctx.scale(scale * p, scale * p);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = 45;
  ctx.shadowOffsetY = 26;
  drawEllipse(ctx, 0, 95, 360, 105, "#f4e3ce", 1);
  ctx.shadowColor = "transparent";
  drawEllipse(ctx, 0, 76, 330, 88, "#fffaf1", 1);
  drawEllipse(ctx, 0, 75, 294, 63, "rgba(212,184,157,0.22)", 1);
  ctx.restore();

  const sideGradient = ctx.createLinearGradient(-120, -40, 160, 130);
  sideGradient.addColorStop(0, "#9c5335");
  sideGradient.addColorStop(0.22, "#e5a66c");
  sideGradient.addColorStop(0.42, "#fff0d8");
  sideGradient.addColorStop(0.58, "#d85b5f");
  sideGradient.addColorStop(0.72, "#fff1d9");
  sideGradient.addColorStop(1, "#6d321f");

  ctx.beginPath();
  ctx.moveTo(-135, -18);
  ctx.lineTo(190, 14);
  ctx.lineTo(70, 145);
  ctx.lineTo(-135, 102);
  ctx.closePath();
  ctx.fillStyle = sideGradient;
  ctx.fill();

  const topGradient = ctx.createLinearGradient(-130, -88, 185, 45);
  topGradient.addColorStop(0, "#fffaf0");
  topGradient.addColorStop(0.52, "#f6dfc7");
  topGradient.addColorStop(1, "#caa083");
  ctx.beginPath();
  ctx.moveTo(-135, -18);
  ctx.lineTo(10, -115);
  ctx.lineTo(190, 14);
  ctx.lineTo(-8, 45);
  ctx.closePath();
  ctx.fillStyle = topGradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(-75, -28);
  ctx.lineTo(12, -83);
  ctx.lineTo(120, 1);
  ctx.lineTo(-2, 20);
  ctx.closePath();
  ctx.fillStyle = "#e8293e";
  ctx.fill();
  drawFrostedStrawberry(ctx, 9, -67, 0.55, 1, 0.08);
  drawBerry(ctx, 70, -25, 15, "blue", 1);

  ctx.save();
  ctx.translate(255, 15);
  ctx.rotate(-0.32);
  fillRoundRect(ctx, -14, -125, 28, 260, 14, "#d1b28e");
  fillRoundRect(ctx, -10, -116, 20, 245, 10, "#f0d9ba");
  ctx.restore();
  ctx.restore();
}

function drawServingScene(ctx, time) {
  const alpha = sceneFade(time, 14_150, 18_000, 550, 220);
  if (alpha <= 0) return;

  const intro = easeOutCubic(progressBetween(time, 14_300, 15_150));
  const plate = progressBetween(time, 14_900, 15_850);
  const footer = easeOutCubic(progressBetween(time, 15_650, 16_550));

  ctx.save();
  ctx.globalAlpha *= alpha;
  drawLabel(ctx, "التقديم المثالي", 938, 250, intro);
  drawText(ctx, "باردة.", 938, 395, 96, COLORS.ink, 900, "right", intro);
  drawText(ctx, "وبكل حُب.", 938, 505, 92, COLORS.redBright, 900, "right", intro);

  drawCake(ctx, 540, 755, 0.69, 1, time, Math.min(intro, 0.88));
  drawServingSlice(ctx, 540, 1_245, 0.92, plate, 1);

  drawText(ctx, "كل لقمة.. لقطة.", 540, 1_600, 54, COLORS.cream, 900, "center", footer);
  drawText(ctx, "قدّمها للي يستاهل اللحظة.", 540, 1_666, 27, COLORS.muted, 500, "center", footer);

  const ctaWidth = 470;
  fillRoundRect(ctx, (WIDTH - ctaWidth) / 2, 1_728, ctaWidth, 88, 44, `rgba(233,45,64,${0.92 * footer})`);
  drawText(ctx, "لَذَّة • لحظات تنأكل", WIDTH / 2, 1_786, 27, "#ffffff", 900, "center", footer, FONT_DISPLAY);
  ctx.restore();
}

function drawFrame(ctx, time) {
  const normalized = ((time % AD_DURATION) + AD_DURATION) % AD_DURATION;
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawBackground(ctx, normalized);
  drawPersistentBrand(ctx, normalized);
  drawIntro(ctx, normalized);
  drawIngredientsScene(ctx, normalized);
  drawAssemblyScene(ctx, normalized);
  drawServingScene(ctx, normalized);

  ctx.save();
  const edge = ctx.createLinearGradient(0, 0, WIDTH, 0);
  edge.addColorStop(0, "rgba(255,255,255,0.035)");
  edge.addColorStop(0.05, "rgba(255,255,255,0)");
  edge.addColorStop(0.95, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(255,255,255,0.035)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

function scheduleTone(context, destination, when, frequency, duration, gainValue = 0.06, type = "sine") {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.72), when + duration);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(gainValue, when + Math.min(0.05, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(gain).connect(destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.03);
}

function scheduleWhoosh(context, destination, when, duration = 0.7, gainValue = 0.035) {
  const sampleRate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = seed(index + Math.floor(when * 1_000)) * 2 - 1;
    previous = previous * 0.78 + white * 0.22;
    data[index] = previous;
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(380, when);
  filter.frequency.exponentialRampToValueAtTime(2_600, when + duration * 0.72);
  filter.Q.value = 0.75;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(gainValue, when + duration * 0.4);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter).connect(gain).connect(destination);
  source.start(when);
  source.stop(when + duration);
}

function scheduleSoundtrack(context, destination, startTime) {
  const master = context.createGain();
  master.gain.value = 0.78;
  master.connect(destination);

  const padGain = context.createGain();
  const lowPass = context.createBiquadFilter();
  padGain.gain.setValueAtTime(0.0001, startTime);
  padGain.gain.exponentialRampToValueAtTime(0.025, startTime + 1.1);
  padGain.gain.setValueAtTime(0.025, startTime + 16.7);
  padGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 17.9);
  lowPass.type = "lowpass";
  lowPass.frequency.value = 420;
  lowPass.Q.value = 0.7;
  padGain.connect(lowPass).connect(master);

  [55, 82.41, 110].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = index === 0 ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    oscillator.detune.value = index * 4 - 3;
    oscillator.connect(padGain);
    oscillator.start(startTime);
    oscillator.stop(startTime + AD_DURATION / 1_000);
  });

  [
    [0.28, 523.25, 0.72, 0.045],
    [0.48, 659.25, 0.8, 0.038],
    [0.72, 783.99, 1.05, 0.032],
    [2.75, 659.25, 0.46, 0.04],
    [3.08, 783.99, 0.5, 0.038],
    [3.42, 987.77, 0.76, 0.032],
    [5.82, 130.81, 0.5, 0.07],
    [7.1, 196, 0.28, 0.045],
    [8.25, 246.94, 0.26, 0.04],
    [9.42, 293.66, 0.28, 0.04],
    [10.72, 392, 0.42, 0.04],
    [11.64, 523.25, 0.85, 0.052],
    [11.77, 659.25, 0.9, 0.044],
    [11.9, 783.99, 1.15, 0.036],
    [14.62, 392, 0.6, 0.042],
    [15.22, 523.25, 0.6, 0.038],
    [16.08, 659.25, 0.9, 0.044],
    [16.22, 783.99, 1.15, 0.035],
  ].forEach(([offset, frequency, duration, gain]) => {
    scheduleTone(context, master, startTime + offset, frequency, duration, gain, frequency < 200 ? "triangle" : "sine");
  });

  [2.62, 5.72, 8.7, 11.38, 14.48].forEach((offset, index) => {
    scheduleWhoosh(context, master, startTime + offset, index === 2 ? 0.42 : 0.68, index === 4 ? 0.05 : 0.032);
  });
}

function initializeApp() {
  const canvas = document.querySelector("#adCanvas");
  const context = canvas.getContext("2d", { alpha: false });
  const playButton = document.querySelector("#playButton");
  const replayButton = document.querySelector("#replayButton");
  const soundButton = document.querySelector("#soundButton");
  const exportButton = document.querySelector("#exportButton");
  const exportStatus = document.querySelector("#exportStatus");
  const timelineProgress = document.querySelector("#timelineProgress");
  const timelineButtons = [...document.querySelectorAll("[data-seek]")];

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    playing: !prefersReducedMotion,
    startedAt: performance.now(),
    offset: prefersReducedMotion ? 11_900 : 0,
    exporting: false,
    exportStartedAt: 0,
    soundEnabled: false,
    audioContext: null,
    audioTimer: null,
  };

  function currentTime(now = performance.now()) {
    if (state.exporting) return Math.min(AD_DURATION - 1, now - state.exportStartedAt);
    if (!state.playing) return state.offset;
    return (state.offset + now - state.startedAt) % AD_DURATION;
  }

  function updatePlayButton() {
    const icon = playButton.querySelector(".button-icon");
    const label = playButton.querySelector("span:last-child");
    icon.textContent = state.playing ? "Ⅱ" : "▶";
    label.textContent = state.playing ? "إيقاف" : "تشغيل";
  }

  function stopSound() {
    if (state.audioTimer) window.clearTimeout(state.audioTimer);
    state.audioTimer = null;
    if (state.audioContext && state.audioContext.state !== "closed") {
      state.audioContext.close();
    }
    state.audioContext = null;
  }

  function startLiveSoundtrack() {
    stopSound();
    if (!state.soundEnabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const audioContext = new AudioContextClass();
    state.audioContext = audioContext;
    scheduleSoundtrack(audioContext, audioContext.destination, audioContext.currentTime + 0.04);
    state.audioTimer = window.setTimeout(() => {
      if (state.soundEnabled && state.playing && !state.exporting) {
        state.offset = 0;
        state.startedAt = performance.now();
        startLiveSoundtrack();
      }
    }, AD_DURATION);
  }

  function seek(time) {
    state.offset = clamp(Number(time), 0, AD_DURATION - 1);
    state.startedAt = performance.now();
    if (state.soundEnabled) {
      state.offset = 0;
      startLiveSoundtrack();
    }
  }

  function setPlaying(nextPlaying) {
    if (nextPlaying === state.playing) return;
    if (nextPlaying) {
      state.startedAt = performance.now();
      state.playing = true;
      if (state.soundEnabled) startLiveSoundtrack();
    } else {
      state.offset = currentTime();
      state.playing = false;
      if (state.audioContext?.state === "running") state.audioContext.suspend();
    }
    updatePlayButton();
  }

  playButton.addEventListener("click", () => {
    if (state.exporting) return;
    if (!state.playing && state.audioContext?.state === "suspended") {
      state.audioContext.resume();
      state.startedAt = performance.now();
      state.playing = true;
      updatePlayButton();
      return;
    }
    setPlaying(!state.playing);
  });

  replayButton.addEventListener("click", () => {
    if (state.exporting) return;
    state.offset = 0;
    state.startedAt = performance.now();
    state.playing = true;
    updatePlayButton();
    if (state.soundEnabled) startLiveSoundtrack();
  });

  soundButton.addEventListener("click", () => {
    if (state.exporting) return;
    state.soundEnabled = !state.soundEnabled;
    soundButton.classList.toggle("active", state.soundEnabled);
    soundButton.querySelector("span:last-child").textContent = state.soundEnabled ? "صوت شغّال" : "الصوت";
    state.offset = 0;
    state.startedAt = performance.now();
    state.playing = true;
    updatePlayButton();
    if (state.soundEnabled) startLiveSoundtrack();
    else stopSound();
  });

  timelineButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (state.exporting) return;
      seek(button.dataset.seek);
    });
  });

  async function exportVideo() {
    if (state.exporting || !window.MediaRecorder || !canvas.captureStream) {
      if (!window.MediaRecorder || !canvas.captureStream) exportStatus.textContent = "المتصفح لا يدعم التصدير المباشر.";
      return;
    }

    const mimeTypes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
    const stream = canvas.captureStream(30);
    let exportAudioContext = null;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        exportAudioContext = new AudioContextClass();
        const destination = exportAudioContext.createMediaStreamDestination();
        scheduleSoundtrack(exportAudioContext, destination, exportAudioContext.currentTime + 0.08);
        const audioTrack = destination.stream.getAudioTracks()[0];
        if (audioTrack) stream.addTrack(audioTrack);
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
        audioBitsPerSecond: 192_000,
      });
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });

      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunks, { type: mimeType || "video/webm" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "laththa-cake-ad-1080x1920.webm";
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 12_000);
        exportAudioContext?.close();
        stream.getTracks().forEach((track) => track.stop());
        state.exporting = false;
        state.offset = 0;
        state.startedAt = performance.now();
        state.playing = true;
        exportButton.disabled = false;
        exportStatus.textContent = "تم التصدير ✓ الفيديو في مجلد التنزيلات";
        if (state.soundEnabled) startLiveSoundtrack();
      });

      stopSound();
      state.exporting = true;
      state.exportStartedAt = performance.now();
      exportButton.disabled = true;
      recorder.start(250);
      window.setTimeout(() => recorder.stop(), AD_DURATION + 260);
    } catch (error) {
      exportAudioContext?.close();
      stream.getTracks().forEach((track) => track.stop());
      state.exporting = false;
      exportButton.disabled = false;
      exportStatus.textContent = "تعذّر التصدير. جرّب Chrome أو Edge.";
      console.error(error);
    }
  }

  exportButton.addEventListener("click", exportVideo);

  function render(now) {
    const time = currentTime(now);
    drawFrame(context, time);
    timelineProgress.style.width = `${(time / AD_DURATION) * 100}%`;
    const activeScene = sceneAt(time);
    timelineButtons.forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.seek) === activeScene.start);
    });
    if (state.exporting) {
      const percentage = Math.min(99, Math.floor((time / AD_DURATION) * 100));
      exportStatus.textContent = `جارٍ بناء الفيديو والصوت... ${percentage}%`;
    }
    window.requestAnimationFrame(render);
  }

  updatePlayButton();
  window.requestAnimationFrame(render);

  window.__cakeAd = {
    drawFrame: (time) => drawFrame(context, time),
    exportVideo,
    seek,
    getState: () => ({ ...state, audioContext: undefined, audioTimer: undefined }),
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initializeApp);
}
